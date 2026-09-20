//! Recoloration d'une image RGBA8 — décalage TSV et rampe de luminance.
//!
//! ## Pourquoi ce module existe
//!
//! Porté depuis « INAZUMA ELEVEN Hissatsu Recolor Tool » (GameBanana 22383, fichier 1671783,
//! Python/Tkinter, licence explicitement permissive : « use parts of this Tool in another Tool »).
//! **Seule la transformation couleur a été reprise.** Son lecteur `.g4tx` est une invention —
//! il suppose le magic suivi de trois `u32` (version, largeur, hauteur) puis des pixels RGBA
//! bruts à offset fixe, là où le format réel est un conteneur d'en-tête `0x60` avec table
//! d'entrées `0x30`, régions d'atlas `0x18`, chunks NXTCH et charges DDS (cf. [`crate::g4tx`]).
//! Son propre rapport de validation l'admet à mots couverts (« returns original if parsing
//! fails ») : en pratique il recopiait les fichiers sans les modifier. Le décodage et
//! l'encodage réels sont ceux du dépôt ([`crate::g4tx_decode`] / [`crate::g4tx_encode`]).
//!
//! ## Le modèle de couleur
//!
//! Deux étages, appliqués dans cet ordre, sur chaque pixel dont l'alpha dépasse un seuil :
//!
//! 1. **TSV** — décalage de teinte (degrés, cyclique), facteurs de saturation et de valeur.
//! 2. **Rampe de luminance** — la luminance du pixel indexe une rampe de couleurs, et le
//!    résultat est mélangé à l'original selon une force. C'est la généralisation du trio
//!    `primary`/`secondary`/`accent` de l'outil d'origine ([`Ramp::from_three`]), qui n'est
//!    qu'une rampe à trois arrêts en `0.0` / `0.5` / `1.0`.
//!
//! L'alpha n'est **jamais** touché : une aura de technique est un dégradé alpha, et le repeindre
//! détruirait sa découpe. Les pixels sous `alpha_min` sont laissés tels quels — le remplissage
//! transparent d'un atlas ne porte pas de couleur à décaler.

use alloc::string::{String, ToString};
use alloc::vec::Vec;

/// Un arrêt de rampe : une position dans `0.0..=1.0` et la couleur qui y règne.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Stop {
    /// Position sur l'axe de luminance, `0.0` = noir, `1.0` = blanc.
    pub position: f32,
    /// Couleur à cette position.
    pub color: [u8; 3],
}

/// Rampe de luminance : la luminance d'un pixel y choisit une couleur, mélangée à l'original.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Ramp {
    /// Arrêts, triés par position croissante. Au moins un.
    pub stops: Vec<Stop>,
    /// Force du mélange, `0.0` = original intact, `1.0` = couleur de rampe pure.
    pub strength: f32,
}

impl Ramp {
    /// La rampe à trois arrêts de l'outil d'origine : `primary` dans l'ombre, `secondary` à
    /// mi-luminance, `accent` dans les hautes lumières.
    #[must_use]
    pub fn from_three(primary: [u8; 3], secondary: [u8; 3], accent: [u8; 3]) -> Self {
        Self {
            stops: alloc::vec![
                Stop {
                    position: 0.0,
                    color: primary
                },
                Stop {
                    position: 0.5,
                    color: secondary
                },
                Stop {
                    position: 1.0,
                    color: accent
                },
            ],
            strength: 1.0,
        }
    }

