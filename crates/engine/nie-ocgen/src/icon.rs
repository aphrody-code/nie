//! Portrait icons — the one asset of an OC that no lock stands in front of.
//!
//! A character's menu icon lives at `data/dx11/menu/200_icon/10_icon_chr/face/<code>_l.g4tx`, and
//! the reference measured on `c02023290` is a container carrying **two** 256×256 textures named
//! `<code>_1_l00` and `<code>_2_l00`. Only their names and dimensions are measured; what tells the
//! two apart in the game is not. This module therefore takes **two declared crops** and says so,
//! rather than writing one image twice and letting a reader assume the slot was understood.
//!
//! Nothing here is generated: each icon is a rectangle of the author's own sheet, scaled down.

use serde::{Deserialize, Serialize};

use crate::{Error, palette::Sheet};

/// Side of a portrait sub-texture, measured on the reference icon.
pub const ICON_SIDE: u32 = 256;

/// One crop feeding one sub-texture of a portrait container.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IconCrop {
    /// Sheet the pixels come from, relative to the character's `source/`.
    pub sheet: String,
    /// Left edge, in pixels of that sheet.
    pub x: u32,
    /// Top edge, in pixels.
    pub y: u32,
    /// Side of the square crop, in pixels; it is scaled to [`ICON_SIDE`].
    pub side: u32,
}

/// One character variant's portrait icon.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IconSpec {
    /// Internal code, e.g. `c99019010`.
    pub internal_code: String,
    /// Crop feeding `<code>_1_l00`.
    pub first: IconCrop,
    /// Crop feeding `<code>_2_l00`.
    pub second: IconCrop,
}

/// What one encoded icon container came out as.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IconReport {
    /// Internal code.
    pub internal_code: String,
    /// VFS path the container belongs at.
    pub vfs_path: String,
    /// Size of the container in bytes.
    pub bytes: usize,
    /// Sub-texture names read back out of the encoded container.
    pub textures: Vec<String>,
}

/// Crops a square out of a sheet and scales it to `ICON_SIDE`, returning RGBA8.
///
/// # Errors
///
/// Returns [`Error::Palette`] when the crop falls outside the sheet — a rectangle copied from a
/// document is worth checking against the pixels rather than trusting.
fn crop_to_icon(sheet: &Sheet, crop: &IconCrop) -> Result<Vec<u8>, Error> {
    if crop.side == 0 || crop.x + crop.side > sheet.width || crop.y + crop.side > sheet.height {
        return Err(Error::Palette(format!(
            "{} : le carré ({}, {}, {}) sort de la planche {}x{}",
            crop.sheet, crop.x, crop.y, crop.side, sheet.width, sheet.height
        )));
    }
    let mut source = image::RgbaImage::new(crop.side, crop.side);
    for y in 0..crop.side {
        for x in 0..crop.side {
            let rgb = sheet
                .pixel(crop.x + x, crop.y + y)
                .ok_or_else(|| Error::Palette(format!("{} : pixel hors planche", crop.sheet)))?;
            source.put_pixel(x, y, image::Rgba([rgb[0], rgb[1], rgb[2], 255]));
        }
    }
    let scaled = image::imageops::resize(
        &source,
        ICON_SIDE,
        ICON_SIDE,
        image::imageops::FilterType::Lanczos3,
    );
    Ok(scaled.into_raw())
}

/// Encodes one sub-texture's DDS payload.
///
/// The game's own icons are BC7: the reference container is 131 648 bytes for two 256×256
/// textures, which is `2 × 65 536` bytes of blocks plus headers, where uncompressed BGRA8 would
/// need `2 × 262 144`. `encode_dds_bc7` exists for exactly that, behind the `bc7` feature.
///
/// It is a feature and not the default because it cannot be **linked** on every toolchain:
/// `intel_tex_2`, which `image_dds` uses to compress, ships its ISPC kernels prebuilt for MSVC
/// only, and the link fails on `x86_64-pc-windows-gnu` with `could not find native static library
/// kernelx86_64-pc-windows-gnu`. Producing a container four times too large, and saying so, beats
/// producing none.
#[cfg(feature = "bc7")]
fn encode_payload(rgba: &[u8]) -> Result<Vec<u8>, String> {
    nie_formats::g4tx_encode::encode_dds_bc7(ICON_SIDE, ICON_SIDE, rgba)
}

/// Uncompressed BGRA8 payload — see [`encode_payload`]'s `bc7` counterpart for why this is the
/// default and what it costs.
#[cfg(not(feature = "bc7"))]
fn encode_payload(rgba: &[u8]) -> Result<Vec<u8>, String> {
    nie_formats::g4tx_encode::encode_dds_bgra8(ICON_SIDE, ICON_SIDE, rgba)
}

/// Name of the payload format this build produces, for the run report.
#[must_use]
pub const fn payload_format() -> &'static str {
    match cfg!(feature = "bc7") {
        true => "BC7",
        false => "BGRA8 non compressé",
    }
}

