//! Lecteur de conteneurs de textures G4TX (Level-5 « Graphics 4 Texture »).
//!
//! Port Rust de `IECODE.Core/Formats/Level5/G4txParser.cs` (`ParseTextures` L141,
//! calcul des offsets de tables L146-150, `G4txHeader` L17, `G4txEntry` L45,
//! `G4txSubEntry` L61). Recoupé octet par octet contre deux fichiers RÉELS :
//!
//! - `font_def.g4tx`  : `texture_count=1`, `total_count=1`, `sub_texture_count=0`,
//!   texture nommée « font », payload **DDS** (4096×2048) — PAS de NXTCH.
//! - `gaiji_game.g4tx`: `texture_count=1`, `total_count=118`, `sub_texture_count=117`,
//!   texture nommée « gaiji_game », id=110, payload **DDS** — 117 régions d'atlas.
//!
//! ## Réalité terrain : DDS, pas NXTCH
//!
//! Les deux seuls .g4tx présents sur le VPS portent un payload **DDS** (`"DDS "` à
//! `nxtch_base`), pas le chunk Switch NXTCH décrit par la doc. Le parseur lit donc les
//! dimensions depuis l'en-tête DDS quand il est présent, sinon depuis les champs
//! `width`/`height` de l'entrée (offset +0x18). Le déswizzle NXTCH vit dans
//! [`crate::nxtch`] (aucun fichier NXTCH réel disponible ici pour le valider).
//!
//! ## Disposition des tables (toutes vérifiées sur les fixtures)
//!
//! ```text
//! entry_offset    = 0x60
//! sub_entry_offset = entry_offset + texture_count * 0x30
//! hash_offset     = align16(sub_entry_offset + sub_texture_count * 0x18)
//! id_offset       = hash_offset + total_count * 4
//! string_offset   = align4(id_offset + total_count)
//! nxtch_base      = align16(header_size + table_size)
//! ```
//!
//! Compatible `no_std + alloc`.

extern crate alloc;
use alloc::{string::String, vec::Vec};

use crate::FormatError;

/// Magic « G4TX » lu en little-endian (`0x58543447`).
pub const G4TX_MAGIC: u32 = 0x5854_3447;
/// Magic « G4TX » en octets.
pub const G4TX_MAGIC_BYTES: [u8; 4] = *b"G4TX";

const HEADER_SIZE: usize = 0x60;
const ENTRY_SIZE: usize = 0x30;
const SUB_ENTRY_SIZE: usize = 0x18;

/// Magic DDS (`"DDS "`, LE `0x20534444`).
const DDS_MAGIC: u32 = 0x2053_4444;

/// En-tête G4TX (0x60 octets). Champs vérifiés sur fichiers réels.
#[derive(Debug, Clone, Copy)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4txHeader {
    /// Taille de l'en-tête (`0x60`).
    pub header_size: u16,
    /// Type de fichier (`0x65` observé).
    pub file_type: u16,
    /// Taille de la table (sert au calcul de `nxtch_base`).
    pub table_size: u32,
    /// Nombre de textures principales (entrées de 0x30 octets).
    pub texture_count: u16,
    /// Nombre total d'entrées (textures + régions d'atlas) — dimensionne hash/id/string tables.
    pub total_count: u16,
    /// Nombre de sous-textures (régions d'atlas, entrées de 0x18 octets).
    pub sub_texture_count: u8,
    /// Taille des données texture (champ d'en-tête, non utilisé pour le slicing).
    pub texture_data_size: u32,
}

/// Entrée de texture principale (0x30 octets).
#[derive(Debug, Clone, Copy)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4txEntry {
    /// Offset du chunk (relatif à `nxtch_base`).
    pub nxtch_offset: u32,
    /// Taille du chunk de texture.
    pub nxtch_size: u32,
    /// Largeur (champ d'entrée +0x18).
    pub width: i16,
    /// Hauteur (champ d'entrée +0x1A).
    pub height: i16,
}

/// Région d'atlas (sous-texture, 0x18 octets).
#[derive(Debug, Clone, Copy)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4txSubEntry {
    /// Index de la texture principale parente.
    pub entry_id: i16,
    /// Coin X de la région.
    pub x: i16,
    /// Coin Y de la région.
    pub y: i16,
    /// Largeur de la région.
    pub width: i16,
    /// Hauteur de la région.
    pub height: i16,
}

