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
    /// Offset absolu (dans le tampon) du bloc de valeurs : `(value_offset << 2) + data_offset`.
    /// Source de vérité : `RdbnReader.Read` L60 (`valueOffset = (header.ValueOffset << 2) + dataOffset`).
    pub value_abs: usize,
    /// Offset absolu (dans le tampon) du début de la table de chaînes :
    /// `string_offset + data_offset`. Utilisé par le type `Condition` (0x14) qui traite la
    /// valeur lue comme un offset dans cette table. Source : `RdbnReader.Read` L56.
    pub string_abs: usize,
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

    let types = parse_types(data, type_abs, header.type_count as usize)?;
    let fields = parse_fields(data, field_abs, header.field_count as usize)?;
    let roots = parse_roots(data, root_abs, header.root_count as usize)?;
    let strings =
        parse_strings(data, header.hash_count as usize, hash_abs, offsets_abs, string_abs)?;

    Ok(RdbnData { header, types, fields, roots, strings, value_abs, string_abs })
}

// ---------------------------------------------------------------------------
// Décodage des VALEURS RDBN (corps des listes typées)
//
// Port exact de `RdbnReader.CreateRdbnData` (L194), `ReadFieldValue` (L249) et
// `ReadConditionValue` (L293). Vérifié octet par octet contre le vrai fichier
// `/home/ubuntu/rg/iecode/re/menu/extracted/fonts/font_color.cfg.bin` (liste
// `m_FontColorDataList`, type `FONT_COLOR`, 7 champs, 64 lignes de 100 octets).
// ---------------------------------------------------------------------------

/// Valeur typée décodée d'un champ RDBN.
///
/// Correspondance 1:1 avec le `switch` de `ReadFieldValue` (RdbnReader.cs L257-290) :
/// - `Bool` (type 3) — un octet, `!= 0`.
/// - `Byte` (type 4) — un octet brut.
/// - `Short` (type 5) — i16 LE.
/// - `Int` (type 6) — i32 LE.
/// - `ActType` (type 9) — i16 LE (même lecture que `Short`).
/// - `Flag` (type 10) — i32 LE (même lecture que `Int`).
/// - `Float` (type 13) — f32 LE.
/// - `Hash` (type 15) — u32 LE brut (le C# le formate `0x%08X`).
/// - `Rates` (type 18) / `Position` (type 19) — 4 × f32 LE.
/// - `Condition` (type 20) — u32 traité comme offset dans la table de chaînes.
/// - `ShortTuple` (type 21) — 2 × i16 LE.
/// - `Blob` — octets bruts (types 0/1/2 et tout type inconnu : `ReadBlobAsHex`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum RdbnValue {
    /// `RdbnFieldType::Bool` (3) — octet non nul.
    Bool(bool),
    /// `RdbnFieldType::Byte` (4) — octet brut.
    Byte(u8),
    /// `RdbnFieldType::Short` (5) — i16 LE.
    Short(i16),
    /// `RdbnFieldType::Int` (6) — i32 LE.
    Int(i32),
    /// `RdbnFieldType::ActType` (9) — i16 LE.
    ActType(i16),
    /// `RdbnFieldType::Flag` (10) — i32 LE.
    Flag(i32),
    /// `RdbnFieldType::Float` (13) — f32 LE.
    Float(f32),
    /// `RdbnFieldType::Hash` (15) — u32 LE brut.
    Hash(u32),
    /// `RdbnFieldType::Rates` (18) — 4 × f32 LE.
    Rates([f32; 4]),
    /// `RdbnFieldType::Position` (19) — 4 × f32 LE.
    Position([f32; 4]),
    /// `RdbnFieldType::Condition` (20) — chaîne résolue depuis la table de chaînes.
    Condition(String),
    /// `RdbnFieldType::ShortTuple` (21) — 2 × i16 LE.
    ShortTuple([i16; 2]),
    /// Types 0/1/2 et inconnus — octets bruts (`field.value_size` octets).
    Blob(Vec<u8>),
    /// Lecture impossible (offset + taille hors du tampon) — équivalent C# `"<invalid>"`.
    Invalid,
}

/// Une ligne d'une liste RDBN : association ordonnée (nom de champ → valeur décodée).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RdbnRow {
    /// Champs de la ligne, dans l'ordre de la table de types (nom résolu, valeur).
    pub fields: Vec<(String, RdbnValue)>,
}

