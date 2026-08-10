//! Décodage des textures **G4TX / DDS → RGBA8 / PNG** — *source unique* du workspace.
//!
//! Phase 1b de `docs/DEDUP-PLAN.md` : ce module enrobe la variante **la plus complète**
//! (celle de `nie-model-serve`) et remplace les 4 copies divergentes (model-serve, wasm, ffi,
//! game). On **enrobe sans réécrire** la logique de décodage validée en prod sur le CDN.
//!
//! Trois familles d'en-tête DDS rencontrées dans IEVR sont gérées :
//! - extension **DX10** : `dxgiFormat` (BC1..BC7) aux 4 octets suivant le `DDS_HEADER` ;
//! - **FourCC legacy** : `DXT1/3/5`, `ATI1/2` (= BC4/BC5), sans extension DX10 ;
//! - **non compressé** 32 bpp : RGBA8 / BGRA8 distingués par les masques du `DDS_PIXELFORMAT`.
//!
//! Le sélecteur anti-dummy [`crate::g4tx::select_main_texture`] est réutilisé (et non un
//! `max_by_key` ad hoc) pour choisir la texture principale réelle d'un atlas.
//!
//! ## Pourquoi derrière la feature `textures` (off par défaut)
//!
//! Le décodage tire `image_dds` (std). `nie-formats` est no_std-friendly + wasm-portable :
//! gater ce module derrière la feature Cargo `textures` préserve le build no_std/wasm par
//! défaut. `image_dds` en `default-features = false` compile bien en wasm32 (cf. `nie-wasm`).
#![cfg(feature = "textures")]

use image_dds::{ImageFormat, Surface};

use crate::g4tx::{self, G4txTexture};

/// Magic DDS (`"DDS "`, LE `0x2053_4444`).
const DDS_MAGIC: u32 = 0x2053_4444;

/// Table de correspondance DXGI format → `image_dds::ImageFormat` (BC1..BC7).
#[must_use]
pub fn dxgi_to_image_format(dxgi: u32) -> Option<ImageFormat> {
    match dxgi {
        // BC1
        71 => Some(ImageFormat::BC1RgbaUnorm),
        72 => Some(ImageFormat::BC1RgbaUnormSrgb),
        // BC2
        73 => Some(ImageFormat::BC2RgbaUnorm),
        74 => Some(ImageFormat::BC2RgbaUnormSrgb),
        // BC3
        77 => Some(ImageFormat::BC3RgbaUnorm),
        78 => Some(ImageFormat::BC3RgbaUnormSrgb),
        // BC4
        79 | 80 => Some(ImageFormat::BC4RUnorm),
        // BC5
        83 | 84 => Some(ImageFormat::BC5RgUnorm),
        // BC6H
        95 => Some(ImageFormat::BC6hRgbUfloat),
        96 => Some(ImageFormat::BC6hRgbSfloat),
        // BC7
        98 => Some(ImageFormat::BC7RgbaUnorm),
        99 => Some(ImageFormat::BC7RgbaUnormSrgb),
        _ => None,
    }
}

/// FourCC legacy (`DDS_PIXELFORMAT.dwFourCC`, sans extension DX10) → `image_dds::ImageFormat`.
///
/// L'outillage Level-5 écrit certaines textures (visages `_face/*/_base`, mips de secours)
/// en DDS **legacy** (DXT1/3/5, ATI1/2 = BC4/BC5) au lieu de l'extension DX10. `DXT1` est
/// décodé comme `BC1RgbaUnorm` (le bit alpha 1-bit est porté par le bloc lui-même).
#[must_use]
pub fn fourcc_to_image_format(fourcc: &[u8; 4]) -> Option<ImageFormat> {
    match fourcc {
        b"DXT1" => Some(ImageFormat::BC1RgbaUnorm),
        b"DXT2" | b"DXT3" => Some(ImageFormat::BC2RgbaUnorm),
        b"DXT4" | b"DXT5" => Some(ImageFormat::BC3RgbaUnorm),
        b"ATI1" | b"BC4U" => Some(ImageFormat::BC4RUnorm),
        b"ATI2" | b"BC5U" => Some(ImageFormat::BC5RgUnorm),
        _ => None,
    }
}

