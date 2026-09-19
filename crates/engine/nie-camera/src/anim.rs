//! Échantillonnage d'une [`CameraAnim`] vers un [`CameraState`] à un instant donné.
//!
//! C'est le premier consommateur du barème de déquantification prouvé dans
//! `nie_formats::g4cm` : il transforme « 40 canaux de mots 16 bits » en « où est la caméra à la
//! frame 137,5 ».
//!
//! ## L'honnêteté est portée par le TYPE
//!
//! Les canaux [`ChannelKind::Fov`] et [`ChannelKind::Roll`] se déquantifient sans difficulté,
//! mais leur **unité est inconnue** : les valeurs obtenues (de l'ordre de `−0,37` à `0,80`) ne
//! sont ni des degrés ni des radians, et aucun canal `f32` de ces deux genres n'existe dans les
//! 1 215 fichiers du corpus — il n'y a donc pas d'oracle par comparaison de distributions.
//!
//! [`EtatEchantillonne::etat`] conserve donc le `fov_deg` par défaut du modèle et expose la
//! valeur déquantifiée à côté, dans [`EtatEchantillonne::fov_brut`]. **Aucun code d'ici
//! n'invente une conversion.** Le jour où le « setter » appelé en `0x1405AAF82` sera émulé, la
//! conversion s'écrira à un seul endroit.
//!
//! ## Le piège des clips
//!
//! Les clips d'un `.g4cm` **ne sont pas contigus** : un seul des quatre fichiers vérifiés à la
//! main enchaîne les siens bord à bord. Un échantillonneur qui suppose une timeline continue
//! saute des images. Ici, chaque canal est interrogé par sa propre table de temps et les valeurs
//! sont maintenues aux bornes, ce qui ne suppose aucune continuité.

use nie_formats::g4cm::{CameraAnim, Channel, ChannelKind};

use crate::model::CameraState;

/// Une piste de caméra : un objet animé d'une [`CameraAnim`].
#[derive(Debug, Clone, Copy)]
pub struct CameraTrack<'a> {
    anim: &'a CameraAnim,
    objet: usize,
}

/// L'état de la caméra à un instant, et ce qui n'a pas pu être interprété.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EtatEchantillonne {
    /// L'état exploitable : position et point visé sont réels ; `fov_deg` et `roll_deg` restent
    /// aux valeurs par défaut tant que l'unité des canaux correspondants n'est pas prouvée.
    pub etat: CameraState,
    /// La valeur déquantifiée du canal `fov`, **sans unité établie**.
    pub fov_brut: Option<f32>,
    /// La valeur déquantifiée du canal `roll`, **sans unité établie**.
    pub roll_brut: Option<f32>,
    /// Nombre de canaux de cet objet dont l'**encodage** n'est pas résolu (`Quant::Inconnu`).
    pub canaux_indecodes: u16,
    /// Nombre de canaux écartés parce que leur **table de temps** n'est pas croissante.
    ///
    /// Ces deux compteurs sont séparés parce qu'ils désignent deux défauts sans rapport : l'un
    /// est un décodeur qu'on n'a pas désassemblé, l'autre une base de table mal placée. Les
    /// confondre ferait croire qu'un seul chantier les lève.
    pub canaux_temps_invalides: u16,
}

impl<'a> CameraTrack<'a> {
    /// La piste d'un objet par son index.
    #[must_use]
    pub fn nouvelle(anim: &'a CameraAnim, objet: usize) -> Option<Self> {
        (objet < anim.object_count()).then_some(Self { anim, objet })
    }

    /// La piste d'un objet par son nom de la table de noms (`"c0010"`, `"c0020"`…).
    #[must_use]
    pub fn nommee(anim: &'a CameraAnim, nom: &str) -> Option<Self> {
        (0..anim.object_count())
            .find(|&i| anim.name_of(i) == nom)
            .map(|objet| Self { anim, objet })
    }