    /// Couleur de la rampe à la position `t` (interpolation linéaire entre arrêts encadrants).
    ///
    /// Hors des arrêts extrêmes, la couleur de l'arrêt le plus proche est tenue — une rampe
    /// n'extrapole pas.
    #[must_use]
    pub fn sample(&self, t: f32) -> [u8; 3] {
        let Some(premier) = self.stops.first() else {
            return [0, 0, 0];
        };
        let t = clamp01(t);
        if t <= premier.position {
            return premier.color;
        }
        for paire in self.stops.windows(2) {
            let (a, b) = (paire[0], paire[1]);
            if t <= b.position {
                let largeur = b.position - a.position;
                // Deux arrêts confondus : la borne haute l'emporte, plutôt qu'une division par
                // zéro qui rendrait NaN puis un pixel noir.
                if largeur <= f32::EPSILON {
                    return b.color;
                }
                let f = (t - a.position) / largeur;
                return [
                    melanger_u8(a.color[0], b.color[0], f),
                    melanger_u8(a.color[1], b.color[1], f),
                    melanger_u8(a.color[2], b.color[2], f),
                ];
            }
        }
        self.stops.last().map_or([0, 0, 0], |s| s.color)
    }

    /// Lit une rampe écrite `#RRGGBB[@position]`, arrêts séparés par des virgules.
    ///
    /// Sans position explicite, les arrêts sont répartis uniformément sur `0.0..=1.0` — de sorte
    /// que `"#FF4400,#FF8800,#FFCC00"` donne exactement le trio primary/secondary/accent.
    ///
    /// # Errors
    ///
    /// Si la chaîne est vide, si une couleur n'est pas un hexadécimal RGB, ou si une position
    /// n'est pas un nombre de `0.0` à `1.0`.
    pub fn parse(spec: &str) -> Result<Self, String> {
        let morceaux: Vec<&str> = spec
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if morceaux.is_empty() {
            return Err("rampe vide — attendu « #RRGGBB[@position],… »".to_string());
        }
        let dernier = morceaux.len().saturating_sub(1);
        let mut stops = Vec::with_capacity(morceaux.len());
        for (i, m) in morceaux.iter().enumerate() {
            let (couleur, position) = match m.split_once('@') {
                Some((c, p)) => {
                    let v: f32 = p.trim().parse().map_err(|_| {
                        alloc::format!("« {p} » n'est pas une position de rampe (0.0 à 1.0)")
                    })?;
                    if !(0.0..=1.0).contains(&v) {
                        return Err(alloc::format!("position {v} hors de 0.0..=1.0"));
                    }
                    (c.trim(), v)
                }
                // Répartition uniforme. Un arrêt unique se pose en 0.0 et tient toute la rampe.
                None if dernier == 0 => (*m, 0.0),
                None => (*m, i as f32 / dernier as f32),
            };
            stops.push(Stop {
                position,
                color: parse_hex_rgb(couleur)?,
            });
        }
        stops.sort_by(|a, b| {
            a.position
                .partial_cmp(&b.position)
                .unwrap_or(core::cmp::Ordering::Equal)
        });
        Ok(Self {
            stops,
            strength: 1.0,
        })
    }
}

/// Filtre de recoloration complet.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Recolor {
    /// Décalage de teinte en degrés (cyclique, toute valeur admise).
    pub hue_shift: f32,
    /// Facteur de saturation (`1.0` = inchangé, `0.0` = gris).
    pub saturation: f32,
    /// Facteur de valeur/luminosité (`1.0` = inchangé).
    pub value: f32,
    /// Rampe de luminance optionnelle, appliquée après le TSV.
    pub ramp: Option<Ramp>,
    /// Alpha en dessous duquel un pixel est laissé intact.
    pub alpha_min: u8,
}

impl Default for Recolor {
    fn default() -> Self {
        Self::identity()
    }
}

impl Recolor {
    /// Le filtre qui ne change rien.
    #[must_use]
    pub fn identity() -> Self {
        Self {
            hue_shift: 0.0,
            saturation: 1.0,
            value: 1.0,
            ramp: None,
            alpha_min: 1,
        }
    }

    /// Vrai si le filtre laisserait toute image inchangée — de quoi refuser tôt un `recolor`
    /// sans paramètre plutôt que de réécrire un conteneur à l'identique.
    #[must_use]
    pub fn is_identity(&self) -> bool {
        self.ramp.is_none()
            && approx(self.hue_shift % 360.0, 0.0)
            && approx(self.saturation, 1.0)
            && approx(self.value, 1.0)
    }