/// Détermine `(format image_dds, offset des pixels)` depuis un DDS brut (slice débutant au
/// magic `DDS `). Gère les **trois** familles d'en-tête :
/// - **extension DX10** : `dxgiFormat` aux 4 octets suivant le `DDS_HEADER` (offset 128),
///   pixels après l'extension de 20 octets (offset 148) ;
/// - **legacy FourCC** : format lu dans `DDS_PIXELFORMAT.dwFourCC`, pixels juste après le
///   `DDS_HEADER` (offset 128) ;
/// - **non compressé** : masques RGB du `DDS_PIXELFORMAT`, pixels à l'offset 128.
///
/// Offsets `DDS_HEADER` (124 o) + `DDS_PIXELFORMAT` (ddspf à l'offset fichier 76) conformes à
/// la spec Microsoft DDS.
#[must_use]
pub fn dds_format_and_pixel_offset(dds_slice: &[u8]) -> Option<(ImageFormat, usize)> {
    const HDR_END: usize = 4 + 124; // magic(4) + DDS_HEADER(124) = 128
    const DX10_PIXELS: usize = HDR_END + 20; // + DDS_HEADER_DXT10(20) = 148
    // Offsets fichier dans DDS_PIXELFORMAT (struct à l'offset 76 : 4 magic + 72 dans le header).
    const PF_FLAGS: usize = 80;
    const PF_FOURCC: usize = 84;
    const PF_BITCOUNT: usize = 88;
    const PF_RMASK: usize = 92;
    const PF_BMASK: usize = 100;
    const DDPF_FOURCC: u32 = 0x4;
    const DDPF_RGB: u32 = 0x40;

    if dds_slice.len() < HDR_END {
        return None;
    }
    let pf_flags = u32::from_le_bytes(dds_slice[PF_FLAGS..PF_FLAGS + 4].try_into().ok()?);
    let fourcc: [u8; 4] = dds_slice[PF_FOURCC..PF_FOURCC + 4].try_into().ok()?;

    if pf_flags & DDPF_FOURCC != 0 {
        if &fourcc == b"DX10" {
            if dds_slice.len() < DX10_PIXELS {
                return None;
            }
            let dxgi = u32::from_le_bytes(dds_slice[HDR_END..HDR_END + 4].try_into().ok()?);
            return dxgi_to_image_format(dxgi).map(|f| (f, DX10_PIXELS));
        }
        return fourcc_to_image_format(&fourcc).map(|f| (f, HDR_END));
    }

    if pf_flags & DDPF_RGB != 0 {
        // Non compressé : bitcount + masques distinguent BGRA8/RGBA8 (cas 32 bpp Level-5).
        let bitcount = u32::from_le_bytes(dds_slice[PF_BITCOUNT..PF_BITCOUNT + 4].try_into().ok()?);
        let r_mask = u32::from_le_bytes(dds_slice[PF_RMASK..PF_RMASK + 4].try_into().ok()?);
        let b_mask = u32::from_le_bytes(dds_slice[PF_BMASK..PF_BMASK + 4].try_into().ok()?);
        if bitcount == 32 {
            // R en octet bas (0x0000_00ff) ⇒ RGBA ; sinon B en octet bas ⇒ BGRA (défaut L5).
            let fmt = if r_mask == 0x0000_00ff && b_mask == 0x00ff_0000 {
                ImageFormat::Rgba8Unorm
            } else {
                ImageFormat::Bgra8Unorm
            };
            return Some((fmt, HDR_END));
        }
    }
    None
}

/// Décode une entrée `G4txTexture` (payload DDS) en RGBA8 brut `(w, h, data)`.
///
/// Couvre DX10 + FourCC legacy + non compressé. Renvoie `None` si la texture n'est pas DDS,
/// si le payload est tronqué, si le magic `DDS ` est absent, ou si le format n'est pas géré.
#[must_use]
pub fn decode_texture_rgba(g4tx_data: &[u8], tex: &G4txTexture) -> Option<(u32, u32, Vec<u8>)> {
    if !tex.is_dds {
        return None;
    }

    let offset = tex.data_offset;
    const HDR_END: usize = 4 + 124; // magic(4) + DDS_HEADER(124) = 128

    if offset + HDR_END > g4tx_data.len() {
        return None;
    }

    let dds_slice = g4tx_data.get(offset..)?;

    // Vérifie le magic DDS.
    let magic = u32::from_le_bytes(dds_slice.get(..4)?.try_into().ok()?);
    if magic != DDS_MAGIC {
        return None;
    }

    // Résout le format ET l'offset des pixels (DX10 @148 ou legacy/uncompressed @128).
    let (image_format, pixel_offset) = dds_format_and_pixel_offset(dds_slice)?;

    let w = tex.width as u32;
    let h = tex.height as u32;
    if w == 0 || h == 0 {
        return None;
    }

    if pixel_offset > dds_slice.len() {
        return None;
    }
    let pixel_data = dds_slice.get(pixel_offset..)?;

    // Construit une `Surface` image_dds avec mip0 seulement.
    let surface = Surface {
        width: w,
        height: h,
        depth: 1,
        layers: 1,
        mipmaps: 1,
        image_format,
        data: pixel_data,
    };

    let rgba = surface.decode_rgba8().ok()?;
    Some((w, h, rgba.data))
}

