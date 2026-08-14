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