/// Région d'atlas résolue (avec id + nom).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4txSubTexture {
    /// Identifiant (octet de la table d'ids).
    pub id: u8,
    /// Nom résolu depuis la table de chaînes.
    pub name: String,
    /// Coin X.
    pub x: i16,
    /// Coin Y.
    pub y: i16,
    /// Largeur.
    pub width: i16,
    /// Hauteur.
    pub height: i16,
}

/// Texture G4TX décodée.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4txTexture {
    /// Identifiant (octet de la table d'ids).
    pub id: u8,
    /// Nom de la texture (null-term ASCII résolu).
    pub name: String,
    /// Largeur effective (DDS si présent, sinon champ d'entrée).
    pub width: i32,
    /// Hauteur effective.
    pub height: i32,
    /// Vrai si le payload commence par le magic DDS.
    pub is_dds: bool,
    /// Offset absolu du payload dans le tampon (`nxtch_base + entry.nxtch_offset`).
    pub data_offset: usize,
    /// Taille déclarée du payload (`entry.nxtch_size`).
    pub data_size: usize,
    /// Régions d'atlas rattachées à cette texture.
    pub sub_textures: Vec<G4txSubTexture>,
}

/// Conteneur G4TX parsé.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4tx {
    /// En-tête.
    pub header: G4txHeader,
    /// Textures principales (avec leurs régions d'atlas).
    pub textures: Vec<G4txTexture>,
}

/// Vrai si `data` commence par le magic G4TX.
#[must_use]
pub fn is_g4tx(data: &[u8]) -> bool {
    data.starts_with(&G4TX_MAGIC_BYTES)
}

