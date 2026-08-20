//! Encodage d'une image décodée vers les formats d'échange.
//!
//! Entrée unique : du RGBA8 (ce que rendent [`crate::g4tx_decode::decode_best_to_rgba`] et le
//! rendu). Sortie : PNG, WebP, GIF, JPEG, BMP, TGA, TIFF, QOI.
//!
//! ## Le PNG ne passe pas par `image`
//!
//! Le PNG produit par [`crate::g4tx_decode::encode_rgba_to_png`] (crate `png`) est **byte-identique
//! aux références publiées** sur `cdn.rosegriffon.fr` — c'est l'oracle de non-régression du
//! projet. Rien ne garantit qu'un autre encodeur choisisse les mêmes filtres ni le même niveau de
//! compression, donc le PNG garde son chemin historique et `image` ne sert qu'aux autres formats.
//! Le test `le_png_reste_sur_la_crate_png` verrouille cette règle.
//!
//! ## Sans perte, sauf JPEG
//!
//! WebP est encodé en **VP8L** (sans perte) : `image-webp` n'implémente que celui-là, ce qui tombe
//! bien — les assets du jeu sont des textures, pas des photos. GIF impose une palette de 256
//! couleurs : la conversion est donc destructrice pour une texture 32 bits, ce que
//! [`ImageOut::sans_perte`] annonce.

extern crate alloc;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use image::{ExtendedColorType, ImageEncoder};

/// Format d'image en sortie.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ImageOut {
    /// PNG (sans perte) — chemin historique, byte-exact contre les références publiées.
    Png,
    /// WebP sans perte (VP8L).
    Webp,
    /// GIF — palette de 256 couleurs, donc **avec perte** sur une texture 32 bits.
    Gif,
    /// JPEG — avec perte, qualité 90.
    Jpeg,
    /// BMP (sans perte).
    Bmp,
    /// TGA (sans perte).
    Tga,
    /// TIFF (sans perte).
    Tiff,
    /// QOI (sans perte).
    Qoi,
}

/// Qualité JPEG utilisée à l'encodage. 90 : le palier au-delà duquel le gain visuel ne paie plus
/// la taille, sur les textures du jeu comme ailleurs.
const QUALITE_JPEG: u8 = 90;

impl ImageOut {
    /// Extension de fichier canonique, sans le point.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            ImageOut::Png => "png",
            ImageOut::Webp => "webp",
            ImageOut::Gif => "gif",
            ImageOut::Jpeg => "jpg",
            ImageOut::Bmp => "bmp",
            ImageOut::Tga => "tga",
            ImageOut::Tiff => "tiff",
            ImageOut::Qoi => "qoi",
        }
    }

    /// `true` si l'encodage conserve exactement les pixels d'entrée.
    ///
    /// GIF quantifie sur 256 couleurs et JPEG est un codec à perte : les deux dégradent une
    /// texture RGBA8. Les autres restituent l'image à l'identique.
    #[must_use]
    pub const fn sans_perte(self) -> bool {
        !matches!(self, ImageOut::Gif | ImageOut::Jpeg)
    }

    /// `true` si le format transporte un canal alpha.
    ///
    /// JPEG n'en a pas : l'alpha est aplati sur du noir à l'encodage. Les textures du jeu étant
    /// très souvent détourées, c'est une raison de plus de préférer WebP.
    #[must_use]
    pub const fn garde_alpha(self) -> bool {
        !matches!(self, ImageOut::Jpeg)
    }

    /// Reconnaît un format depuis une extension ou un nom de format, insensible à la casse
    /// (`"webp"`, `".WebP"`, `"jpeg"` et `"jpg"` sont acceptés).
    #[must_use]
    pub fn depuis_extension(ext: &str) -> Option<Self> {
        let e = ext.trim().trim_start_matches('.').to_ascii_lowercase();
        Some(match e.as_str() {
            "png" => ImageOut::Png,
            "webp" => ImageOut::Webp,
            "gif" => ImageOut::Gif,
            "jpg" | "jpeg" => ImageOut::Jpeg,
            "bmp" => ImageOut::Bmp,
            "tga" => ImageOut::Tga,
            "tif" | "tiff" => ImageOut::Tiff,
            "qoi" => ImageOut::Qoi,
            _ => return None,
        })
    }

    /// Tous les formats gérés, dans l'ordre d'affichage de l'aide.
    pub const TOUS: [ImageOut; 8] = [
        ImageOut::Png,
        ImageOut::Webp,
        ImageOut::Gif,
        ImageOut::Jpeg,
        ImageOut::Bmp,
        ImageOut::Tga,
        ImageOut::Tiff,
        ImageOut::Qoi,
    ];
}

