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
/// # Erreurs
///
/// Rend un message si le G4TX n'est pas décodable ou si l'encodage échoue.
#[cfg(feature = "textures")]
pub fn g4tx_vers(g4tx: &[u8], format: ImageOut) -> Result<Vec<u8>, String> {
    let (w, h, rgba) = crate::g4tx_decode::decode_best_to_rgba(g4tx)
        .ok_or_else(|| "G4TX non décodable".to_string())?;
    encoder_rgba(&rgba, w, h, format)
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
