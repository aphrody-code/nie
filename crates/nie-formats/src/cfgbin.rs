//! Lecteur de fichiers RDBN (format Level-5, `cfg.bin` IEVR).
//!
//! Port Rust de :
//! - `IECODE.Core/Formats/Level5/CfgBin/Rdbn/RdbnReader.cs`
//! - `IECODE.Core/Formats/Level5/CfgBin/Rdbn/RdbnStructures.cs`
//!
//! ## Format RDBN (wire layout, tout little-endian)
//!
//! ```text
//! Offset  Taille  Champ
//!  0x00     4     Magic "RDBN" (LE : 0x4E424452)
//!  0x04     2     header_size  (généralement 0x50)
//!  0x06     4     version      (généralement 0x64 = 100)
//!  0x0A     2     data_offset  (× 4 = offset absolu du début de la section données)
//!  0x0C     4     data_size
//!  0x10     20    padding
//!  0x24     2     type_offset  (× 4, relatif à data_offset)
//!  0x26     2     type_count
//!  0x28     2     field_offset (× 4, relatif à data_offset)
//!  0x2A     2     field_count
//!  0x2C     2     root_offset  (× 4, relatif à data_offset)
//!  0x2E     2     root_count
//!  0x30     2     string_hash_offset (× 4, relatif à data_offset)
//!  0x32     2     string_offsets_offset (× 4, relatif à data_offset)
//!  0x34     2     hash_count
//!  0x36     2     value_offset (× 4, relatif à data_offset)
//!  0x38     4     string_offset (absolu relatif à data_offset, en octets)
//! ```
//!
//! Toutes les tables de types/champs/racines utilisent des entrées de 0x20 octets
//! (32 octets), padées.
//!
//! ## `std`
//!
//! Compatible no_std+alloc. Utilise `thiserror` → `std` requis pour `std::error::Error`,
//! car `FormatError` est défini dans `lib.rs` avec `thiserror`.

extern crate alloc;
use alloc::{string::String, vec::Vec};

use crate::FormatError;

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/// Magic RDBN en little-endian u32.
pub const RDBN_MAGIC: u32 = 0x4E424452; // "RDBN"

/// Magic RDBN en octets (LE).
pub const RDBN_MAGIC_BYTES: [u8; 4] = *b"RDBN";

/// Taille minimale d'un fichier RDBN valide.
pub const MIN_SIZE: usize = 0x50;

/// Taille de chaque entrée dans les tables type/field/root.
pub const ENTRY_SIZE: usize = 0x20;

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/// Types de champs RDBN.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[repr(i16)]
pub enum RdbnFieldType {
    AbilityData = 0,
    EnhanceData = 1,
    StatusRate = 2,
    Bool = 3,
    Byte = 4,
    Short = 5,
    Int = 6,
    ActType = 9,
    Flag = 10,
    Float = 13,
    Hash = 15,
    Rates = 18,
    Position = 19,
    Condition = 20,
    ShortTuple = 21,
    /// Type inconnu (valeur brute conservée).
    Unknown(i16),
}

impl RdbnFieldType {
    fn from_i16(v: i16) -> Self {
        match v {
            0 => Self::AbilityData,
            1 => Self::EnhanceData,
            2 => Self::StatusRate,
            3 => Self::Bool,
            4 => Self::Byte,
            5 => Self::Short,
            6 => Self::Int,
            9 => Self::ActType,
            10 => Self::Flag,
            13 => Self::Float,
            15 => Self::Hash,
            18 => Self::Rates,
            19 => Self::Position,
            20 => Self::Condition,
            21 => Self::ShortTuple,
            other => Self::Unknown(other),
        }
    }
}

/// En-tête d'un fichier RDBN parsé.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RdbnHeader {
    /// Version du format (généralement 100).
    pub version: i32,
    /// Offset absolu de la section données (data_offset × 4).
    pub data_offset: usize,
    /// Taille de la section données.
    pub data_size: i32,
    /// Nombre de types.
    pub type_count: u16,
    /// Nombre de champs.
    pub field_count: u16,
    /// Nombre d'entrées racines.
    pub root_count: u16,
    /// Nombre de chaînes dans la table de hachage.
    pub hash_count: u16,
}