/// Encode une image RGBA8 vers `format`.
///
/// `rgba` doit contenir exactement `largeur × hauteur × 4` octets.
///
/// # Erreurs
///
/// Rend un message si les dimensions ne correspondent pas à la taille du tampon, ou si
/// l'encodeur échoue.
pub fn encoder_rgba(
    rgba: &[u8],
    largeur: u32,
    hauteur: u32,
    format: ImageOut,
) -> Result<Vec<u8>, String> {
    let attendu = (largeur as usize)
        .checked_mul(hauteur as usize)
        .and_then(|p| p.checked_mul(4))
        .ok_or_else(|| "dimensions hors bornes".to_string())?;
    if rgba.len() != attendu {
        return Err(alloc::format!(
            "tampon de {} octets pour {largeur}×{hauteur} RGBA (attendu {attendu})",
            rgba.len()
        ));
    }
    if largeur == 0 || hauteur == 0 {
        return Err("image de dimension nulle".to_string());
    }

    // Le PNG garde la crate `png` : c'est lui qui porte la garantie byte-exact.
    if format == ImageOut::Png {
        return crate::g4tx_decode::encode_rgba_to_png(rgba, largeur as usize, hauteur as usize)
            .ok_or_else(|| "échec de l'encodage PNG".to_string());
    }

    let mut sortie = Vec::new();
    let couleur = if format.garde_alpha() {
        ExtendedColorType::Rgba8
    } else {
        ExtendedColorType::Rgb8
    };

    // JPEG n'a pas d'alpha : on aplatit en RGB plutôt que de laisser l'encodeur refuser
    // l'entrée. Aplatir explicitement rend la perte visible ici, pas dans un message obscur.
    let rgb_aplati;
    let pixels: &[u8] = if format.garde_alpha() {
        rgba
    } else {
        rgb_aplati = aplatir_en_rgb(rgba);
        &rgb_aplati
    };

    let r = match format {
        ImageOut::Png => unreachable!("traité plus haut"),
        ImageOut::Webp => image::codecs::webp::WebPEncoder::new_lossless(&mut sortie)
            .write_image(pixels, largeur, hauteur, couleur),
        ImageOut::Gif => image::codecs::gif::GifEncoder::new(&mut sortie)
            .encode(pixels, largeur, hauteur, couleur),
        ImageOut::Jpeg => {
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut sortie, QUALITE_JPEG)
                .write_image(pixels, largeur, hauteur, couleur)
        }
        ImageOut::Bmp => image::codecs::bmp::BmpEncoder::new(&mut sortie)
            .write_image(pixels, largeur, hauteur, couleur),
        ImageOut::Tga => image::codecs::tga::TgaEncoder::new(&mut sortie)
            .write_image(pixels, largeur, hauteur, couleur),
        ImageOut::Tiff => image::codecs::tiff::TiffEncoder::new(std::io::Cursor::new(&mut sortie))
            .write_image(pixels, largeur, hauteur, couleur),
        ImageOut::Qoi => image::codecs::qoi::QoiEncoder::new(&mut sortie)
            .write_image(pixels, largeur, hauteur, couleur),
    };
    r.map_err(|e| alloc::format!("encodage {} : {e}", format.extension()))?;
    Ok(sortie)
}

/// Aplatit du RGBA8 en RGB8 en composant sur du noir (JPEG n'a pas de canal alpha).
fn aplatir_en_rgb(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        let a = u32::from(px[3]);
        for c in &px[..3] {
            rgb.push(((u32::from(*c) * a) / 255) as u8);
        }
    }
    rgb
}

/// Décode un `.g4tx` puis l'encode vers `format` — le chemin complet d'une conversion de texture.
///
/// `basename` = nom du fichier source sans dossier ni extension (cf.
/// [`crate::g4tx_decode::basename_of`]) : il départage les conteneurs qui portent plusieurs
/// textures. `""` reste licite quand l'appelant n'a que des octets.
///
/// # Erreurs
///
/// Rend un message si le G4TX n'est pas décodable ou si l'encodage échoue.
#[cfg(feature = "textures")]
pub fn g4tx_vers(g4tx: &[u8], basename: &str, format: ImageOut) -> Result<Vec<u8>, String> {
    let (w, h, rgba) = crate::g4tx_decode::decode_best_to_rgba(g4tx, basename)
        .ok_or_else(|| "G4TX non décodable".to_string())?;
    encoder_rgba(&rgba, w, h, format)
}