/// Parse un conteneur G4TX.
///
/// Le payload de chaque texture n'a PAS besoin d'être présent dans `data` : si le slice
/// payload est hors limites (fichier tronqué), on renvoie quand même nom/dimensions/id/régions
/// (`is_dds = false`, dimensions issues des champs d'entrée).
///
/// # Erreurs
///
/// - [`FormatError::TooShort`] si `data` est plus court que l'en-tête.
/// - [`FormatError::BadMagic`] si le magic n'est pas G4TX.
/// - [`FormatError::Corrupt`] si une table déborde du tampon.
pub fn parse(data: &[u8]) -> Result<G4tx, FormatError> {
    if data.len() < HEADER_SIZE {
        return Err(FormatError::TooShort { got: data.len(), need: HEADER_SIZE });
    }
    if !is_g4tx(data) {
        return Err(FormatError::BadMagic { format: "G4TX" });
    }

    let header = parse_header(data)?;
    let tex_count = header.texture_count as usize;
    let total_count = header.total_count as usize;
    let sub_count = header.sub_texture_count as usize;

    // Offsets de tables (port exact de ParseTextures L146-150).
    let entry_offset = HEADER_SIZE;
    let sub_entry_offset = entry_offset + tex_count * ENTRY_SIZE;
    let hash_offset = align(sub_entry_offset + sub_count * SUB_ENTRY_SIZE, 16);
    let id_offset = hash_offset + total_count * 4;
    let string_offset = align(id_offset + total_count, 4);

    // Table d'ids : 1 octet par entrée (total_count octets).
    let ids = data
        .get(id_offset..id_offset + total_count)
        .ok_or(FormatError::Corrupt("G4TX : table d'ids hors limites"))?;

    // Offsets de chaînes : i16 par entrée à string_offset.
    let mut string_offsets = Vec::with_capacity(total_count);
    for i in 0..total_count {
        string_offsets.push(read_i16_le(data, string_offset + i * 2)?);
    }

    let nxtch_base = align(header.header_size as usize + header.table_size as usize, 16);

    // Sous-entrées (régions d'atlas).
    let mut sub_entries = Vec::with_capacity(sub_count);
    for i in 0..sub_count {
        let pos = sub_entry_offset + i * SUB_ENTRY_SIZE;
        sub_entries.push(G4txSubEntry {
            entry_id: read_i16_le(data, pos)?,
            // +0x02 inconnu
            x: read_i16_le(data, pos + 4)?,
            y: read_i16_le(data, pos + 6)?,
            width: read_i16_le(data, pos + 8)?,
            height: read_i16_le(data, pos + 10)?,
        });
    }

    let mut textures = Vec::with_capacity(tex_count);
    for i in 0..tex_count {
        let pos = entry_offset + i * ENTRY_SIZE;
        // Layout de G4txEntry : nxtch_offset @+0x04, nxtch_size @+0x08, width @+0x18, height @+0x1A.
        let entry = G4txEntry {
            nxtch_offset: read_u32_le(data, pos + 4)?,
            nxtch_size: read_u32_le(data, pos + 8)?,
            width: read_i16_le(data, pos + 0x18)?,
            height: read_i16_le(data, pos + 0x1A)?,
        };

        let name = read_name(data, string_offset, string_offsets[i])?;
        let data_offset = nxtch_base + entry.nxtch_offset as usize;
        let data_size = entry.nxtch_size as usize;

        // Dimensions : si le payload est présent ET commence par DDS, on lit l'en-tête DDS ;
        // sinon on retombe sur les champs d'entrée (fichier tronqué ou NXTCH).
        let (is_dds, width, height) = match data.get(data_offset..data_offset + 4) {
            Some(m) if u32::from_le_bytes([m[0], m[1], m[2], m[3]]) == DDS_MAGIC => {
                // DDS_HEADER : height @+0x0C, width @+0x10.
                let h = read_i32_le(data, data_offset + 0x0C)?;
                let w = read_i32_le(data, data_offset + 0x10)?;
                (true, w, h)
            }
            _ => (false, entry.width as i32, entry.height as i32),
        };

        // Régions d'atlas rattachées à cette texture (entry_id == i).
        // Les ids/noms des sous-textures suivent les textures principales : index absolu
        // = texture_count + (rang de la sous-entrée dans la liste globale).
        let mut sub_textures = Vec::new();
        for (sub_idx, sub) in sub_entries.iter().enumerate() {
            if sub.entry_id as usize == i {
                let absolute_id = tex_count + sub_idx;
                let sub_name = string_offsets
                    .get(absolute_id)
                    .copied()
                    .map_or_else(|| Ok(String::new()), |so| read_name(data, string_offset, so))?;
                let id = ids.get(absolute_id).copied().unwrap_or(0);
                sub_textures.push(G4txSubTexture {
                    id,
                    name: sub_name,
                    x: sub.x,
                    y: sub.y,
                    width: sub.width,
                    height: sub.height,
                });
            }
        }

        textures.push(G4txTexture {
            id: ids.get(i).copied().unwrap_or(0),
            name,
            width,
            height,
            is_dds,
            data_offset,
            data_size,
            sub_textures,
        });
    }

    Ok(G4tx { header, textures })
}

fn parse_header(data: &[u8]) -> Result<G4txHeader, FormatError> {
    Ok(G4txHeader {
        header_size: read_u16_le(data, 4)?,
        file_type: read_u16_le(data, 6)?,
        // Unknown1 @0x08 (4 octets), TableSize @0x0C.
        table_size: read_u32_le(data, 0x0C)?,
        texture_count: read_u16_le(data, 0x20)?,
        total_count: read_u16_le(data, 0x22)?,
        // Unknown2 @0x24 (1 octet), SubTextureCount @0x25.
        sub_texture_count: data[0x25],
        // TextureDataSize @0x2C.
        texture_data_size: read_u32_le(data, 0x2C)?,
    })
}

fn read_name(data: &[u8], string_offset: usize, rel: i16) -> Result<String, FormatError> {
    let pos = string_offset
        .checked_add(rel as usize)
        .ok_or(FormatError::Corrupt("G4TX : overflow offset de nom"))?;
    Ok(read_cstr(data, pos))
}

#[inline]
const fn align(v: usize, a: usize) -> usize {
    (v + (a - 1)) & !(a - 1)
}

fn read_cstr(data: &[u8], abs: usize) -> String {
    let slice = data.get(abs..).unwrap_or(&[]);
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..end]).into_owned()
}

fn read_u16_le(data: &[u8], off: usize) -> Result<u16, FormatError> {
    let b: [u8; 2] = data
        .get(off..off + 2)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("G4TX : lecture u16 hors limites"))?;
    Ok(u16::from_le_bytes(b))
}