/// Entrée de type RDBN.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RdbnTypeEntry {
    /// Hash CRC32 du nom du type.
    pub name_hash: u32,
    /// Hash secondaire (inconnu).
    pub unk_hash: u32,
    /// Index du premier champ dans la table de champs.
    pub field_index: i16,
    /// Nombre de champs dans ce type.
    pub field_count: i16,
}

/// Entrée de champ RDBN.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RdbnFieldEntry {
    /// Hash CRC32 du nom du champ.
    pub name_hash: u32,
    /// Type du champ.
    pub field_type: RdbnFieldType,
    /// Catégorie de type (usage interne Level-5).
    pub type_category: i16,
    /// Taille en octets de la valeur.
    pub value_size: i32,
    /// Offset de la valeur dans le bloc de valeurs (relatif à value_section).
    pub value_offset: i32,
    /// Nombre de valeurs.
    pub value_count: i32,
}

/// Entrée racine RDBN (liste de données).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RdbnRootEntry {
    /// Index dans la table de types.
    pub type_index: i16,
    /// Champ inconnu.
    pub unk1: i16,
    /// Offset de la première valeur dans le bloc de valeurs.
    pub value_offset: i32,
    /// Taille d'une valeur.
    pub value_size: i32,
    /// Nombre de valeurs.
    pub value_count: i32,
    /// Hash CRC32 du nom de cette liste.
    pub name_hash: u32,
}

/// Table de hachage RDBN : association hash CRC32 → nom de chaîne.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RdbnStringTable {
    /// Associations (hash, chaîne).
    pub entries: Vec<(u32, String)>,
}

impl RdbnStringTable {
    /// Résout un hash en chaîne, ou retourne `None`.
    #[must_use]
    pub fn resolve(&self, hash: u32) -> Option<&str> {
        self.entries
            .iter()
            .find(|(h, _)| *h == hash)
            .map(|(_, s)| s.as_str())
    }
}

/// Données RDBN complètes.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RdbnData {
    /// En-tête parsé.
    pub header: RdbnHeader,
    /// Table de types.
    pub types: Vec<RdbnTypeEntry>,
    /// Table de champs.
    pub fields: Vec<RdbnFieldEntry>,
    /// Entrées racines.
    pub roots: Vec<RdbnRootEntry>,
    /// Table de chaînes (hashes CRC32 ↔ noms).
    pub strings: RdbnStringTable,
}

impl RdbnData {
    /// Résout le nom d'une entrée racine depuis la table de chaînes.
    #[must_use]
    pub fn root_name(&self, root: &RdbnRootEntry) -> Option<&str> {
        self.strings.resolve(root.name_hash)
    }

    /// Résout le nom d'un type depuis la table de chaînes.
    #[must_use]
    pub fn type_name(&self, entry: &RdbnTypeEntry) -> Option<&str> {
        self.strings.resolve(entry.name_hash)
    }