/// Décode les planches de couleur d'un conteneur de visage.
///
/// Un conteneur en porte souvent plusieurs, latéralisées (`eye_L_00` et `eye_R_00`), chacune
/// accompagnée d'un `<nom>msk` de mêmes dimensions.
///
/// **Le `msk` n'est PAS un masque d'opacité**, contrairement à ce que son nom laisse croire : sur
/// `face_00msk` comme sur `pupil_L_00msk`, il est uniforme à 0,5 (écart-type NUL). Le poser en
/// alpha rend toute la planche uniformément semi-transparente et fait disparaître les variations
/// — essayé, mesuré, abandonné. C'est vraisemblablement un paramètre constant de matériau, pas
/// une carte spatiale ; sa nature exacte reste à établir.
///
/// Les planches sont donc rendues telles quelles, avec l'alpha qu'elles portent — et elles n'en
/// portent pas toutes un utile : `pupil_00` a un vrai canal alpha, `eyebrow_00` est entièrement
/// transparente, `face_00`, `eye_00` et `mouth_00` sont entièrement opaques. **La règle qui
/// combine ces six familles n'est pas établie** ; les empiler en alpha ne la reproduit pas.
#[cfg(feature = "textures")]
#[must_use]
pub fn decoder_planches(g4tx: &[u8]) -> Vec<(u32, u32, Vec<u8>)> {
    crate::g4tx::base_color_texture_names(g4tx)
        .into_iter()
        .filter_map(|nom| crate::g4tx_decode::decode_named_to_rgba(g4tx, &nom))
        .collect()
}

/// Redimensionne une image RGBA vers une taille donnée, au plus proche voisin.
///
/// Sert à ramener les couches d'un visage à la toile commune. Le plus proche voisin suffit ici :
/// les planches partagent le dépliage, l'écart de définition n'est qu'un facteur entier ou proche.
#[cfg(feature = "textures")]
fn redimensionner_rgba(rgba: &[u8], w: u32, h: u32, vers_w: u32, vers_h: u32) -> Option<Vec<u8>> {
    if w == 0 || h == 0 || vers_w == 0 || vers_h == 0 {
        return None;
    }
    if rgba.len() < (w as usize) * (h as usize) * 4 {
        return None;
    }
    let mut out = vec![0u8; (vers_w as usize) * (vers_h as usize) * 4];
    for y in 0..vers_h {
        let sy = (u64::from(y) * u64::from(h) / u64::from(vers_h)).min(u64::from(h) - 1) as usize;
        for x in 0..vers_w {
            let sx =
                (u64::from(x) * u64::from(w) / u64::from(vers_w)).min(u64::from(w) - 1) as usize;
            let src = (sy * w as usize + sx) * 4;
            let dst = (y as usize * vers_w as usize + x as usize) * 4;
            out[dst..dst + 4].copy_from_slice(&rgba[src..src + 4]);
        }
    }
    Some(out)
}

/// Vrai si cette couche RGBA est opaque partout — auquel cas, composée par-dessus, elle masque
/// tout ce qui précède.
///
/// Les planches de `_facetex` sont dans ce cas presque toutes (`face_00`, `eye_00`, `mouth_00`,
/// `highlight_00`), ce qui rend la composition alpha inopérante entre elles : seule la dernière
/// survit. C'est ainsi que plusieurs familles de traits restaient sans effet. L'appelant s'en
/// sert pour le SIGNALER plutôt que de perdre des couches en silence.
#[cfg(feature = "textures")]
#[must_use]
pub fn couche_totalement_opaque(rgba: &[u8]) -> bool {
    !rgba.is_empty() && rgba.iter().skip(3).step_by(4).all(|&a| a == 255)
}