/// VFS path a portrait container belongs at.
#[must_use]
pub fn icon_vfs_path(internal_code: &str) -> String {
    format!("data/dx11/menu/200_icon/10_icon_chr/face/{internal_code}_l.g4tx")
}

/// Encodes one variant's portrait container, and reads it back before returning it.
///
/// The container is re-parsed immediately: the two sub-texture names and their dimensions must
/// come back, or nothing is returned. That check is cheap and it is the only one available here —
/// no game reads this file on this machine.
///
/// # Errors
///
/// Returns [`Error::Palette`] when a crop is outside its sheet, [`Error::Image`] when the DDS or
/// container encoder refuses, and [`Error::Format`] when the encoded container does not re-parse
/// into the two textures it was given.
pub fn encode_icon(spec: &IconSpec, sheets: &[&Sheet]) -> Result<(Vec<u8>, IconReport), Error> {
    let find = |name: &str| -> Result<&Sheet, Error> {
        sheets
            .iter()
            .copied()
            .find(|sheet| sheet.name == name)
            .ok_or_else(|| Error::Palette(format!("planche \u{ab} {name} \u{bb} absente")))
    };

    let names = [
        format!("{}_1_l00", spec.internal_code),
        format!("{}_2_l00", spec.internal_code),
    ];
    let crops = [&spec.first, &spec.second];
    let mut payloads = Vec::with_capacity(2);
    for crop in crops {
        let rgba = crop_to_icon(find(&crop.sheet)?, crop)?;
        let dds = encode_payload(&rgba)
            .map_err(|error| Error::Image(format!("DDS {} : {error}", crop.sheet)))?;
        payloads.push(dds);
    }

    let side =
        i16::try_from(ICON_SIDE).map_err(|_| Error::Image("côté d'icône hors i16".to_string()))?;
    let textures: Vec<nie_formats::g4tx_encode::TextureAEcrire<'_>> = names
        .iter()
        .zip(&payloads)
        .enumerate()
        .map(
            |(index, (name, dds))| nie_formats::g4tx_encode::TextureAEcrire {
                name: name.as_str(),
                // The reference's ids were not measured; the rank is the only value that is not an
                // invention, and it is what `parse` reads back.
                id: u8::try_from(index).unwrap_or(0),
                width: side,
                height: side,
                dds: dds.as_slice(),
            },
        )
        .collect();

    let bytes = nie_formats::g4tx_encode::encode_g4tx_multi_texture(&textures, &[])
        .map_err(|error| Error::Image(format!("conteneur G4TX : {error}")))?;

    let relu = nie_formats::g4tx::parse(&bytes)
        .map_err(|error| Error::Format(format!("le G4TX produit ne se relit pas : {error:?}")))?;
    if relu.textures.len() != 2 {
        return Err(Error::Format(format!(
            "{} textures relues, 2 attendues",
            relu.textures.len()
        )));
    }
    for (index, expected) in names.iter().enumerate() {
        let texture = &relu.textures[index];
        if &texture.name != expected {
            return Err(Error::Format(format!(
                "texture {index} relue \u{ab} {} \u{bb}, attendue \u{ab} {expected} \u{bb}",
                texture.name
            )));
        }
        if texture.width != ICON_SIDE as i32 || texture.height != ICON_SIDE as i32 {
            return Err(Error::Format(format!(
                "texture {index} relue {}x{}, {ICON_SIDE}x{ICON_SIDE} attendu",
                texture.width, texture.height
            )));
        }
    }

    let report = IconReport {
        internal_code: spec.internal_code.clone(),
        vfs_path: icon_vfs_path(&spec.internal_code),
        bytes: bytes.len(),
        textures: relu
            .textures
            .iter()
            .map(|texture| texture.name.clone())
            .collect(),
    };
    Ok((bytes, report))
}

/// Decodes each sub-texture of an encoded container back to PNG, for looking at.
///
/// A container that re-parses is not a container that holds the right pixels. Decoding it back
/// through the game's own texture path and rendering a PNG is what makes the difference between
/// "the structure is valid" and "the portrait is in there" — and the second one needs eyes.
///
/// # Errors
///
/// Returns [`Error::Format`] when the container does not parse or a sub-texture does not decode.
pub fn preview_png(container: &[u8]) -> Result<Vec<(String, Vec<u8>)>, Error> {
    let parsed = nie_formats::g4tx::parse(container)
        .map_err(|error| Error::Format(format!("relecture du conteneur : {error:?}")))?;
    let mut out = Vec::with_capacity(parsed.textures.len());
    for texture in &parsed.textures {
        let (width, height, rgba) =
            nie_formats::g4tx_decode::decode_texture_rgba(container, texture).ok_or_else(|| {
                Error::Format(format!("{} : sous-texture non décodable", texture.name))
            })?;
        let png =
            nie_formats::g4tx_decode::encode_rgba_to_png(&rgba, width as usize, height as usize)
                .ok_or_else(|| Error::Format(format!("{} : encodage PNG refusé", texture.name)))?;
        out.push((texture.name.clone(), png));
    }
    Ok(out)
}