    /// Résout le nom d'un champ depuis la table de chaînes.
    #[must_use]
    pub fn field_name(&self, entry: &RdbnFieldEntry) -> Option<&str> {
        self.strings.resolve(entry.name_hash)
    }
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/// Vrai si `data` commence par le magic RDBN.
#[must_use]
pub fn is_rdbn(data: &[u8]) -> bool {
    data.starts_with(&RDBN_MAGIC_BYTES)
}

/// Parse un fichier RDBN depuis un slice d'octets.
///
/// # Erreurs
///
/// - [`FormatError::TooShort`] si le tampon est plus court que le minimum.
/// - [`FormatError::BadMagic`] si le magic n'est pas `RDBN`.
/// - [`FormatError::Corrupt`] pour toute incohérence interne.
pub fn parse(data: &[u8]) -> Result<RdbnData, FormatError> {
    if data.len() < MIN_SIZE {
        return Err(FormatError::TooShort { got: data.len(), need: MIN_SIZE });
    }
    if !is_rdbn(data) {
        return Err(FormatError::BadMagic { format: "RDBN" });
    }

    let header = parse_header(data)?;
    let da = header.data_offset;

    // Offsets absolus dans `data`.
    let type_abs = (read_i16_le(data, 0x24)? as usize * 4) + da;
    let field_abs = (read_i16_le(data, 0x28)? as usize * 4) + da;
    let root_abs = (read_i16_le(data, 0x2C)? as usize * 4) + da;
    let hash_abs = (read_i16_le(data, 0x30)? as usize * 4) + da;
    let offsets_abs = (read_i16_le(data, 0x32)? as usize * 4) + da;
    let value_abs = (read_i16_le(data, 0x36)? as usize * 4) + da;
    let string_abs = read_i32_le(data, 0x38)? as usize + da;

    let _ = value_abs; // utilisé par les appelants (ReadFieldValue), pas dans ce parseur de header

    let types = parse_types(data, type_abs, header.type_count as usize)?;
    let fields = parse_fields(data, field_abs, header.field_count as usize)?;
    let roots = parse_roots(data, root_abs, header.root_count as usize)?;
    let strings =
        parse_strings(data, header.hash_count as usize, hash_abs, offsets_abs, string_abs)?;

    Ok(RdbnData { header, types, fields, roots, strings })
}

// ---------------------------------------------------------------------------
// Helpers de parsing
// ---------------------------------------------------------------------------

fn parse_header(data: &[u8]) -> Result<RdbnHeader, FormatError> {
    let version = read_i32_le(data, 6)?;
    let data_offset = read_i16_le(data, 10)? as usize * 4;
    let data_size = read_i32_le(data, 12)?;
    let type_count = read_u16_le(data, 0x26)?;
    let field_count = read_u16_le(data, 0x2A)?;
    let root_count = read_u16_le(data, 0x2E)?;
    let hash_count = read_u16_le(data, 0x34)?;

    Ok(RdbnHeader { version, data_offset, data_size, type_count, field_count, root_count, hash_count })
}

fn parse_types(data: &[u8], abs_offset: usize, count: usize) -> Result<Vec<RdbnTypeEntry>, FormatError> {
    let mut entries = Vec::with_capacity(count);
    for i in 0..count {
        let pos = abs_offset + i * ENTRY_SIZE;
        entries.push(RdbnTypeEntry {
            name_hash: read_u32_le(data, pos)?,
            unk_hash: read_u32_le(data, pos + 4)?,
            field_index: read_i16_le(data, pos + 8)?,
            field_count: read_i16_le(data, pos + 10)?,
        });
    }
    Ok(entries)
}

fn parse_fields(data: &[u8], abs_offset: usize, count: usize) -> Result<Vec<RdbnFieldEntry>, FormatError> {
    let mut entries = Vec::with_capacity(count);
    for i in 0..count {
        let pos = abs_offset + i * ENTRY_SIZE;
        let raw_type = read_i16_le(data, pos + 4)?;
        entries.push(RdbnFieldEntry {
            name_hash: read_u32_le(data, pos)?,
            field_type: RdbnFieldType::from_i16(raw_type),
            type_category: read_i16_le(data, pos + 6)?,
            value_size: read_i32_le(data, pos + 8)?,
            value_offset: read_i32_le(data, pos + 12)?,
            value_count: read_i32_le(data, pos + 16)?,
        });
    }
    Ok(entries)
}

fn parse_roots(data: &[u8], abs_offset: usize, count: usize) -> Result<Vec<RdbnRootEntry>, FormatError> {
    let mut entries = Vec::with_capacity(count);
    for i in 0..count {
        let pos = abs_offset + i * ENTRY_SIZE;
        entries.push(RdbnRootEntry {
            type_index: read_i16_le(data, pos)?,
            unk1: read_i16_le(data, pos + 2)?,
            value_offset: read_i32_le(data, pos + 4)?,
            value_size: read_i32_le(data, pos + 8)?,
            value_count: read_i32_le(data, pos + 12)?,
            name_hash: read_u32_le(data, pos + 16)?,
        });
    }
    Ok(entries)
}

fn parse_strings(
    data: &[u8],
    count: usize,
    hash_abs: usize,
    offsets_abs: usize,
    string_abs: usize,
) -> Result<RdbnStringTable, FormatError> {
    let mut entries = Vec::with_capacity(count);
    for i in 0..count {
        let hash = read_u32_le(data, hash_abs + i * 4)?;
        let str_off = read_i32_le(data, offsets_abs + i * 4)? as usize;
        let abs = string_abs.checked_add(str_off)
            .ok_or(FormatError::Corrupt("RDBN : overflow offset chaîne"))?;
        let s = read_cstr(data, abs);
        entries.push((hash, s));
    }
    Ok(RdbnStringTable { entries })
}

fn read_cstr(data: &[u8], abs: usize) -> String {
    let slice = data.get(abs..).unwrap_or(&[]);
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..end]).into_owned()
}