/// Compose des couches RGBA par-dessus la première, en mélange alpha classique.
///
/// C'est ainsi que le visage d'un avatar se fabrique : le jeu ne stocke pas une texture par
/// combinaison, il empile des planches qui partagent le même dépliage UV — la peau
/// (`_facetex/00_face/face_NN`), puis les yeux, les pupilles, les reflets, les sourcils et la
/// bouche. Chaque rubrique de l'éditeur choisit **une** planche de sa famille ; le résultat est
/// cette composition, et c'est elle qui change quand le joueur change de choix.
///
/// La taille retenue est celle de la **plus grande** couche, et non celle de la première.
///
/// Seules les couches de **même rapport largeur/hauteur** sont composées : un rapport différent
/// est un autre dépliage UV, et les superposer placerait les traits n'importe où sur le visage.
/// Une couche au bon rapport mais plus petite est agrandie.
///
/// **L'appelant doit donc grouper les couches par dépliage avant d'appeler cette fonction.** Les
/// planches de `_facetex` en ont deux — la peau, les pupilles et les reflets sont en 512×512, les
/// yeux, les sourcils et la bouche en 2048×1024 — et tout mélanger revenait à en perdre la moitié
/// en silence, dont les pupilles, la seule à porter un dessin. Chaque dépliage donne une texture,
/// et chaque matériau de la tête en reçoit une.
///
/// Les planches de `_facetex` étant OPAQUES, leur alpha doit avoir été posé au préalable depuis
/// leur masque compagnon — cf. [`decoder_planches_masquees`]. Sans cela, la composition ne rend
/// que la dernière couche.
///
/// Rend `None` si la liste est vide ou si aucune couche n'est exploitable.
#[cfg(feature = "textures")]
#[must_use]
pub fn composer_couches(couches: &[(u32, u32, Vec<u8>)]) -> Option<(u32, u32, Vec<u8>)> {
    // La plus grande couche donne la toile ; son rapport donne le dépliage de référence.
    let (largeur, hauteur, _) = *couches
        .iter()
        .filter(|(w, h, d)| *w > 0 && *h > 0 && d.len() >= (*w as usize) * (*h as usize) * 4)
        .max_by_key(|(w, h, _)| u64::from(*w) * u64::from(*h))?;
    let attendu = largeur as usize * hauteur as usize * 4;
    let rapport = f64::from(largeur) / f64::from(hauteur);
    let mut sortie = vec![0u8; attendu];

    for (rang, (lw, lh, couche)) in couches.iter().enumerate() {
        if *lw == 0 || *lh == 0 || couche.len() < (*lw as usize) * (*lh as usize) * 4 {
            continue;
        }
        let _ = rang;
        // Un autre rapport = un autre dépliage UV : on ne le plaque pas sur ce visage.
        if (f64::from(*lw) / f64::from(*lh) - rapport).abs() > 0.01 {
            continue;
        }
        let ajustee = if (*lw, *lh) == (largeur, hauteur) {
            couche.clone()
        } else {
            match redimensionner_rgba(couche, *lw, *lh, largeur, hauteur) {
                Some(r) => r,
                None => continue,
            }
        };
        if ajustee.len() < attendu {
            continue;
        }
        for i in (0..attendu).step_by(4) {
            let a = f32::from(ajustee[i + 3]) / 255.0;
            if a <= 0.0 {
                continue;
            }
            for c in 0..3 {
                let dessus = f32::from(ajustee[i + c]);
                let dessous = f32::from(sortie[i + c]);
                sortie[i + c] = (dessus * a + dessous * (1.0 - a)).round().clamp(0.0, 255.0) as u8;
            }
            let a_dessous = f32::from(sortie[i + 3]) / 255.0;
            sortie[i + 3] = ((a + a_dessous * (1.0 - a)) * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    Some((largeur, hauteur, sortie))
}

/// Réduit une image RGBA8 pour que son plus grand côté n'excède pas `max_cote`, par **moyenne de
/// boîte** (chaque pixel de sortie est la moyenne des pixels source qu'il recouvre).
///
/// Rend l'image telle quelle si elle tient déjà dans la boîte : une vignette ne doit jamais
/// agrandir, ni recompresser pour rien.
///
/// Le filtre est une moyenne, pas un échantillonnage au plus proche : sur les atlas d'icônes du
/// jeu (traits d'un pixel sur fond transparent), le plus proche fait disparaître les traits alors
/// que la moyenne les garde. La moyenne est pondérée par l'alpha prémultiplié — sans ça, les
/// pixels transparents (dont le RGB est arbitraire dans une texture détourée) tirent la couleur
/// des bords vers du noir, et la vignette d'une icône se retrouve cernée.
///
/// # Erreurs
///
/// Rend un message si `rgba` ne fait pas `largeur × hauteur × 4` octets, si une dimension est
/// nulle, ou si `max_cote` est nul.
pub fn reduire_rgba(
    rgba: &[u8],
    largeur: u32,
    hauteur: u32,
    max_cote: u32,
) -> Result<(u32, u32, Vec<u8>), String> {
    let attendu = (largeur as usize)
        .checked_mul(hauteur as usize)
        .and_then(|p| p.checked_mul(4))
        .ok_or_else(|| "dimensions hors bornes".to_string())?;
    if rgba.len() != attendu {
        return Err(alloc::format!(
            "tampon de {} octets pour {largeur}×{hauteur} RGBA (attendu {attendu})",
            rgba.len()
        ));
    }
    if largeur == 0 || hauteur == 0 {
        return Err("image de dimension nulle".to_string());
    }
    if max_cote == 0 {
        return Err("côté maximal nul".to_string());
    }

    let cote = largeur.max(hauteur);
    if cote <= max_cote {
        return Ok((largeur, hauteur, rgba.to_vec()));
    }

    // Dimensions cibles en conservant le rapport, au moins 1 pixel : une bande de 2048×8 réduite
    // à 128 donnerait 0 en hauteur par simple division.
    let nw = ((largeur as u64 * max_cote as u64) / cote as u64).max(1) as u32;
    let nh = ((hauteur as u64 * max_cote as u64) / cote as u64).max(1) as u32;

    let mut out = Vec::with_capacity((nw as usize) * (nh as usize) * 4);
    for y in 0..nh {
        // Bornes de la boîte source, en arithmétique entière : pas de flottant, donc le résultat
        // ne dépend pas de la plateforme.
        let y0 = ((y as u64 * hauteur as u64) / nh as u64) as usize;
        let y1 = (((y as u64 + 1) * hauteur as u64) / nh as u64).max(y0 as u64 + 1) as usize;
        for x in 0..nw {
            let x0 = ((x as u64 * largeur as u64) / nw as u64) as usize;
            let x1 = (((x as u64 + 1) * largeur as u64) / nw as u64).max(x0 as u64 + 1) as usize;

            let (mut r, mut g, mut b, mut a) = (0u64, 0u64, 0u64, 0u64);
            let mut n = 0u64;
            for sy in y0..y1.min(hauteur as usize) {
                let ligne = sy * largeur as usize;
                for sx in x0..x1.min(largeur as usize) {
                    let p = (ligne + sx) * 4;
                    let alpha = u64::from(rgba[p + 3]);
                    // Prémultiplication : la couleur d'un pixel transparent ne doit pas peser.
                    r += u64::from(rgba[p]) * alpha;
                    g += u64::from(rgba[p + 1]) * alpha;
                    b += u64::from(rgba[p + 2]) * alpha;
                    a += alpha;
                    n += 1;
                }
            }
            if n == 0 {
                out.extend_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            // Démultiplication : `a` est la somme des alphas, donc diviser par elle rend la
            // couleur moyenne *visible*. `a == 0` (boîte entièrement transparente) n'a pas de
            // couleur moyenne — et diviser par elle serait une division par zéro.
            match (r.checked_div(a), g.checked_div(a), b.checked_div(a)) {
                (Some(r), Some(g), Some(b)) => {
                    out.push(r as u8);
                    out.push(g as u8);
                    out.push(b as u8);
                    out.push((a / n) as u8);
                }
                _ => out.extend_from_slice(&[0, 0, 0, 0]),
            }
        }
    }
    Ok((nw, nh, out))
}

/// Décode un `.g4tx` et l'encode en vignette : plus grand côté borné à `max_cote`, format libre.
///
/// C'est le chemin des grilles de fichiers (explorateur, navigateur de contenu de l'éditeur) :
/// une texture de personnage décode en 2048×2048 RGBA (16 Mio en mémoire, plusieurs centaines de
/// kio en PNG), or la vignette affichée fait moins de 100 pixels. Servir la pleine résolution à
/// une grille de plusieurs milliers d'entrées sature la mémoire du client bien avant l'écran.
///
/// `basename` : même rôle que dans [`g4tx_vers`] (départage les conteneurs multi-textures).
///
/// # Erreurs
///
/// Rend un message si le G4TX n'est pas décodable, si la réduction échoue ou si l'encodage échoue.
#[cfg(feature = "textures")]
pub fn g4tx_vignette(g4tx: &[u8], basename: &str, max_cote: u32, format: ImageOut) -> Result<Vec<u8>, String> {
    let (w, h, rgba) = crate::g4tx_decode::decode_best_to_rgba(g4tx, basename)
        .ok_or_else(|| "G4TX non décodable".to_string())?;
    let (vw, vh, petit) = reduire_rgba(&rgba, w, h, max_cote)?;
    encoder_rgba(&petit, vw, vh, format)
}

/// Vignette d'une texture **nommée** d'un conteneur G4TX (cf.
/// [`crate::g4tx_decode::decode_named_to_rgba`]).
///
/// [`g4tx_vignette`] rend UNE image par fichier : la texture principale. Elle ne peut donc pas
/// servir une grille des 80 icônes que porte `icon_item05.g4tx`, où chaque nom a son propre
/// payload. `nom` désigne soit une texture principale, soit une région d'atlas — la sélection est
/// la même que celle du décodage nommé, la réduction se fait ici avant l'IPC.
pub fn g4tx_vignette_nommee(
    g4tx: &[u8],
    nom: &str,
    max_cote: u32,
    format: ImageOut,
) -> Result<Vec<u8>, String> {
    let (w, h, rgba) = crate::g4tx_decode::decode_named_to_rgba(g4tx, nom)
        .ok_or_else(|| format!("texture `{nom}` absente du conteneur G4TX"))?;
    let (vw, vh, petit) = reduire_rgba(&rgba, w, h, max_cote)?;
    encoder_rgba(&petit, vw, vh, format)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une couche RGBA unie de 2×2.
    #[cfg(feature = "textures")]
    fn couche(r: u8, v: u8, b: u8, a: u8) -> (u32, u32, Vec<u8>) {
        (2, 2, [r, v, b, a].repeat(4))
    }

    #[cfg(feature = "textures")]
    #[test]
    fn une_couche_opaque_recouvre_le_fond() {
        let out = composer_couches(&[couche(255, 0, 0, 255), couche(0, 0, 255, 255)]).unwrap();
        assert_eq!(&out.2[..4], &[0, 0, 255, 255]);
    }

    #[cfg(feature = "textures")]
    #[test]
    fn une_couche_transparente_laisse_le_fond_intact() {
        let out = composer_couches(&[couche(255, 0, 0, 255), couche(0, 0, 255, 0)]).unwrap();
        assert_eq!(&out.2[..4], &[255, 0, 0, 255]);
    }

    #[cfg(feature = "textures")]
    #[test]
    fn une_couche_a_moitie_transparente_melange_les_deux() {
        // 128/255 ≈ 0,502 : le résultat doit tomber entre les deux couleurs, pas sur l'une d'elles.
        let out = composer_couches(&[couche(0, 0, 0, 255), couche(255, 255, 255, 128)]).unwrap();
        assert!((126..=129).contains(&out.2[0]), "obtenu {}", out.2[0]);
    }

    /// Une couche RGBA unie de dimensions données.
    #[cfg(feature = "textures")]
    fn couche_wh(w: u32, h: u32, r: u8, v: u8, b: u8, a: u8) -> (u32, u32, Vec<u8>) {
        (w, h, [r, v, b, a].repeat((w * h) as usize))
    }

    #[cfg(feature = "textures")]
    #[test]
    fn la_toile_prend_la_taille_de_la_plus_grande_couche() {
        // Le cas réel : la peau fait 512×512, les traits 2048×1024. Se caler sur la PREMIÈRE
        // couche jetait silencieusement toutes les autres — c'était le défaut.
        let out = composer_couches(&[
            couche_wh(4, 2, 255, 0, 0, 255),
            couche_wh(8, 4, 0, 255, 0, 255),
        ])
        .unwrap();
        assert_eq!((out.0, out.1), (8, 4));
        assert_eq!(&out.2[..4], &[0, 255, 0, 255]);
    }

    #[cfg(feature = "textures")]
    #[test]
    fn une_couche_d_un_autre_rapport_est_ecartee() {
        // Un rapport différent est un autre dépliage UV : la plaquer placerait les traits
        // n'importe où sur le visage. C'est à l'appelant de grouper par dépliage AVANT d'appeler
        // — ne pas le faire coûtait la moitié des planches du visage, en silence.
        let out = composer_couches(&[
            couche_wh(8, 4, 255, 0, 0, 255),
            couche_wh(4, 4, 0, 255, 0, 255),
        ])
        .unwrap();
        assert_eq!((out.0, out.1), (8, 4));
        assert_eq!(&out.2[..4], &[255, 0, 0, 255], "la couche carrée ne doit pas être composée");
    }

    /// Les six familles de `_facetex` doivent TOUTES pouvoir peser sur le visage composé.
    ///
    /// Le défaut que ce test verrouille : la peau, les pupilles et les reflets sont en 512×512
    /// tandis que les yeux, les sourcils et la bouche sont en 2048×1024. Composer les six sur une
    /// toile unique écartait les trois premières en silence — changer de peau ou de pupille ne
    /// changeait alors pas un octet du rendu. Il faut composer UN visage PAR DÉPLIAGE.
    #[cfg(all(feature = "textures", feature = "images"))]
    #[test]
    fn chaque_depliage_de_visage_est_compose_a_part() {
        use crate::vfs::Vfs;

        let mut vfs = Vfs::new();
        if vfs.init(crate::vfs::resolve_game_dir().join("data")).is_err() {
            eprintln!("SKIP : VFS non initialisable");
            return;
        }
        let lire = |vfs: &Vfs, rel: &str| {
            vfs.read(&format!("data/dx11/chr/_face/20_EDIT/_facetex/{rel}.g4tx")).ok()
        };

        // Une planche de chaque dépliage, et une seconde peau pour prouver que la variation passe.
        let (Some(peau_a), Some(peau_b), Some(bouche)) = (
            lire(&vfs, "00_face/face_00"),
            lire(&vfs, "00_face/face_34"),
            lire(&vfs, "05_mouth/mouth_00"),
        ) else {
            eprintln!("SKIP : planches de visage absentes");
            return;
        };

        let pa = decoder_planches(&peau_a);
        let pb = decoder_planches(&peau_b);
        let bo = decoder_planches(&bouche);
        assert!(!pa.is_empty() && !pb.is_empty() && !bo.is_empty(), "planches décodées");

        // Les deux dépliages sont bien distincts : c'est la prémisse du défaut.
        assert_ne!(
            (pa[0].0, pa[0].1),
            (bo[0].0, bo[0].1),
            "la peau et la bouche doivent avoir des dépliages différents"
        );

        // Composées ensemble, la peau disparaît : la toile prend le plus grand dépliage.
        let melange_a = composer_couches(&[pa[0].clone(), bo[0].clone()]).expect("composition");
        let melange_b = composer_couches(&[pb[0].clone(), bo[0].clone()]).expect("composition");
        assert_eq!(
            melange_a.2, melange_b.2,
            "tout mélanger doit bien écraser la peau — c'est le piège que le groupement évite"
        );

        // Groupées par dépliage, les deux peaux restent distinctes.
        let seule_a = composer_couches(&[pa[0].clone()]).expect("composition");
        let seule_b = composer_couches(&[pb[0].clone()]).expect("composition");
        assert_ne!(
            seule_a.2, seule_b.2,
            "deux peaux différentes doivent donner deux compositions différentes"
        );
    }

    #[cfg(feature = "textures")]
    #[test]
    fn sans_couche_il_n_y_a_rien_a_composer() {
        assert!(composer_couches(&[]).is_none());
    }

    /// Damier RGBA 4×4 avec de l'alpha, pour exercer les chemins avec et sans canal alpha.
    fn damier() -> (u32, u32, Vec<u8>) {
        let (w, h) = (4u32, 4u32);
        let mut rgba = Vec::with_capacity(64);
        for y in 0..h {
            for x in 0..w {
                let clair = (x + y) % 2 == 0;
                rgba.extend_from_slice(&[
                    if clair { 255 } else { 0 },
                    u8::try_from(x * 60).unwrap_or(255),
                    u8::try_from(y * 60).unwrap_or(255),
                    if clair { 255 } else { 128 },
                ]);
            }
        }
        (w, h, rgba)
    }

    #[test]
    fn chaque_format_produit_un_fichier_non_vide() {
        let (w, h, rgba) = damier();
        for f in ImageOut::TOUS {
            let out = encoder_rgba(&rgba, w, h, f).unwrap_or_else(|e| panic!("{f:?} : {e}"));
            assert!(!out.is_empty(), "{f:?} : sortie vide");
        }
    }

    #[test]
    fn les_magics_de_sortie_sont_conformes() {
        let (w, h, rgba) = damier();
        let magic = |f: ImageOut| encoder_rgba(&rgba, w, h, f).unwrap();
        assert_eq!(&magic(ImageOut::Png)[..8], b"\x89PNG\r\n\x1a\n");
        let webp = magic(ImageOut::Webp);
        assert_eq!(&webp[..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
        assert_eq!(&webp[12..16], b"VP8L", "WebP doit être sans perte (VP8L)");
        assert_eq!(&magic(ImageOut::Gif)[..6], b"GIF89a");
        assert_eq!(&magic(ImageOut::Jpeg)[..3], &[0xFF, 0xD8, 0xFF]);
        assert_eq!(&magic(ImageOut::Bmp)[..2], b"BM");
        assert_eq!(&magic(ImageOut::Qoi)[..4], b"qoif");
    }

    /// Le PNG doit rester produit par la crate `png` : c'est lui qui porte l'égalité à l'octet
    /// avec les références publiées. Si ce test tombe, l'oracle de non-régression est perdu.
    #[test]
    fn le_png_reste_sur_la_crate_png() {
        let (w, h, rgba) = damier();
        let par_image_out = encoder_rgba(&rgba, w, h, ImageOut::Png).unwrap();
        let par_chemin_historique =
            crate::g4tx_decode::encode_rgba_to_png(&rgba, w as usize, h as usize).unwrap();
        assert_eq!(par_image_out, par_chemin_historique);
    }

    #[test]
    fn les_dimensions_incoherentes_sont_refusees() {
        let (w, h, rgba) = damier();
        assert!(encoder_rgba(&rgba, w + 1, h, ImageOut::Png).is_err());
        assert!(encoder_rgba(&rgba, 0, 0, ImageOut::Png).is_err());
        assert!(reduire_rgba(&rgba, w + 1, h, 2).is_err());
        assert!(reduire_rgba(&rgba, w, h, 0).is_err());
    }

    #[test]
    fn une_image_deja_petite_traverse_la_reduction_intacte() {
        let (w, h, rgba) = damier();
        let (nw, nh, out) = reduire_rgba(&rgba, w, h, 64).unwrap();
        assert_eq!((nw, nh), (w, h));
        assert_eq!(out, rgba, "aucune vignette ne doit agrandir ni recompresser");
    }

    #[test]
    fn la_reduction_borne_le_plus_grand_cote_et_garde_le_rapport() {
        // Bande large : c'est le cas qui casse une division naïve (hauteur ramenée à 0).
        let (w, h) = (400u32, 5u32);
        let rgba = alloc::vec![200u8; (w * h * 4) as usize];
        let (nw, nh, out) = reduire_rgba(&rgba, w, h, 100).unwrap();
        assert_eq!(nw, 100);
        assert!(nh >= 1, "une dimension ne doit jamais tomber à zéro");
        assert_eq!(out.len(), (nw * nh * 4) as usize);
    }

    /// Une couleur uniforme doit traverser la moyenne sans dériver : c'est le test qui attrape
    /// une erreur de pondération (somme non divisée, alpha compté deux fois…).
    #[test]
    fn une_image_uniforme_reste_de_la_meme_couleur() {
        let (w, h) = (64u32, 64u32);
        let mut rgba = Vec::new();
        for _ in 0..(w * h) {
            rgba.extend_from_slice(&[10, 120, 230, 255]);
        }
        let (_, _, out) = reduire_rgba(&rgba, w, h, 8).unwrap();
        for px in out.chunks_exact(4) {
            assert_eq!(px, [10, 120, 230, 255]);
        }
    }

    /// Moitié opaque rouge, moitié transparente (RGB arbitraire) : la vignette doit rester rouge.
    /// Sans prémultiplication par l'alpha, le noir des pixels transparents assombrirait le bord.
    #[test]
    fn les_pixels_transparents_ne_teintent_pas_la_vignette() {
        let (w, h) = (16u32, 16u32);
        let mut rgba = Vec::new();
        for y in 0..h {
            for _ in 0..w {
                if y < h / 2 {
                    rgba.extend_from_slice(&[255, 0, 0, 255]);
                } else {
                    rgba.extend_from_slice(&[0, 0, 0, 0]); // transparent, couleur arbitraire
                }
            }
        }
        let (_, _, out) = reduire_rgba(&rgba, w, h, 2).unwrap();
        // Ligne du haut : rouge pur, pas un rouge assombri par les voisins transparents.
        assert_eq!(&out[..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn extensions_et_proprietes() {
        assert_eq!(ImageOut::depuis_extension("WEBP"), Some(ImageOut::Webp));
        assert_eq!(ImageOut::depuis_extension(".jpeg"), Some(ImageOut::Jpeg));
        assert_eq!(ImageOut::depuis_extension("jpg"), Some(ImageOut::Jpeg));
        assert_eq!(ImageOut::depuis_extension("tif"), Some(ImageOut::Tiff));
        assert_eq!(ImageOut::depuis_extension("psd"), None);

        assert!(ImageOut::Webp.sans_perte());
        assert!(ImageOut::Png.sans_perte());
        assert!(!ImageOut::Gif.sans_perte(), "GIF quantifie sur 256 couleurs");
        assert!(!ImageOut::Jpeg.sans_perte());
        assert!(!ImageOut::Jpeg.garde_alpha());
        assert!(ImageOut::Webp.garde_alpha());
    }

    /// L'aller-retour WebP doit rendre les pixels d'origine : c'est ce que « sans perte » veut
    /// dire, et ça se vérifie plutôt que ça ne se déclare.
    #[test]
    fn le_webp_sans_perte_restitue_les_pixels() {
        let (w, h, rgba) = damier();
        let webp = encoder_rgba(&rgba, w, h, ImageOut::Webp).unwrap();
        let relu = image::load_from_memory_with_format(&webp, image::ImageFormat::WebP)
            .expect("relecture WebP")
            .to_rgba8();
        assert_eq!(relu.dimensions(), (w, h));
        assert_eq!(relu.as_raw().as_slice(), rgba.as_slice(), "VP8L doit être exact");
    }
}