/// Décode la texture principale **réelle** d'un G4TX en RGBA8 `(w, h, data)`.
///
/// Parse le conteneur puis sélectionne la texture via [`crate::g4tx::select_main_texture`]
/// (anti-dummy) plutôt qu'un `max_by_key` ad hoc : sans nom de référence (`""`), la stratégie
/// retombe directement sur la plus grande texture DDS **non dummy**.
#[must_use]
pub fn decode_best_to_rgba(g4tx_data: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let parsed = g4tx::parse(g4tx_data).ok()?;
    let tex = g4tx::select_main_texture(&parsed, "")?;
    decode_texture_rgba(g4tx_data, tex)
}

/// Variante PNG de [`decode_best_to_rgba`] : décode la texture principale et la réencode en PNG.
#[must_use]
pub fn decode_best_to_png(g4tx_data: &[u8]) -> Option<Vec<u8>> {
    let (w, h, rgba) = decode_best_to_rgba(g4tx_data)?;
    encode_rgba_to_png(&rgba, w as usize, h as usize)
}

/// Encode un buffer RGBA8 brut en PNG (8 bits, RGBA).
#[must_use]
pub fn encode_rgba_to_png(rgba: &[u8], w: usize, h: usize) -> Option<Vec<u8>> {
    let mut out_buf: Vec<u8> = Vec::with_capacity(w * h);
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut out_buf), w as u32, h as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out_buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit un en-tête DDS minimal (magic + DDS_HEADER de 124 o, + extension si DX10),
    /// avec `ddspf.flags`/`fourCC` posés aux offsets spec. Suffit à tester la résolution
    /// de format ; aucune donnée de pixels réelle requise.
    fn dds_header(pf_flags: u32, fourcc: &[u8; 4], extra: &[(usize, u32)], len: usize) -> Vec<u8> {
        let mut h = vec![0u8; len];
        h[0..4].copy_from_slice(b"DDS ");
        h[80..84].copy_from_slice(&pf_flags.to_le_bytes());
        h[84..88].copy_from_slice(fourcc);
        for &(off, val) in extra {
            h[off..off + 4].copy_from_slice(&val.to_le_bytes());
        }
        h
    }

    #[test]
    fn dds_legacy_dxt1_resolu_en_bc1_a_128() {
        // FourCC DXT1 sans extension DX10 (le cas des visages EDIT `base_normal_00`).
        let h = dds_header(0x4, b"DXT1", &[], 256);
        let (fmt, off) = dds_format_and_pixel_offset(&h).expect("DXT1 doit être reconnu");
        assert!(matches!(fmt, ImageFormat::BC1RgbaUnorm));
        assert_eq!(off, 128, "pixels legacy juste après le DDS_HEADER");
    }

    #[test]
    fn dds_legacy_ati2_resolu_en_bc5() {
        let h = dds_header(0x4, b"ATI2", &[], 256);
        let (fmt, off) = dds_format_and_pixel_offset(&h).expect("ATI2 doit être reconnu");
        assert!(matches!(fmt, ImageFormat::BC5RgUnorm));
        assert_eq!(off, 128);
    }

    #[test]
    fn dds_dx10_bc7_resolu_a_148() {
        // FourCC DX10 + dxgiFormat 98 (BC7RgbaUnorm) à l'offset 128 ; pixels à 148.
        let h = dds_header(0x4, b"DX10", &[(128, 98)], 256);
        let (fmt, off) = dds_format_and_pixel_offset(&h).expect("DX10 BC7 doit être reconnu");
        assert!(matches!(fmt, ImageFormat::BC7RgbaUnorm));
        assert_eq!(off, 148, "pixels DX10 après l'extension de 20 o");
    }

    #[test]
    fn dds_uncompressed_bgra8_resolu_a_128() {
        // DDPF_RGB, 32 bpp, B en octet bas (masque B=0xff) → BGRA8 (défaut Level-5).
        let h = dds_header(0x40, &[0; 4], &[(88, 32), (92, 0x00ff_0000), (100, 0x0000_00ff)], 256);
        let (fmt, off) = dds_format_and_pixel_offset(&h).expect("BGRA8 doit être reconnu");
        assert!(matches!(fmt, ImageFormat::Bgra8Unorm));
        assert_eq!(off, 128);
    }

    #[test]
    fn dds_uncompressed_rgba8_resolu_a_128() {
        let h = dds_header(0x40, &[0; 4], &[(88, 32), (92, 0x0000_00ff), (100, 0x00ff_0000)], 256);
        let (fmt, _) = dds_format_and_pixel_offset(&h).expect("RGBA8 doit être reconnu");
        assert!(matches!(fmt, ImageFormat::Rgba8Unorm));
    }

    #[test]
    fn dds_fourcc_inconnu_rejete() {
        let h = dds_header(0x4, b"ZZZZ", &[], 256);
        assert!(dds_format_and_pixel_offset(&h).is_none());
    }
}