fn read_i16_le(data: &[u8], off: usize) -> Result<i16, FormatError> {
    read_u16_le(data, off).map(|v| v as i16)
}

fn read_u32_le(data: &[u8], off: usize) -> Result<u32, FormatError> {
    let b: [u8; 4] = data
        .get(off..off + 4)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("G4TX : lecture u32 hors limites"))?;
    Ok(u32::from_le_bytes(b))
}

fn read_i32_le(data: &[u8], off: usize) -> Result<i32, FormatError> {
    read_u32_le(data, off).map(|v| v as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fixtures réelles tronquées au début du payload (header + tables), copiées de
    // /home/ubuntu/rg/iecode/re/menu/extracted/fonts/. Le payload DDS volumineux est coupé :
    // on valide nom/id/dimensions(entrée)/régions, pas les pixels.
    const FONT_DEF_HEAD: &[u8] = include_bytes!("../tests/fixtures/font_def.g4tx.head");
    const GAIJI_HEAD: &[u8] = include_bytes!("../tests/fixtures/gaiji_game.g4tx.head");

    #[test]
    fn is_g4tx_detection() {
        assert!(is_g4tx(b"G4TX...."));
        assert!(!is_g4tx(b"g4tx"));
        assert!(!is_g4tx(b""));
    }

    #[test]
    fn font_def_header_golden() {
        let g = parse(FONT_DEF_HEAD).expect("parse font_def header");
        assert_eq!(g.header.header_size, 0x60);
        assert_eq!(g.header.file_type, 0x65);
        assert_eq!(g.header.table_size, 0x48);
        assert_eq!(g.header.texture_count, 1);
        assert_eq!(g.header.total_count, 1);
        assert_eq!(g.header.sub_texture_count, 0);
        assert_eq!(g.textures.len(), 1);
        // nxtch_base = align16(0x60 + 0x48) = align16(0xA8) = 0xB0.
        assert_eq!(g.textures[0].data_offset, 0xB0);
    }

    #[test]
    fn font_def_texture_named() {
        let g = parse(FONT_DEF_HEAD).unwrap();
        let t = &g.textures[0];
        // Nom résolu = "font" (vu via `strings`), id = 0xD0 (octet de la table d'ids).
        assert_eq!(t.name, "font");
        assert!(t.sub_textures.is_empty());
        // Payload tronqué dans la fixture : pas de DDS lisible → dimensions issues de l'entrée
        // (width/height @+0x18 = 4096×2048, vérifiées au xxd).
        assert!(!t.is_dds);
        assert_eq!(t.width, 4096);
        assert_eq!(t.height, 2048);
        assert_eq!(t.data_size, 0x02A0_0080);
    }

    #[test]
    fn gaiji_header_and_atlas_golden() {
        let g = parse(GAIJI_HEAD).expect("parse gaiji header");
        assert_eq!(g.header.texture_count, 1);
        assert_eq!(g.header.total_count, 118);
        assert_eq!(g.header.sub_texture_count, 117);
        assert_eq!(g.header.table_size, 0x1934);
        assert_eq!(g.textures.len(), 1);

        let t = &g.textures[0];
        // Nom et id vérifiés byte-à-byte : "gaiji_game", id=110.
        assert_eq!(t.name, "gaiji_game");
        assert_eq!(t.id, 110);
        // 117 régions d'atlas rattachées à la texture 0.
        assert_eq!(t.sub_textures.len(), 117);
        // Région 0 vérifiée byte-à-byte : "gaiji_system01", 128×128 à (0,0).
        let r0 = &t.sub_textures[0];
        assert_eq!(r0.name, "gaiji_system01");
        assert_eq!((r0.x, r0.y, r0.width, r0.height), (0, 0, 128, 128));
        // nxtch_base = align16(0x60 + 0x1934) = align16(0x1994) = 0x19A0.
        assert_eq!(t.data_offset, 0x19A0);
        assert_eq!(t.data_size, 0xB20B4);
    }

    #[test]
    fn rejette_petit_et_mauvais_magic() {
        assert!(matches!(parse(&[0u8; 8]), Err(FormatError::TooShort { .. })));
        let mut buf = [0u8; HEADER_SIZE];
        buf[..4].copy_from_slice(b"XXXX");
        assert!(matches!(parse(&buf), Err(FormatError::BadMagic { .. })));
    }
}