/// Une liste RDBN décodée (équivalent de `RdbnList` C#).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RdbnList {
    /// Nom de la liste (résolu depuis `root.name_hash`, sinon `Unknown_0x…`).
    pub name: String,
    /// Nom du type de la liste (résolu depuis `type.name_hash`, sinon `Type_0x…`).
    pub type_name: String,
    /// Lignes décodées (`root.value_count` entrées de `root.value_size` octets).
    pub rows: Vec<RdbnRow>,
}

/// Décode le corps de toutes les listes RDBN (port de `RdbnReader.CreateRdbnData`).
///
/// Pour chaque `root` :
/// 1. résout le nom de liste (`root.name_hash`) et de type (`type.name_hash`) ;
/// 2. itère `root.value_count` lignes, chacune à
///    `value_abs + root.value_offset + v * root.value_size` ;
/// 3. pour chaque champ du type (`type.field_index .. + type.field_count`), lit la valeur à
///    `entry + field.value_offset` selon [`RdbnFieldType`].
///
/// Aucune valeur n'est fabriquée : un offset hors limites donne [`RdbnValue::Invalid`]
/// (équivalent du `"<invalid>"` C#, `ReadFieldValue` L252-253).
#[must_use]
pub fn read_values(rdbn: &RdbnData, data: &[u8]) -> Vec<RdbnList> {
    let mut lists = Vec::with_capacity(rdbn.roots.len());

    for root in &rdbn.roots {
        let name = rdbn
            .strings
            .resolve(root.name_hash)
            .map_or_else(|| alloc::format!("Unknown_0x{:08X}", root.name_hash), String::from);

        // type_index doit être un index valide dans la table de types.
        let Some(ty) = usize::try_from(root.type_index).ok().and_then(|i| rdbn.types.get(i)) else {
            // Type hors plage : on émet une liste vide nommée, sans fabriquer de lignes.
            lists.push(RdbnList { name, type_name: alloc::format!("Type_0x{:08X}", 0u32), rows: Vec::new() });
            continue;
        };

        let type_name = rdbn
            .strings
            .resolve(ty.name_hash)
            .map_or_else(|| alloc::format!("Type_0x{:08X}", ty.name_hash), String::from);

        let root_value_offset = rdbn.value_abs.wrapping_add(root.value_offset as usize);
        let mut rows = Vec::with_capacity(root.value_count.max(0) as usize);

        for v in 0..root.value_count.max(0) {
            let entry_offset = root_value_offset.wrapping_add(v as usize * root.value_size as usize);
            let mut fields = Vec::with_capacity(ty.field_count.max(0) as usize);

            for f in 0..ty.field_count.max(0) {
                let field_idx = ty.field_index as i64 + f as i64;
                let Some(field) = usize::try_from(field_idx).ok().and_then(|i| rdbn.fields.get(i)) else {
                    continue;
                };
                let field_name = rdbn
                    .strings
                    .resolve(field.name_hash)
                    .map_or_else(|| alloc::format!("Field_0x{:08X}", field.name_hash), String::from);

                let field_value_offset = entry_offset.wrapping_add(field.value_offset as usize);
                let value = read_field_value(data, field_value_offset, field, rdbn.string_abs);
                fields.push((field_name, value));
            }

            rows.push(RdbnRow { fields });
        }

        lists.push(RdbnList { name, type_name, rows });
    }

    lists
}