    /// Le nom déclaré de cet objet.
    #[must_use]
    pub fn nom(&self) -> &'a str {
        self.anim.name_of(self.objet)
    }

    /// L'index de l'objet dans l'animation.
    #[must_use]
    pub const fn objet(&self) -> usize {
        self.objet
    }

    /// Première et dernière frame couvertes par les canaux de cet objet.
    ///
    /// Déduite des tables de temps, et non des clips : c'est la seule borne qui décrive ce que
    /// l'on peut réellement échantillonner.
    #[must_use]
    pub fn plage(&self) -> Option<(u16, u16)> {
        let mut bornes: Option<(u16, u16)> = None;
        for canal in self.anim.channels_of(self.objet) {
            let temps = canal.times(self.anim);
            // Une table non croissante n'a pas de bornes lisibles : son premier et son dernier
            // élément ne sont pas son minimum et son maximum. L'inclure élargirait la plage
            // d'une valeur qui ne veut rien dire.
            if !table_exploitable(temps) {
                continue;
            }
            let (Some(&a), Some(&b)) = (temps.first(), temps.last()) else {
                continue;
            };
            bornes = Some(match bornes {
                None => (a, b),
                Some((lo, hi)) => (lo.min(a), hi.max(b)),
            });
        }
        bornes
    }

    /// L'état de la caméra à une frame **fractionnaire**.
    ///
    /// Les canaux absents ou indécodables laissent le champ correspondant à sa valeur par
    /// défaut ; `canaux_indecodes` dit combien.
    #[must_use]
    pub fn etat(&self, frame: f32) -> EtatEchantillonne {
        let mut etat = CameraState::default();
        let (mut fov_brut, mut roll_brut) = (None, None);
        let (mut indecodes, mut temps_invalides) = (0u16, 0u16);

        for canal in self.anim.channels_of(self.objet) {
            let Some(v) = echantillonner(canal, self.anim, frame) else {
                // Dire LAQUELLE des deux causes a écarté ce canal. Un canal simplement vide
                // n'est ni l'une ni l'autre et ne doit alimenter aucun compteur.
                if canal.track.is_empty() {
                    continue;
                }
                if canal.decoded(self.anim).is_none() {
                    indecodes += 1;
                } else if !table_exploitable(canal.times(self.anim)) {
                    temps_invalides += 1;
                }
                continue;
            };
            match canal.kind {
                ChannelKind::PosX => etat.pos[0] = v,
                ChannelKind::PosY => etat.pos[1] = v,
                ChannelKind::PosZ => etat.pos[2] = v,
                ChannelKind::RefX => etat.ref_pos[0] = v,
                ChannelKind::RefY => etat.ref_pos[1] = v,
                ChannelKind::RefZ => etat.ref_pos[2] = v,
                // Pas de conversion : l'unité n'est pas prouvée, donc la valeur reste à côté.
                ChannelKind::Fov => fov_brut = Some(v),
                ChannelKind::Roll => roll_brut = Some(v),
                ChannelKind::Other(_) => {}
            }
        }

        EtatEchantillonne {
            etat,
            fov_brut,
            roll_brut,
            canaux_indecodes: indecodes,
            canaux_temps_invalides: temps_invalides,
        }
    }
}

/// `true` si la table de temps de ce canal est exploitable, c'est-à-dire **non décroissante**.
///
/// # Pourquoi ce garde-fou existe, alors que le corpus est sain
///
/// Il n'écarte plus rien aujourd'hui : depuis que `nie_formats::g4cm` aligne la section des
/// temps sur `align * 4` et non sur `align`, les **1 215 fichiers** du corpus ont toutes leurs
/// tables croissantes. C'est précisément ce garde-fou qui a permis de trouver le défaut, en
/// refusant de rendre une valeur plutôt qu'en rendant une valeur fausse.
///
/// Il reste parce que la panne qu'il attrape est **muette** : une table décroissante
/// s'interpole sans erreur et rend une position de caméra plausible et fausse. Un décodeur mal
/// aligné est le genre de régression qu'aucun test de ré-encodage ne voit — le fichier
/// ressortait byte-exact pendant tout ce temps.
fn table_exploitable(temps: &[u16]) -> bool {
    temps.windows(2).all(|w| w[0] <= w[1])
}