    /// Applique le filtre en place sur un tampon RGBA8.
    ///
    /// Les octets excédentaires d'un tampon dont la longueur n'est pas un multiple de 4 sont
    /// laissés tels quels.
    pub fn apply_rgba(&self, rgba: &mut [u8]) {
        if self.is_identity() {
            return;
        }
        let teinte_active = !approx(self.hue_shift % 360.0, 0.0)
            || !approx(self.saturation, 1.0)
            || !approx(self.value, 1.0);
        for px in rgba.chunks_exact_mut(4) {
            if px[3] < self.alpha_min {
                continue;
            }
            let mut rgb = [px[0], px[1], px[2]];
            if teinte_active {
                let [h, s, v] = rgb_to_hsv(rgb);
                rgb = hsv_to_rgb([
                    wrap360(h + self.hue_shift),
                    clamp01(s * self.saturation),
                    clamp01(v * self.value),
                ]);
            }
            if let Some(ramp) = &self.ramp {
                let cible = ramp.sample(luminance(rgb));
                let f = clamp01(ramp.strength);
                rgb = [
                    melanger_u8(rgb[0], cible[0], f),
                    melanger_u8(rgb[1], cible[1], f),
                    melanger_u8(rgb[2], cible[2], f),
                ];
            }
            px[0] = rgb[0];
            px[1] = rgb[1];
            px[2] = rgb[2];
        }
    }
}

/// Luminance perceptuelle Rec. 709, normalisée sur `0.0..=1.0`.
#[must_use]
pub fn luminance(rgb: [u8; 3]) -> f32 {
    (0.2126 * f32::from(rgb[0]) + 0.7152 * f32::from(rgb[1]) + 0.0722 * f32::from(rgb[2])) / 255.0
}

/// RGB8 → TSV, teinte en degrés `0.0..360.0`, saturation et valeur sur `0.0..=1.0`.
#[must_use]
pub fn rgb_to_hsv(rgb: [u8; 3]) -> [f32; 3] {
    let r = f32::from(rgb[0]) / 255.0;
    let g = f32::from(rgb[1]) / 255.0;
    let b = f32::from(rgb[2]) / 255.0;
    let max = if r > g { r.max(b) } else { g.max(b) };
    let min = if r < g { r.min(b) } else { g.min(b) };
    let delta = max - min;
    let h = if delta <= f32::EPSILON {
        0.0
    } else if approx(max, r) {
        60.0 * (((g - b) / delta) % 6.0)
    } else if approx(max, g) {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };
    let s = if max <= f32::EPSILON {
        0.0
    } else {
        delta / max
    };
    [wrap360(h), s, max]
}

/// TSV → RGB8, réciproque de [`rgb_to_hsv`].
#[must_use]
pub fn hsv_to_rgb(hsv: [f32; 3]) -> [u8; 3] {
    let h = wrap360(hsv[0]);
    let s = clamp01(hsv[1]);
    let v = clamp01(hsv[2]);
    let c = v * s;
    let secteur = h / 60.0;
    // `as i32` tronque vers zéro ; `h` est déjà ramené dans `0.0..360.0`, donc positif, et la
    // troncature y vaut le plancher.
    let x = c * (1.0 - abs(secteur % 2.0 - 1.0));
    let m = v - c;
    let (r, g, b) = match secteur as i32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    [octet(r + m), octet(g + m), octet(b + m)]
}

/// Lit `#RRGGBB` ou `RRGGBB`.
///
/// # Errors
///
/// Si la chaîne n'a pas six chiffres hexadécimaux.
pub fn parse_hex_rgb(s: &str) -> Result<[u8; 3], String> {
    let h = s.trim().trim_start_matches('#');
    if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(alloc::format!(
            "« {s} » n'est pas une couleur hexadécimale RGB (attendu « #RRGGBB »)"
        ));
    }
    let n = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).unwrap_or(0);
    Ok([n(0), n(2), n(4)])
}