/// Lit une valeur de champ unique (port de `ReadFieldValue`, RdbnReader.cs L249).
fn read_field_value(data: &[u8], offset: usize, field: &RdbnFieldEntry, string_abs: usize) -> RdbnValue {
    let size = field.value_size.max(0) as usize;
    // Garde stricte identique au C# : `offset + ValueSize > data.Length` ⇒ "<invalid>".
    if offset.checked_add(size).is_none_or(|end| end > data.len()) {
        return RdbnValue::Invalid;
    }

    match field.field_type {
        RdbnFieldType::Bool => RdbnValue::Bool(data[offset] != 0),
        RdbnFieldType::Byte => RdbnValue::Byte(data[offset]),
        RdbnFieldType::Short => read_i16_le(data, offset).map_or(RdbnValue::Invalid, RdbnValue::Short),
        RdbnFieldType::Int => read_i32_le(data, offset).map_or(RdbnValue::Invalid, RdbnValue::Int),
        RdbnFieldType::ActType => read_i16_le(data, offset).map_or(RdbnValue::Invalid, RdbnValue::ActType),
        RdbnFieldType::Flag => read_i32_le(data, offset).map_or(RdbnValue::Invalid, RdbnValue::Flag),
        RdbnFieldType::Float => read_f32_le(data, offset).map_or(RdbnValue::Invalid, RdbnValue::Float),
        RdbnFieldType::Hash => read_u32_le(data, offset).map_or(RdbnValue::Invalid, RdbnValue::Hash),
        RdbnFieldType::Rates => read_vec4_le(data, offset).map_or(RdbnValue::Invalid, RdbnValue::Rates),
        RdbnFieldType::Position => read_vec4_le(data, offset).map_or(RdbnValue::Invalid, RdbnValue::Position),
        RdbnFieldType::Condition => read_condition_value(data, offset, string_abs),
        RdbnFieldType::ShortTuple => match (read_i16_le(data, offset), read_i16_le(data, offset + 2)) {
            (Ok(a), Ok(b)) => RdbnValue::ShortTuple([a, b]),
            _ => RdbnValue::Invalid,
        },
        // Types 0/1/2 (AbilityData/EnhanceData/StatusRate) et inconnus ⇒ blob brut.
        RdbnFieldType::AbilityData
        | RdbnFieldType::EnhanceData
        | RdbnFieldType::StatusRate
        | RdbnFieldType::Unknown(_) => RdbnValue::Blob(data[offset..offset + size].to_vec()),
    }
}

/// Port de `ReadConditionValue` (RdbnReader.cs L293) : lit un u32 à `offset`, le traite comme
/// offset relatif dans la table de chaînes (`string_abs + value`), et lit la chaîne null-terminée.
/// Si la position résolue est hors limites, on renvoie la valeur numérique sous forme de blob u32.
fn read_condition_value(data: &[u8], offset: usize, string_abs: usize) -> RdbnValue {
    let Ok(value) = read_u32_le(data, offset) else {
        return RdbnValue::Invalid;
    };
    let str_pos = string_abs.wrapping_add(value as usize);
    // Le C# exige `strPos < data.Length && strPos > 0`. `string_abs > 0` toujours (≥ data_offset),
    // donc on reproduit seulement la borne haute.
    if str_pos < data.len() && str_pos > 0 {
        RdbnValue::Condition(read_cstr(data, str_pos))
    } else {
        // Pas une chaîne résoluble : on conserve la valeur brute (équivalent du `return value;` C#).
        RdbnValue::Hash(value)
    }
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

fn read_f32_le(data: &[u8], off: usize) -> Result<f32, FormatError> {
    read_u32_le(data, off).map(f32::from_bits)
}

/// Lit 4 f32 LE consécutifs (types `Rates` / `Position`).
fn read_vec4_le(data: &[u8], off: usize) -> Result<[f32; 4], FormatError> {
    Ok([
        read_f32_le(data, off)?,
        read_f32_le(data, off + 4)?,
        read_f32_le(data, off + 8)?,
        read_f32_le(data, off + 12)?,
    ])
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

use alloc::collections::BTreeMap;

/// Formats possibles de fichiers de configuration Level-5.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Format {
    Rdbn,
    T2b,
}

/// Valeur d'une variable CfgBin typée pour T2B.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Value {
    String(String),
    Int(i32),
    Float(f32),
}

/// Entrée de configuration Level-5 structurée de façon hiérarchique.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CfgEntry {
    pub name: String,
    pub variables: Vec<Value>,
    pub children: Vec<CfgEntry>,
}

/// Fichier de configuration Level-5 décodé (RDBN ou T2B).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CfgBinFile {
    pub format: Format,
    pub entries: Vec<CfgEntry>,
}

/// Parse un fichier cfg.bin (T2B).
pub fn cfgbin_parse(data: &[u8]) -> Result<CfgBinFile, FormatError> {
    parse_t2b(data)
}