// ---------------------------------------------------------------------------
// Primitives de lecture LE (no_std-friendly, sans unsafe)
// ---------------------------------------------------------------------------

fn read_u16_le(data: &[u8], off: usize) -> Result<u16, FormatError> {
    let bytes: [u8; 2] = data
        .get(off..off + 2)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("RDBN : lecture u16 hors limites"))?;
    Ok(u16::from_le_bytes(bytes))
}

fn read_i16_le(data: &[u8], off: usize) -> Result<i16, FormatError> {
    read_u16_le(data, off).map(|v| v as i16)
}

fn read_u32_le(data: &[u8], off: usize) -> Result<u32, FormatError> {
    let bytes: [u8; 4] = data
        .get(off..off + 4)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("RDBN : lecture u32 hors limites"))?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_i32_le(data: &[u8], off: usize) -> Result<i32, FormatError> {
    read_u32_le(data, off).map(|v| v as i32)
}

// ---------------------------------------------------------------------------
// CRC32 (IEEE 802.3 / PKZIP polynomial 0xEDB88320)
// ---------------------------------------------------------------------------

/// Calcule le hash CRC32 compatible avec le format RDBN.
///
/// Polynomial : 0xEDB88320 (IEEE 802.3, LE). Identique à `Crc32.cs` de IECODE.
/// Utilisé pour hasher les noms de types/champs/listes.
///
/// # Exemple
///
/// ```
/// use nie_formats::cfgbin::crc32;
/// let hash = crc32(b"PlayerParam");
/// assert!(hash != 0); // non-trivial
/// ```
pub fn crc32(data: &[u8]) -> u32 {
    const POLY: u32 = 0xEDB8_8320;
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ POLY;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------
    // CRC32
    // -------------------------------------------------------------------

    #[test]
    fn crc32_vide() {
        // CRC32("") = 0x00000000 (complémentaire de 0xFFFFFFFF ^ 0 = 0xFFFFFFFF → ~= 0)
        assert_eq!(crc32(b""), 0x0000_0000);
    }

    #[test]
    fn crc32_vecteur_connu() {
        // CRC32("123456789") = 0xCBF43926 (vecteur de test standard IEEE)
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn crc32_non_nul_pour_nom_typique() {
        let h = crc32(b"PlayerParam");
        assert_ne!(h, 0);
        // Déterministe.
        assert_eq!(crc32(b"PlayerParam"), h);
    }

    // -------------------------------------------------------------------
    // Détection magic
    // -------------------------------------------------------------------

    #[test]
    fn is_rdbn_detection() {
        assert!(is_rdbn(b"RDBN\x00\x00\x00\x00"));
        assert!(!is_rdbn(b"rdbn\x00\x00\x00\x00"));
        // 4 octets = exact match du magic → true (is_rdbn ne valide pas la taille minimale).
        assert!(is_rdbn(b"RDBN"));
        // Trop court (moins de 4 octets) → false.
        assert!(!is_rdbn(b"RDB"));
        assert!(!is_rdbn(b""));
    }

    #[test]
    fn is_rdbn_vide() {
        assert!(!is_rdbn(b""));
    }

    // -------------------------------------------------------------------
    // Erreurs de format
    // -------------------------------------------------------------------

    #[test]
    fn trop_court_renvoie_erreur() {
        let buf = [0u8; 0x20]; // < MIN_SIZE (0x50)
        assert!(matches!(parse(&buf), Err(FormatError::TooShort { .. })));
    }

    #[test]
    fn mauvais_magic_renvoie_erreur() {
        let mut buf = [0u8; 0x50];
        buf[0..4].copy_from_slice(b"NOTM");
        assert!(matches!(parse(&buf), Err(FormatError::BadMagic { .. })));
    }

    // -------------------------------------------------------------------
    // Parse d'un header minimal synthétique
    // -------------------------------------------------------------------

    /// Construit un fichier RDBN minimal avec 0 types/champs/racines/chaînes.
    fn build_empty_rdbn() -> Vec<u8> {
        // data_offset = 0x14 (× 4 = 0x50 = position juste après le header de 0x50 octets)
        // version = 100
        // Toutes les tables sont vides → offsets pointent vers 0 dans la section données.

        let mut buf = alloc::vec![0u8; 0x50];
        buf[0..4].copy_from_slice(b"RDBN");
        buf[4..6].copy_from_slice(&(0x50i16).to_le_bytes()); // header_size
        buf[6..10].copy_from_slice(&(100i32).to_le_bytes()); // version
        // data_offset en quarts (0x14 × 4 = 0x50).
        buf[10..12].copy_from_slice(&(0x14i16).to_le_bytes()); // data_offset / 4
        buf[12..16].copy_from_slice(&(0i32).to_le_bytes());   // data_size = 0

        // Tous les offsets de tables = 0, tous les comptes = 0.
        // (le tampon est initialisé à 0, donc pas besoin d'écrire).

        // string_offset (0x38) = 0 (relatif à data_offset = 0x50).
        // data_offset abs = 0x50 + 0 = 0x50 → dépasse buf.len() mais count=0 → pas lu.

        buf
    }

    #[test]
    fn parse_rdbn_vide() {
        let buf = build_empty_rdbn();
        let rdbn = parse(&buf).expect("RDBN vide doit parser");
        assert_eq!(rdbn.header.version, 100);
        assert_eq!(rdbn.header.data_offset, 0x50);
        assert!(rdbn.types.is_empty());
        assert!(rdbn.fields.is_empty());
        assert!(rdbn.roots.is_empty());
        assert!(rdbn.strings.entries.is_empty());
    }

    #[test]
    fn parse_rdbn_header_version() {
        let mut buf = build_empty_rdbn();
        // Changer la version.
        buf[6..10].copy_from_slice(&(200i32).to_le_bytes());
        let rdbn = parse(&buf).unwrap();
        assert_eq!(rdbn.header.version, 200);
    }

    // -------------------------------------------------------------------
    // RdbnStringTable::resolve
    // -------------------------------------------------------------------

    #[test]
    fn string_table_resolve() {
        let table = RdbnStringTable {
            entries: alloc::vec![
                (0xDEAD_BEEF, "PlayerParam".into()),
                (0x1234_5678, "SkillParam".into()),
            ],
        };
        assert_eq!(table.resolve(0xDEAD_BEEF), Some("PlayerParam"));
        assert_eq!(table.resolve(0x1234_5678), Some("SkillParam"));
        assert_eq!(table.resolve(0x0000_0001), None);
    }

    // -------------------------------------------------------------------
    // RdbnFieldType::from_i16
    // -------------------------------------------------------------------

    #[test]
    fn rdbn_field_type_connus() {
        assert!(matches!(RdbnFieldType::from_i16(3), RdbnFieldType::Bool));
        assert!(matches!(RdbnFieldType::from_i16(6), RdbnFieldType::Int));
        assert!(matches!(RdbnFieldType::from_i16(13), RdbnFieldType::Float));
        assert!(matches!(RdbnFieldType::from_i16(15), RdbnFieldType::Hash));
    }

    #[test]
    fn rdbn_field_type_inconnu() {
        assert!(matches!(RdbnFieldType::from_i16(0x7F), RdbnFieldType::Unknown(0x7F)));
    }
}