/// Interpole un canal à une frame fractionnaire.
///
/// Maintien aux deux bornes, interpolation linéaire entre deux clés. À une frame de clé exacte,
/// `t` vaut 0 et la valeur ressort **bit à bit** celle de la clé — c'est ce qui permet de
/// vérifier l'échantillonneur contre le décodage direct sans tolérance.
///
/// Rend `None` si l'encodage du canal n'est pas résolu, **ou** si sa table de temps n'est pas
/// croissante (cf. [`table_exploitable`]).
fn echantillonner(canal: &Channel, anim: &CameraAnim, frame: f32) -> Option<f32> {
    let valeurs = canal.decoded(anim)?;
    let temps = canal.times(anim);
    let n = valeurs.len().min(temps.len());
    if n == 0 {
        return None;
    }
    if !table_exploitable(&temps[..n]) {
        return None;
    }
    if !frame.is_finite() {
        return None;
    }
    if frame <= f32::from(temps[0]) {
        return Some(valeurs[0]);
    }
    if frame >= f32::from(temps[n - 1]) {
        return Some(valeurs[n - 1]);
    }
    // `partition_point` donne le premier index dont le temps DÉPASSE la frame ; la clé
    // encadrante est donc celle d'avant. Une recherche linéaire serait correcte aussi, mais les
    // tables de temps montent à plusieurs centaines d'entrées par canal.
    let sup = temps[..n].partition_point(|&t| f32::from(t) <= frame);
    let i = sup.saturating_sub(1);
    let (t0, t1) = (f32::from(temps[i]), f32::from(temps[sup.min(n - 1)]));
    let (v0, v1) = (valeurs[i], valeurs[sup.min(n - 1)]);
    let span = t1 - t0;
    if span <= 0.0 {
        return Some(v0);
    }
    let t = (frame - t0) / span;
    Some(v0 + (v1 - v0) * t)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn charger(chemin: &str) -> Option<CameraAnim> {
        let octets = std::fs::read(chemin).ok()?;
        nie_formats::g4cm::decode(&octets).ok()
    }

    const REEL: &str = "../../../var/tmp/gk-event/ev60_00340_camera.g4cm";

    /// À une frame de clé exacte, l'échantillonnage doit rendre la valeur de la clé **bit à
    /// bit**. Une interpolation qui se trompe d'index, ou un `t` qui ne vaut pas exactement 0,
    /// se verrait ici et nulle part ailleurs.
    #[test]
    fn aux_frames_de_cle_l_echantillonnage_est_l_identite() {
        let Some(anim) = charger(REEL) else {
            eprintln!("asset absent : test ignoré");
            return;
        };
        let mut verifies = 0;
        for objet in 0..anim.object_count() {
            for canal in anim.channels_of(objet) {
                let Some(valeurs) = canal.decoded(&anim) else {
                    continue;
                };
                let temps = canal.times(&anim);
                if !table_exploitable(&temps[..temps.len().min(valeurs.len())]) {
                    continue;
                }
                for (k, &t) in temps.iter().enumerate().take(valeurs.len()) {
                    let obtenu = echantillonner(canal, &anim, f32::from(t)).expect("échantillon");
                    assert_eq!(
                        obtenu.to_bits(),
                        valeurs[k].to_bits(),
                        "objet {objet} canal {} frame {t}",
                        canal.kind.label()
                    );
                    verifies += 1;
                }
            }
        }
        assert!(verifies > 0, "aucun canal décodable : la mesure ne prouverait rien");
    }

    /// Un état échantillonné doit tomber dans l'enveloppe du décodage direct. Si l'interpolation
    /// dépassait ses clés, les bornes s'élargiraient — et c'est exactement ce que ce test
    /// interdit.
    #[test]
    fn l_etat_reste_dans_l_enveloppe_des_cles() {
        let Some(anim) = charger(REEL) else {
            eprintln!("asset absent : test ignoré");
            return;
        };
        let piste = CameraTrack::nouvelle(&anim, 1).expect("objet 1");
        let (debut, fin) = piste.plage().expect("plage");

        // Enveloppe des clés, par axe, pour les seuls canaux décodables.
        let mut env = [(f32::MAX, f32::MIN); 3];
        for canal in anim.channels_of(1) {
            let axe = match canal.kind {
                ChannelKind::PosX => 0,
                ChannelKind::PosY => 1,
                ChannelKind::PosZ => 2,
                _ => continue,
            };
            if let Some(v) = canal.decoded(&anim) {
                for x in v {
                    env[axe].0 = env[axe].0.min(x);
                    env[axe].1 = env[axe].1.max(x);
                }
            }
        }

        let mut f = f32::from(debut);
        while f <= f32::from(fin) {
            let e = piste.etat(f);
            for (axe, (lo, hi)) in env.iter().enumerate() {
                if *lo <= *hi {
                    let v = e.etat.pos[axe];
                    assert!(
                        v >= lo - 1e-3 && v <= hi + 1e-3,
                        "frame {f} axe {axe} : {v} hors de [{lo}, {hi}]"
                    );
                }
            }
            f += 0.5;
        }
    }

    /// `fov` et `roll` ne doivent JAMAIS être écrits dans l'état tant que leur unité n'est pas
    /// prouvée. Ce test est là pour tomber si quelqu'un « branche » la conversion au jugé.
    #[test]
    fn le_fov_et_le_roll_ne_sont_pas_convertis_au_juge() {
        let Some(anim) = charger(REEL) else {
            eprintln!("asset absent : test ignoré");
            return;
        };
        let defaut = CameraState::default();
        for objet in 0..anim.object_count() {
            let piste = CameraTrack::nouvelle(&anim, objet).expect("objet");
            let e = piste.etat(1100.0);
            assert_eq!(e.etat.fov_deg, defaut.fov_deg, "fov_deg a été écrit sans preuve d'unité");
            assert_eq!(e.etat.roll_deg, defaut.roll_deg, "roll_deg a été écrit sans preuve d'unité");
        }
    }

    /// Toutes les tables de temps d'un fichier réel doivent être croissantes.
    ///
    /// ## Historique — ce test a d'abord épinglé un défaut, puis sa correction
    ///
    /// Écrit pour MESURER un défaut plutôt que pour le masquer, il constatait
    /// **10 canaux invalides sur 40** : `decode` alignait la table de temps sur `align` (16
    /// octets) au lieu de `align * 4` (64), ce qui la plaçait jusqu'à 48 octets trop tôt et
    /// décalait tous les `time_index`. Le symptôme était muet — les tranches sortaient
    /// décroissantes et un interpolateur les lisait à l'envers sans rien signaler.
    ///
    /// La correction est vérifiée sur le corpus : **1 215 / 1 215 fichiers** n'ont plus un seul
    /// canal décroissant, contre 714 fichiers atteints auparavant. Le compte attendu est donc
    /// passé de 10 à **0**, et ce test garde la trace du chemin.
    #[test]
    fn toutes_les_tables_de_temps_sont_croissantes() {
        let Some(anim) = charger(REEL) else {
            eprintln!("asset absent : test ignoré");
            return;
        };
        let (mut total, mut invalides) = (0u32, 0u32);
        for objet in 0..anim.object_count() {
            for canal in anim.channels_of(objet) {
                if canal.track.is_empty() {
                    continue;
                }
                total += 1;
                if !table_exploitable(canal.times(&anim)) {
                    invalides += 1;
                }
            }
        }
        assert!(total > 0, "aucun canal : la mesure ne prouverait rien");
        assert_eq!(
            (total, invalides),
            (40, 0),
            "une table de temps décroît de nouveau : l'alignement de la section a régressé"
        );
    }

    /// Hors des bornes, la valeur est MAINTENUE et non extrapolée : les clips ne sont pas
    /// contigus, donc une frame peut tomber dans un trou.
    #[test]
    fn hors_bornes_la_valeur_est_maintenue() {
        let Some(anim) = charger(REEL) else {
            eprintln!("asset absent : test ignoré");
            return;
        };
        let piste = CameraTrack::nouvelle(&anim, 0).expect("objet 0");
        let (debut, fin) = piste.plage().expect("plage");
        let avant = piste.etat(f32::from(debut) - 500.0);
        let au_debut = piste.etat(f32::from(debut));
        assert_eq!(avant.etat.pos, au_debut.etat.pos);
        let apres = piste.etat(f32::from(fin) + 500.0);
        let a_la_fin = piste.etat(f32::from(fin));
        assert_eq!(apres.etat.pos, a_la_fin.etat.pos);
    }
}