/// Parse un fichier binaire T2B Level-5.
pub fn parse_t2b(data: &[u8]) -> Result<CfgBinFile, FormatError> {
    if data.len() < 16 {
        return Err(FormatError::TooShort { got: data.len(), need: 16 });
    }

    let entries_count = i32::from_le_bytes(data[0..4].try_into().unwrap());
    let string_table_off_i = i32::from_le_bytes(data[4..8].try_into().unwrap());
    let string_table_len_i = i32::from_le_bytes(data[8..12].try_into().unwrap());
    let string_table_count = i32::from_le_bytes(data[12..16].try_into().unwrap()) as usize;

    // En-tête T2B : nombre d'entrées, offset et longueur de la table de chaînes sont
    // des entiers non signés en pratique. Une entrée du jeu chiffrée ou compressée (p.ex.
    // `cpk_list.cfg.bin` sur certaines installations Steam) produit ici des valeurs
    // aberrantes ou négatives. Les caster directement en `usize` les transforme en
    // valeurs proches de `usize::MAX`, puis l'addition `off + len` déborde — panic en
    // debug (overflow check), wrap silencieux en release (pire : parse de données fausses).
    // On valide donc le signe puis on additionne en `checked_add` : un fichier valide
    // (offsets petits et positifs) est inchangé byte-exact ; un fichier illisible renvoie
    // proprement `Corrupt` au lieu de paniquer.
    if entries_count < 0 || string_table_off_i < 0 || string_table_len_i < 0 {
        return Err(FormatError::Corrupt(
            "T2B header: negative count/offset/length (fichier chiffré ou corrompu ?)",
        ));
    }
    let string_table_off = string_table_off_i as usize;
    let string_table_len = string_table_len_i as usize;

    let string_table_end = string_table_off
        .checked_add(string_table_len)
        .ok_or(FormatError::Corrupt("T2B string table offset/length overflow"))?;
    if string_table_off < 16 || string_table_end > data.len() {
        return Err(FormatError::Corrupt("String table offset out of bounds"));
    }

    let mut strings = BTreeMap::new();
    {
        let mut pos = 0;
        let mut count = 0;
        while pos < string_table_len && count < string_table_count {
            let start = string_table_off + pos;
            let slice = &data[start..string_table_off + string_table_len];
            let nul = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
            let s = String::from_utf8_lossy(&slice[..nul]).into_owned();
            strings.insert(pos as i32, s.clone());
            pos += s.len() + 1;
            count += 1;
        }
    }

    let key_table_offset = string_table_end.div_ceil(16) * 16;
    let mut key_table = BTreeMap::new();
    if key_table_offset + 16 <= data.len() {
        let key_length = i32::from_le_bytes(data[key_table_offset..key_table_offset + 4].try_into().unwrap()) as usize;
        if key_length > 0 && key_table_offset + key_length <= data.len() {
            let key_count = i32::from_le_bytes(data[key_table_offset + 4..key_table_offset + 8].try_into().unwrap()) as usize;
            let key_str_off = i32::from_le_bytes(data[key_table_offset + 8..key_table_offset + 12].try_into().unwrap()) as usize;
            let key_str_len = i32::from_le_bytes(data[key_table_offset + 12..key_table_offset + 16].try_into().unwrap()) as usize;

            let max_possible = key_length / 8;
            if key_count <= max_possible && key_str_off < key_length {
                let key_base = key_table_offset + 16;
                let str_blob = key_table_offset + key_str_off;

                for i in 0..key_count {
                    let ep = key_base + i * 8;
                    if ep + 8 > data.len() {
                        break;
                    }
                    let crc = u32::from_le_bytes(data[ep..ep + 4].try_into().unwrap());
                    let str_start = i32::from_le_bytes(data[ep + 4..ep + 8].try_into().unwrap()) as usize;

                    if str_start < key_str_len {
                        let slice = &data[str_blob + str_start..key_table_offset + key_length];
                        let nul = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
                        let s = String::from_utf8_lossy(&slice[..nul]).into_owned();
                        key_table.insert(crc, s);
                    }
                }
            }
        }
    }

    let mut flat_entries = Vec::new();
    {
        let mut pos = 16usize;
        let buf_len = string_table_off;
        for _ in 0..entries_count {
            if pos + 5 > buf_len {
                break;
            }
            let crc = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap());
            let param_count = data[pos + 4] as usize;
            pos += 5;

            let type_bytes = param_count.div_ceil(4);
            let mut param_types = Vec::new();
            let mut pi = 0;
            for _ in 0..type_bytes {
                if pos >= buf_len {
                    break;
                }
                let tb = data[pos];
                pos += 1;
                for k in 0..4 {
                    if pi < param_count {
                        param_types.push((tb >> (2 * k)) & 3);
                        pi += 1;
                    }
                }
            }

            let total_header = 5 + type_bytes;
            if !total_header.is_multiple_of(4) {
                pos += 4 - (total_header % 4);
            }

            let name = if let Some(s) = key_table.get(&crc) {
                s.clone()
            } else {
                alloc::format!("UNKNOWN_{:08X}", crc)
            };

            let mut variables = Vec::new();
            for j in 0..param_count {
                if pos + 4 > buf_len {
                    break;
                }
                let val_bytes = &data[pos..pos + 4];
                let ty = param_types.get(j).copied().unwrap_or(0);
                match ty {
                    0 => {
                        let off = i32::from_le_bytes(val_bytes.try_into().unwrap());
                        let s = if off != -1 {
                            strings.get(&off).cloned().unwrap_or_default()
                        } else {
                            String::new()
                        };
                        variables.push(Value::String(s));
                    }
                    1 => {
                        let val = i32::from_le_bytes(val_bytes.try_into().unwrap());
                        variables.push(Value::Int(val));
                    }
                    2 => {
                        let val = f32::from_le_bytes(val_bytes.try_into().unwrap());
                        variables.push(Value::Float(val));
                    }
                    _ => {
                        let val = i32::from_le_bytes(val_bytes.try_into().unwrap());
                        variables.push(Value::Int(val));
                    }
                }
                pos += 4;
            }

            flat_entries.push(CfgEntry {
                name,
                variables,
                children: Vec::new(),
            });
        }
    }

    fn parse_sub(iter: &mut impl Iterator<Item = CfgEntry>) -> Vec<CfgEntry> {
        let mut children = Vec::new();
        while let Some(mut entry) = iter.next() {
            let is_end = entry.name.ends_with("_END") || entry.name == "_PTREE" || entry.name.contains("_END_");
            if entry.variables.is_empty() && is_end {
                break;
            }
            let is_begin = entry.name.ends_with("_BEG") || entry.name.ends_with("_BEGIN") || entry.name.contains("_BEG_") || entry.name.starts_with("PTREE");
            if is_begin {
                entry.children = parse_sub(iter);
            }
            children.push(entry);
        }
        children
    }

    let mut iter = flat_entries.into_iter();
    let entries = parse_sub(&mut iter);

    Ok(CfgBinFile {
        format: Format::T2b,
        entries,
    })
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

    // -------------------------------------------------------------------
    // Décodage des VALEURS — golden values issues du VRAI fichier
    // /home/ubuntu/rg/iecode/re/menu/extracted/fonts/font_color.cfg.bin
    // (copié dans tests/fixtures/). Header tracé octet par octet :
    //   header_size=0x50, version=100, data_offset=0x14(×4=0x50),
    //   type_count=1, field_offset=8, field_count=7, root_offset=0x40,
    //   root_count=1, hash_count=9, value_offset=0x5a(×4+0x50=0x1B8),
    //   string_offset=0x1a68.
    // Liste m_FontColorDataList / type FONT_COLOR / 64 lignes de 100 octets.
    // -------------------------------------------------------------------

    #[cfg(feature = "real-fixtures")]
    const FONT_COLOR_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/font_color.cfg.bin");

    #[cfg(feature = "real-fixtures")]
    #[test]
    fn font_color_header_golden() {
        let rdbn = parse(FONT_COLOR_FIXTURE).expect("parse font_color");
        assert_eq!(rdbn.header.version, 100);
        assert_eq!(rdbn.header.data_offset, 0x50);
        assert_eq!(rdbn.header.type_count, 1);
        assert_eq!(rdbn.header.field_count, 7);
        assert_eq!(rdbn.header.root_count, 1);
        assert_eq!(rdbn.header.hash_count, 9);
        // value_abs = (0x5a << 2) + 0x50 = 0x168 + 0x50 = 0x1B8.
        assert_eq!(rdbn.value_abs, 0x1B8);
        // string_abs = 0x1a68 + 0x50 = 0x1AB8.
        assert_eq!(rdbn.string_abs, 0x1A68 + 0x50);
    }

    #[cfg(feature = "real-fixtures")]
    #[test]
    fn font_color_strings_resolved() {
        let rdbn = parse(FONT_COLOR_FIXTURE).unwrap();
        // 9 chaînes : 1 type + 7 champs + 1 liste.
        assert_eq!(rdbn.strings.entries.len(), 9);
        // Hashes vérifiés via crc32() : tous présents.
        assert_eq!(rdbn.strings.resolve(crc32(b"FONT_COLOR")), Some("FONT_COLOR"));
        assert_eq!(rdbn.strings.resolve(crc32(b"fontColorId")), Some("fontColorId"));
        assert_eq!(rdbn.strings.resolve(crc32(b"red")), Some("red"));
        assert_eq!(rdbn.strings.resolve(crc32(b"m_FontColorDataList")), Some("m_FontColorDataList"));
    }

    #[cfg(feature = "real-fixtures")]
    #[test]
    fn font_color_values_golden() {
        let rdbn = parse(FONT_COLOR_FIXTURE).unwrap();
        let lists = read_values(&rdbn, FONT_COLOR_FIXTURE);

        assert_eq!(lists.len(), 1);
        let list = &lists[0];
        assert_eq!(list.name, "m_FontColorDataList");
        assert_eq!(list.type_name, "FONT_COLOR");
        // root.value_count = 0x40 = 64 lignes.
        assert_eq!(list.rows.len(), 64);

        // Ligne 0 : 7 champs dans l'ordre du type.
        let r0 = &list.rows[0];
        assert_eq!(r0.fields.len(), 7);
        // Noms de champs résolus, dans l'ordre.
        let names: Vec<&str> = r0.fields.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["fontColorId", "red", "green", "blue", "rubiRed", "rubiGreen", "rubiBlue"]);

        // Valeurs golden de la ligne 0, lues @0x1B8 (tracées au xxd) :
        //   fontColorId (Hash) = 0x270d2bda
        //   red=245 green=230 blue=245 rubiRed=245 rubiGreen=245 rubiBlue=230
        assert_eq!(r0.fields[0].1, RdbnValue::Hash(0x270D_2BDA));
        assert_eq!(r0.fields[1].1, RdbnValue::Int(245));
        assert_eq!(r0.fields[2].1, RdbnValue::Int(230));
        assert_eq!(r0.fields[3].1, RdbnValue::Int(245));
        assert_eq!(r0.fields[4].1, RdbnValue::Int(245));
        assert_eq!(r0.fields[5].1, RdbnValue::Int(245));
        assert_eq!(r0.fields[6].1, RdbnValue::Int(230));
    }

    #[test]
    fn read_field_value_types_synthetiques() {
        // Vérifie chaque branche du switch sur des octets contrôlés.
        // Bool (3)
        let f = |t: RdbnFieldType, size: i32| RdbnFieldEntry {
            name_hash: 0,
            field_type: t,
            type_category: 0,
            value_size: size,
            value_offset: 0,
            value_count: 1,
        };
        assert_eq!(read_field_value(&[1], 0, &f(RdbnFieldType::Bool, 1), 0), RdbnValue::Bool(true));
        assert_eq!(read_field_value(&[0], 0, &f(RdbnFieldType::Bool, 1), 0), RdbnValue::Bool(false));
        assert_eq!(read_field_value(&[0xAB], 0, &f(RdbnFieldType::Byte, 1), 0), RdbnValue::Byte(0xAB));
        assert_eq!(
            read_field_value(&0x1234i16.to_le_bytes(), 0, &f(RdbnFieldType::Short, 2), 0),
            RdbnValue::Short(0x1234)
        );
        assert_eq!(
            read_field_value(&(-5i32).to_le_bytes(), 0, &f(RdbnFieldType::Int, 4), 0),
            RdbnValue::Int(-5)
        );
        assert_eq!(
            read_field_value(&1.5f32.to_le_bytes(), 0, &f(RdbnFieldType::Float, 4), 0),
            RdbnValue::Float(1.5)
        );
        assert_eq!(
            read_field_value(&0xDEAD_BEEFu32.to_le_bytes(), 0, &f(RdbnFieldType::Hash, 4), 0),
            RdbnValue::Hash(0xDEAD_BEEF)
        );
        // ShortTuple (21) : 2 i16.
        let mut buf = Vec::new();
        buf.extend_from_slice(&3i16.to_le_bytes());
        buf.extend_from_slice(&7i16.to_le_bytes());
        assert_eq!(
            read_field_value(&buf, 0, &f(RdbnFieldType::ShortTuple, 4), 0),
            RdbnValue::ShortTuple([3, 7])
        );
        // Rates (18) : 4 floats.
        let mut rb = Vec::new();
        for x in [1.0f32, 2.0, 3.0, 4.0] {
            rb.extend_from_slice(&x.to_le_bytes());
        }
        assert_eq!(
            read_field_value(&rb, 0, &f(RdbnFieldType::Rates, 16), 0),
            RdbnValue::Rates([1.0, 2.0, 3.0, 4.0])
        );
        // Hors limites ⇒ Invalid.
        assert_eq!(read_field_value(&[0u8; 2], 0, &f(RdbnFieldType::Int, 4), 0), RdbnValue::Invalid);
        // Type inconnu / blob (AbilityData=0) ⇒ octets bruts.
        assert_eq!(
            read_field_value(&[1, 2, 3, 4], 0, &f(RdbnFieldType::AbilityData, 4), 0),
            RdbnValue::Blob(alloc::vec![1, 2, 3, 4])
        );
    }

    #[test]
    fn condition_value_resolution() {
        // Table de chaînes synthétique : string_abs=8, à +8 "ABC\0".
        // Champ Condition à offset 0 contenant u32 = 0 → pointe sur "ABC".
        let mut buf = alloc::vec![0u8; 4];
        buf.extend_from_slice(b"ABC\0");
        // value (u32 @0) = 0 → str_pos = string_abs(4) + 0 = 4 → "ABC".
        let v = read_condition_value(&buf, 0, 4);
        assert_eq!(v, RdbnValue::Condition("ABC".into()));
    }

    // -------------------------------------------------------------------
    // parse_t2b : robustesse en-tête (anti-panic sur données chiffrées)
    // -------------------------------------------------------------------

    /// En-tête T2B avec offset de table de chaînes négatif (i32 = -1) : caster en `usize`
    /// donne `usize::MAX`, et l'addition `off + len` débordait (panic debug / wrap release).
    /// Doit désormais renvoyer `Corrupt` proprement, jamais paniquer.
    #[test]
    fn parse_t2b_offset_negatif_ne_panique_pas() {
        let mut data = alloc::vec![0u8; 16];
        data[0..4].copy_from_slice(&1i32.to_le_bytes()); // entries_count = 1
        data[4..8].copy_from_slice(&(-1i32).to_le_bytes()); // string_table_off = -1
        data[8..12].copy_from_slice(&16i32.to_le_bytes()); // string_table_len = 16
        let r = parse_t2b(&data);
        assert!(matches!(r, Err(FormatError::Corrupt(_))), "got {r:?}");
    }

    /// Offset + longueur tous deux énormes mais positifs : `checked_add` doit intercepter
    /// le débordement et renvoyer `Corrupt`.
    #[test]
    fn parse_t2b_overflow_offset_plus_len() {
        let mut data = alloc::vec![0u8; 16];
        data[0..4].copy_from_slice(&0i32.to_le_bytes());
        data[4..8].copy_from_slice(&i32::MAX.to_le_bytes()); // off = 2^31-1
        data[8..12].copy_from_slice(&i32::MAX.to_le_bytes()); // len = 2^31-1
        // off + len = ~2^32 < usize::MAX sur 64 bits → pas d'overflow usize, mais > data.len()
        // → borne dépassée → Corrupt (et surtout : aucun panic).
        let r = parse_t2b(&data);
        assert!(matches!(r, Err(FormatError::Corrupt(_))), "got {r:?}");
    }

    /// Données chiffrées réalistes (entête haute-entropie type `cpk_list.cfg.bin`) :
    /// le parseur ne doit jamais paniquer, seulement renvoyer une erreur.
    #[test]
    fn parse_t2b_donnees_chiffrees_ne_paniquent_pas() {
        // Premiers octets réels observés sur une install Steam (cpk_list.cfg.bin chiffré).
        let data = [
            0x9du8, 0x9b, 0x87, 0x19, 0x68, 0x0b, 0xd1, 0x32, 0x5d, 0x84, 0x4d, 0xda, 0x05, 0x10,
            0xb0, 0x5b, 0xef, 0xff, 0x11, 0xf6, 0xf3, 0x46, 0x8f, 0xb9, 0xa1, 0x85, 0xd9, 0x3f,
        ];
        let r = parse_t2b(&data);
        assert!(r.is_err(), "données chiffrées doivent échouer proprement, got {r:?}");
    }
}