// ---------------------------------------------------------------------------------------------
// Aides scalaires. Écrites à la main : `f32::abs` et consorts sont fournis par `std`, et ce
// module reste utilisable sans (le cœur de `nie-formats` est alloc-only).
// ---------------------------------------------------------------------------------------------

fn abs(x: f32) -> f32 {
    if x < 0.0 { -x } else { x }
}

fn approx(a: f32, b: f32) -> bool {
    abs(a - b) <= 1e-6
}

fn clamp01(x: f32) -> f32 {
    if x.is_nan() { 0.0 } else { x.clamp(0.0, 1.0) }
}

/// Ramène un angle dans `0.0..360.0`, y compris négatif (`%` garde le signe du dividende).
fn wrap360(deg: f32) -> f32 {
    if deg.is_nan() {
        return 0.0;
    }
    let d = deg % 360.0;
    if d < 0.0 { d + 360.0 } else { d }
}

fn octet(x: f32) -> u8 {
    let v = clamp01(x) * 255.0 + 0.5;
    // `as u8` sature déjà en Rust, mais le `clamp01` garantit la plage avant conversion.
    v as u8
}

fn melanger_u8(a: u8, b: u8, f: f32) -> u8 {
    let f = clamp01(f);
    octet((f32::from(a) * (1.0 - f) + f32::from(b) * f) / 255.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hsv_fait_l_aller_retour_sur_les_primaires() {
        for couleur in [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
            [255, 255, 0],
            [0, 255, 255],
            [255, 0, 255],
            [255, 255, 255],
            [0, 0, 0],
            [18, 52, 86],
        ] {
            assert_eq!(hsv_to_rgb(rgb_to_hsv(couleur)), couleur, "{couleur:?}");
        }
    }

    #[test]
    fn un_decalage_de_120_degres_permute_les_canaux() {
        // Rouge → vert → bleu → rouge : c'est la vérification que le décalage est cyclique et
        // que `wrap360` traite bien 360 comme 0.
        let f = Recolor {
            hue_shift: 120.0,
            ..Recolor::identity()
        };
        let mut px = [255, 0, 0, 255];
        f.apply_rgba(&mut px);
        assert_eq!(px, [0, 255, 0, 255]);
        f.apply_rgba(&mut px);
        assert_eq!(px, [0, 0, 255, 255]);
        f.apply_rgba(&mut px);
        assert_eq!(px, [255, 0, 0, 255]);
    }

    #[test]
    fn un_decalage_negatif_vaut_son_complement() {
        let mut a = [255, 0, 0, 255];
        let mut b = [255, 0, 0, 255];
        Recolor {
            hue_shift: -120.0,
            ..Recolor::identity()
        }
        .apply_rgba(&mut a);
        Recolor {
            hue_shift: 240.0,
            ..Recolor::identity()
        }
        .apply_rgba(&mut b);
        assert_eq!(a, b);
    }

    #[test]
    fn l_alpha_n_est_jamais_touche() {
        // Une aura de technique est un dégradé alpha : le repeindre détruirait sa découpe.
        let f = Recolor {
            hue_shift: 90.0,
            saturation: 0.3,
            value: 2.0,
            ramp: Some(Ramp::from_three([255, 0, 0], [0, 255, 0], [0, 0, 255])),
            alpha_min: 1,
        };
        let mut px = [200, 100, 50, 137, 10, 20, 30, 255];
        f.apply_rgba(&mut px);
        assert_eq!(px[3], 137);
        assert_eq!(px[7], 255);
    }

    #[test]
    fn les_pixels_sous_le_seuil_alpha_sont_laisses_intacts() {
        let f = Recolor {
            hue_shift: 180.0,
            alpha_min: 8,
            ..Recolor::identity()
        };
        let mut px = [200, 100, 50, 7, 200, 100, 50, 8];
        f.apply_rgba(&mut px);
        assert_eq!(&px[0..4], &[200, 100, 50, 7], "sous le seuil : intact");
        assert_ne!(&px[4..7], &[200, 100, 50], "au seuil : recoloré");
    }

    #[test]
    fn la_rampe_a_trois_arrets_est_celle_de_l_outil_d_origine() {
        // primary/secondary/accent = arrêts 0.0 / 0.5 / 1.0. C'est le seul modèle couleur que
        // l'outil GameBanana exprimait ; il doit se retrouver exactement.
        let a = Ramp::from_three([0xFF, 0x44, 0x00], [0xFF, 0x88, 0x00], [0xFF, 0xCC, 0x00]);
        let b = Ramp::parse("#FF4400,#FF8800,#FFCC00").expect("rampe lisible");
        assert_eq!(a.stops, b.stops);
        assert_eq!(a.sample(0.0), [0xFF, 0x44, 0x00]);
        assert_eq!(a.sample(0.5), [0xFF, 0x88, 0x00]);
        assert_eq!(a.sample(1.0), [0xFF, 0xCC, 0x00]);
    }

    #[test]
    fn la_rampe_interpole_entre_ses_arrets_et_tient_ses_bornes() {
        let r = Ramp::from_three([0, 0, 0], [128, 128, 128], [255, 255, 255]);
        assert_eq!(r.sample(0.25), [64, 64, 64]);
        // 128 → 255 à mi-chemin = 191,5, arrondi au plus proche par `octet`.
        assert_eq!(r.sample(0.75), [192, 192, 192]);
        // Hors bornes : la rampe tient, elle n'extrapole pas.
        assert_eq!(r.sample(-5.0), [0, 0, 0]);
        assert_eq!(r.sample(5.0), [255, 255, 255]);
    }

    #[test]
    fn une_force_nulle_laisse_l_original() {
        let mut ramp = Ramp::from_three([255, 0, 0], [255, 0, 0], [255, 0, 0]);
        ramp.strength = 0.0;
        let f = Recolor {
            ramp: Some(ramp),
            ..Recolor::identity()
        };
        let mut px = [10, 20, 30, 255];
        f.apply_rgba(&mut px);
        assert_eq!(px, [10, 20, 30, 255]);
    }

    #[test]
    fn le_filtre_identite_ne_touche_rien() {
        let f = Recolor::identity();
        assert!(f.is_identity());
        let mut px = [1, 2, 3, 4, 250, 251, 252, 253];
        let avant = px;
        f.apply_rgba(&mut px);
        assert_eq!(px, avant);
    }

    #[test]
    fn un_tampon_tronque_ne_panique_pas() {
        // `chunks_exact_mut(4)` ignore le reste : une longueur non multiple de 4 est une entrée
        // malformée, pas un panic.
        let f = Recolor {
            hue_shift: 45.0,
            ..Recolor::identity()
        };
        let mut px = [10, 20, 30, 255, 99, 98];
        f.apply_rgba(&mut px);
        assert_eq!(&px[4..], &[99, 98]);
    }

    #[test]
    fn les_couleurs_hexadecimales_refusees_le_sont_explicitement() {
        assert_eq!(parse_hex_rgb("#FF4400"), Ok([0xFF, 0x44, 0x00]));
        assert_eq!(parse_hex_rgb("ff4400"), Ok([0xFF, 0x44, 0x00]));
        assert!(parse_hex_rgb("#FF44").is_err());
        assert!(parse_hex_rgb("#GG4400").is_err());
        assert!(parse_hex_rgb("").is_err());
        assert!(Ramp::parse("").is_err());
        assert!(Ramp::parse("#FF4400@2.0").is_err());
        assert!(Ramp::parse("#FF4400@abc").is_err());
    }

    #[test]
    fn la_saturation_nulle_rend_un_gris_de_meme_valeur() {
        let f = Recolor {
            saturation: 0.0,
            ..Recolor::identity()
        };
        let mut px = [255, 0, 0, 255];
        f.apply_rgba(&mut px);
        assert_eq!(px, [255, 255, 255, 255], "TSV : V du rouge pur vaut 1.0");
    }
}
