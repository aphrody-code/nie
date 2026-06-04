//! Lecteur de tables `@UTF` (Universal Table Format) et d'archives CPK Criware.
//!
//! Port Rust de :
//! - `aphrody/crates/ievr-tools/src/cri.rs` (référence primaire, MIT)
//! - `refs/iecode-re/cli/ffi/rust/cpk-reader/src/utf.rs` (référence secondaire)
//! - `IECODE.Core/Formats/Criware/UtfTable.cs` (référence C# — IECODE)
//!
//! ## Format `@UTF` (wire layout, tout big-endian)
//!
//! ```text
//! Offset  Taille  Champ
//!  0x00     4     Magic "@UTF" (0x40 0x55 0x54 0x46)
//!  0x04     4     table_size  (octets après ces 8 premiers ; « body »)
//!  ─── base relative : byte 8 (= UTF_BASE) ───────────────────────────────────
//!  +0x00    4     rows_offset     (relatif à UTF_BASE)
//!  +0x04    4     string_offset   (relatif à UTF_BASE)
//!  +0x08    4     data_offset     (relatif à UTF_BASE)
//!  +0x0C    4     table_name_off  (offset dans le string pool)
//!  +0x10    2     column_count
//!  +0x12    2     row_stride      (octets par ligne)
//!  +0x14    4     row_count
//!  +0x18    …     descripteurs de colonnes (variable)
//!  …        …     données par ligne
//!  …        …     string pool (chaînes null-terminées UTF-8)
//!  …        …     data pool   (blobs binaires)
//! ```
//!
//! Chaque descripteur de colonne est un octet de flags suivi de 4 octets
//! d'offset de nom dans le string pool.  Voir [`ColumnFlags`].
//!
//! ## Format CPK
//!
//! Un CPK valide (non chiffré) commence par `CPK ` (0x43 0x50 0x4B 0x20)
//! suivi de 12 octets de champs internes, puis d'une table `@UTF` à l'offset 0x10.
//!
//! **Les CPK IEVR sont chiffrés** : leur magic en clair n'est pas `CPK `.
//! [`parse_cpk`] renvoie une erreur explicite dans ce cas.
//!
//! ## `std`
//!
//! Ce module utilise `alloc` (via `Vec`, `String`) ; compatible no_std+alloc.
//! Pas de `std::io`, pas de `byteorder`.

extern crate alloc;
use alloc::{string::String, vec::Vec};

use crate::FormatError;

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/// Magic `@UTF` en big-endian (octets exacts dans le fichier).
const UTF_MAGIC: [u8; 4] = [0x40, 0x55, 0x54, 0x46];

/// Magic `CPK ` en octets.
const CPK_MAGIC: [u8; 4] = *b"CPK ";

/// Offset absolu dans le flux où commence la « base » relative des offsets UTF.
const UTF_BASE: usize = 0x08;

/// Taille minimale d'une table @UTF (header 0x18 + 8 octets outer).
const UTF_MIN_TOTAL: usize = 0x20;

// Flags de stockage (bits 4-7 du byte de flags de colonne).
const STORAGE_ZERO: u8 = 0x00;  // valeur zéro implicite, aucun stockage
const STORAGE_CONST: u8 = 0x10; // valeur constante (défaut dans le schéma)
const STORAGE_ROW: u8 = 0x20;   // valeur par ligne dans la section rows

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/// Type d'une colonne @UTF (bits 0-3 du byte de flags).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[repr(u8)]
pub enum ColumnType {
    /// `u8`
    U8 = 0,
    /// `i8`
    I8 = 1,
    /// `u16`
    U16 = 2,
    /// `i16`
    I16 = 3,
    /// `u32`
    U32 = 4,
    /// `i32`
    I32 = 5,
    /// `u64`
    U64 = 6,
    /// `i64`
    I64 = 7,
    /// `f32`
    F32 = 8,
    /// `f64`
    F64 = 9,
    /// Chaîne nulle-terminée dans le string pool (4 octets d'offset wire).
    String = 10,
    /// Blob binaire dans le data pool (4 octets offset + 4 octets taille wire).
    Bytes = 11,
    /// GUID 16 octets (rare).
    Guid = 12,
}

impl ColumnType {
    /// Taille wire en octets pour une valeur de ce type.
    #[must_use]
    pub fn wire_size(self) -> usize {
        match self {
            Self::U8 | Self::I8 => 1,
            Self::U16 | Self::I16 => 2,
            Self::U32 | Self::I32 | Self::F32 | Self::String => 4,
            Self::U64 | Self::I64 | Self::F64 | Self::Bytes => 8,
            Self::Guid => 16,
        }
    }

    fn from_nibble(v: u8) -> Result<Self, FormatError> {
        Ok(match v {
            0 => Self::U8,
            1 => Self::I8,
            2 => Self::U16,
            3 => Self::I16,
            4 => Self::U32,
            5 => Self::I32,
            6 => Self::U64,
            7 => Self::I64,
            8 => Self::F32,
            9 => Self::F64,
            10 => Self::String,
            11 => Self::Bytes,
            12 => Self::Guid,
            _ => return Err(FormatError::Corrupt("type de colonne @UTF inconnu")),
        })
    }
}

/// Valeur décodée d'une cellule @UTF.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum UtfValue {
    /// Octet non signé.
    U8(u8),
    /// Octet signé.
    I8(i8),
    /// `u16`
    U16(u16),
    /// `i16`
    I16(i16),
    /// `u32`
    U32(u32),
    /// `i32`
    I32(i32),
    /// `u64`
    U64(u64),
    /// `i64`
    I64(i64),
    /// `f32`
    F32(f32),
    /// `f64`
    F64(f64),
    /// Chaîne UTF-8 résolue depuis le string pool.
    String(String),
    /// Blob binaire depuis le data pool.
    Bytes(Vec<u8>),
}

impl UtfValue {
    /// Convertit en `i64` (élargissement des entiers et flottants). Retourne `None` pour les
    /// autres variantes.
    #[must_use]
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Self::U8(v) => Some(*v as i64),
            Self::I8(v) => Some(*v as i64),
            Self::U16(v) => Some(*v as i64),
            Self::I16(v) => Some(*v as i64),
            Self::U32(v) => Some(*v as i64),
            Self::I32(v) => Some(*v as i64),
            Self::U64(v) => Some(*v as i64),
            Self::I64(v) => Some(*v),
            _ => None,
        }
    }

    /// Retourne la référence de chaîne si la valeur est une `String`.
    #[must_use]
    pub fn as_str(&self) -> Option<&str> {
        if let Self::String(s) = self { Some(s) } else { None }
    }

    /// Retourne le slice du blob si la valeur est `Bytes`.
    #[must_use]
    pub fn as_bytes(&self) -> Option<&[u8]> {
        if let Self::Bytes(b) = self { Some(b) } else { None }
    }
}

/// Descripteur d'une colonne @UTF.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct UtfColumn {
    /// Nom résolu depuis le string pool.
    pub name: String,
    /// Type des valeurs de cette colonne.
    pub col_type: ColumnType,
    /// Byte de flags brut (bits 4-7 = stockage, bits 0-3 = type).
    pub flags: u8,
}

/// Table @UTF complètement décodée.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct UtfTable {
    /// Nom de la table (depuis le string pool).
    pub name: String,
    /// Descripteurs de colonnes.
    pub columns: Vec<UtfColumn>,
    /// Lignes de données. Chaque ligne a exactement `columns.len()` valeurs.
    pub rows: Vec<Vec<UtfValue>>,
}

impl UtfTable {
    /// Retourne l'index de la colonne par nom, ou `None`.
    #[must_use]
    pub fn column_index(&self, name: &str) -> Option<usize> {
        self.columns.iter().position(|c| c.name == name)
    }

    /// Retourne la valeur d'une cellule par (ligne, nom de colonne).
    #[must_use]
    pub fn get(&self, row: usize, col: &str) -> Option<&UtfValue> {
        let ci = self.column_index(col)?;
        self.rows.get(row)?.get(ci)
    }

    /// Raccourci : valeur entière (élargissement).
    #[must_use]
    pub fn get_i64(&self, row: usize, col: &str) -> Option<i64> {
        self.get(row, col)?.as_i64()
    }

    /// Raccourci : référence de chaîne.
    #[must_use]
    pub fn get_str(&self, row: usize, col: &str) -> Option<&str> {
        self.get(row, col)?.as_str()
    }

    /// Nombre de lignes.
    #[must_use]
    pub fn row_count(&self) -> usize {
        self.rows.len()
    }

    /// Nombre de colonnes.
    #[must_use]
    pub fn column_count(&self) -> usize {
        self.columns.len()
    }
}

/// En-tête d'archive CPK (table @UTF embarquée).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CpkHeader {
    /// Table @UTF du header CPK.
    pub utf: UtfTable,
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/// Vrai si `data` commence par le magic `@UTF`.
#[must_use]
pub fn is_utf(data: &[u8]) -> bool {
    data.starts_with(&UTF_MAGIC)
}

/// Parse une table @UTF depuis un slice d'octets.
///
/// Le slice doit commencer exactement au magic `@UTF`.
///
/// # Erreurs
///
/// - [`FormatError::TooShort`] si le tampon est trop court.
/// - [`FormatError::BadMagic`] si le magic est invalide.
/// - [`FormatError::Corrupt`] pour toute incohérence interne.
pub fn parse_utf(data: &[u8]) -> Result<UtfTable, FormatError> {
    if data.len() < UTF_MIN_TOTAL {
        return Err(FormatError::TooShort { got: data.len(), need: UTF_MIN_TOTAL });
    }
    if !is_utf(data) {
        return Err(FormatError::BadMagic { format: "@UTF" });
    }

    let table_size = read_u32_be(data, 4)? as usize;
    // Vérification souple : on n'exige pas que data.len() == 8 + table_size (sous-table possible).
    let _ = table_size;

    // Tous les offsets internes sont relatifs à UTF_BASE (= 0x08).
    let rows_offset = read_u32_be(data, UTF_BASE)? as usize + UTF_BASE;
    let string_pool = read_u32_be(data, UTF_BASE + 4)? as usize + UTF_BASE;
    let data_pool = read_u32_be(data, UTF_BASE + 8)? as usize + UTF_BASE;
    let table_name_off = read_u32_be(data, UTF_BASE + 12)? as usize;
    let col_count = read_u16_be(data, UTF_BASE + 16)? as usize;
    let row_stride = read_u16_be(data, UTF_BASE + 18)? as usize;
    let row_count = read_u32_be(data, UTF_BASE + 20)? as usize;

    if string_pool > data.len() {
        return Err(FormatError::Corrupt("@UTF : string pool hors limites"));
    }

    let table_name = read_cstr(data, string_pool, table_name_off)?;

    // --- Schéma des colonnes ---
    // Les descripteurs commencent à l'offset 0x20.
    // Chaque descripteur = 1 octet flags + 4 octets name_off = 5 octets minimaux.
    // Si la colonne a HasDefault (0x20), la valeur par défaut suit immédiatement.

    // Structs internes pour les colonnes.
    struct ColDef {
        col_type: ColumnType,
        flags: u8,
        name: String,
        default_value: Option<UtfValue>,
    }

    let mut col_defs: Vec<ColDef> = Vec::with_capacity(col_count);
    let mut col_off = 0x20usize;

    for i in 0..col_count {
        if col_off >= data.len() {
            return Err(FormatError::Corrupt("@UTF : EOF dans le schéma"));
        }
        let flags = data[col_off];
        col_off += 1;

        let type_nibble = flags & 0x0F;
        let storage_class = flags & 0xF0;
        let col_type = ColumnType::from_nibble(type_nibble)?;

        // Offset du nom dans le string pool.
        let name_off = read_u32_be(data, col_off)? as usize;
        col_off += 4;
        let name = read_cstr(data, string_pool, name_off)
            .unwrap_or_else(|_| alloc::format!("col_{i}"));

        // Valeur par défaut (uniquement pour STORAGE_CONST).
        let default_value = if storage_class == STORAGE_CONST {
            let val = read_value(data, col_off, col_type, string_pool, data_pool)?;
            col_off += col_type.wire_size();
            Some(val)
        } else {
            None
        };

        col_defs.push(ColDef { col_type, flags, name, default_value });
    }

    // --- Lignes ---
    let mut rows: Vec<Vec<UtfValue>> = Vec::with_capacity(row_count);
    for r in 0..row_count {
        let row_base = rows_offset + r * row_stride;
        let mut row_cursor = row_base;
        let mut row: Vec<UtfValue> = Vec::with_capacity(col_count);

        for def in &col_defs {
            let storage = def.flags & 0xF0;
            let val = match storage {
                STORAGE_ZERO => zero_value(def.col_type),
                STORAGE_CONST => {
                    def.default_value.clone().ok_or(FormatError::Corrupt(
                        "@UTF : valeur constante manquante",
                    ))?
                },
                STORAGE_ROW => {
                    let v = read_value(data, row_cursor, def.col_type, string_pool, data_pool)?;
                    row_cursor += def.col_type.wire_size();
                    v
                },
                _ => return Err(FormatError::Corrupt("@UTF : classe de stockage inconnue")),
            };
            row.push(val);
        }
        rows.push(row);
    }

    let columns: Vec<UtfColumn> = col_defs
        .into_iter()
        .map(|d| UtfColumn { name: d.name, col_type: d.col_type, flags: d.flags })
        .collect();

    Ok(UtfTable { name: table_name, columns, rows })
}

/// Parse l'en-tête d'une archive CPK (non chiffrée).
///
/// `data` doit pointer vers l'offset 0 du fichier CPK.
///
/// # Erreurs
///
/// - [`FormatError::BadMagic`] si le magic n'est pas `CPK ` (les CPK IEVR chiffrés
///   échouent ici systématiquement — c'est attendu).
/// - Toute erreur de [`parse_utf`] pour la table embarquée.
pub fn parse_cpk(data: &[u8]) -> Result<CpkHeader, FormatError> {
    if data.len() < 0x14 {
        return Err(FormatError::TooShort { got: data.len(), need: 0x14 });
    }
    if data[..4] != CPK_MAGIC {
        return Err(FormatError::BadMagic { format: "CPK" });
    }
    // 12 octets de champs internes CPK → la table @UTF commence à 0x10.
    let utf = parse_utf(&data[0x10..])?;
    Ok(CpkHeader { utf })
}

// ---------------------------------------------------------------------------
// Helpers internes (pas d'unsafe, no_std-friendly)
// ---------------------------------------------------------------------------

fn read_u8(data: &[u8], off: usize) -> Result<u8, FormatError> {
    data.get(off).copied().ok_or(FormatError::Corrupt("@UTF : lecture u8 hors limites"))
}

fn read_u16_be(data: &[u8], off: usize) -> Result<u16, FormatError> {
    let bytes: [u8; 2] = data
        .get(off..off + 2)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("@UTF : lecture u16 hors limites"))?;
    Ok(u16::from_be_bytes(bytes))
}

fn read_u32_be(data: &[u8], off: usize) -> Result<u32, FormatError> {
    let bytes: [u8; 4] = data
        .get(off..off + 4)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("@UTF : lecture u32 hors limites"))?;
    Ok(u32::from_be_bytes(bytes))
}

fn read_u64_be(data: &[u8], off: usize) -> Result<u64, FormatError> {
    let bytes: [u8; 8] = data
        .get(off..off + 8)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("@UTF : lecture u64 hors limites"))?;
    Ok(u64::from_be_bytes(bytes))
}

fn read_cstr(data: &[u8], pool_base: usize, pool_off: usize) -> Result<String, FormatError> {
    let start = pool_base
        .checked_add(pool_off)
        .ok_or(FormatError::Corrupt("@UTF : overflow offset string pool"))?;
    if start >= data.len() {
        return Err(FormatError::Corrupt("@UTF : offset string pool hors limites"));
    }
    let slice = &data[start..];
    let nul = slice
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(slice.len());
    // Accepte du latin-1 de façon permissive via from_utf8_lossy.
    let s = alloc::string::ToString::to_string(
        &alloc::string::String::from_utf8_lossy(&slice[..nul]),
    );
    Ok(s)
}

fn zero_value(col_type: ColumnType) -> UtfValue {
    match col_type {
        ColumnType::U8 => UtfValue::U8(0),
        ColumnType::I8 => UtfValue::I8(0),
        ColumnType::U16 => UtfValue::U16(0),
        ColumnType::I16 => UtfValue::I16(0),
        ColumnType::U32 => UtfValue::U32(0),
        ColumnType::I32 => UtfValue::I32(0),
        ColumnType::U64 => UtfValue::U64(0),
        ColumnType::I64 => UtfValue::I64(0),
        ColumnType::F32 => UtfValue::F32(0.0),
        ColumnType::F64 => UtfValue::F64(0.0),
        ColumnType::String => UtfValue::String(String::new()),
        ColumnType::Bytes | ColumnType::Guid => UtfValue::Bytes(Vec::new()),
    }
}

fn read_value(
    data: &[u8],
    off: usize,
    col_type: ColumnType,
    string_pool: usize,
    data_pool: usize,
) -> Result<UtfValue, FormatError> {
    Ok(match col_type {
        ColumnType::U8 => UtfValue::U8(read_u8(data, off)?),
        ColumnType::I8 => UtfValue::I8(read_u8(data, off)? as i8),
        ColumnType::U16 => UtfValue::U16(read_u16_be(data, off)?),
        ColumnType::I16 => UtfValue::I16(read_u16_be(data, off)? as i16),
        ColumnType::U32 => UtfValue::U32(read_u32_be(data, off)?),
        ColumnType::I32 => UtfValue::I32(read_u32_be(data, off)? as i32),
        ColumnType::U64 => UtfValue::U64(read_u64_be(data, off)?),
        ColumnType::I64 => UtfValue::I64(read_u64_be(data, off)? as i64),
        ColumnType::F32 => {
            let bits = read_u32_be(data, off)?;
            UtfValue::F32(f32::from_bits(bits))
        },
        ColumnType::F64 => {
            let bits = read_u64_be(data, off)?;
            UtfValue::F64(f64::from_bits(bits))
        },
        ColumnType::String => {
            let pool_off = read_u32_be(data, off)? as usize;
            UtfValue::String(read_cstr(data, string_pool, pool_off)?)
        },
        ColumnType::Bytes => {
            let blob_off = read_u32_be(data, off)? as usize;
            let blob_len = read_u32_be(data, off + 4)? as usize;
            let abs_start = data_pool.checked_add(blob_off)
                .ok_or(FormatError::Corrupt("@UTF : overflow data pool"))?;
            if blob_len == 0 {
                UtfValue::Bytes(Vec::new())
            } else {
                let abs_end = abs_start.checked_add(blob_len)
                    .ok_or(FormatError::Corrupt("@UTF : overflow blob end"))?;
                if abs_end > data.len() {
                    return Err(FormatError::Corrupt("@UTF : blob data hors limites"));
                }
                UtfValue::Bytes(data[abs_start..abs_end].to_vec())
            }
        },
        ColumnType::Guid => {
            if off + 16 > data.len() {
                UtfValue::Bytes(Vec::new())
            } else {
                UtfValue::Bytes(data[off..off + 16].to_vec())
            }
        },
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------
    // Constructeur de table @UTF minimale pour les tests
    // -------------------------------------------------------------------

    /// Construit une table @UTF avec 2 colonnes et 2 lignes.
    ///
    /// - Col 0 "ColA" : U32, STORAGE_ROW (flags 0x24)
    /// - Col 1 "ColB" : String, STORAGE_ROW (flags 0x2A)
    /// - Ligne 0 : ColA=42, ColB="hello"
    /// - Ligne 1 : ColA=99, ColB="world"
    fn build_utf_fixture() -> Vec<u8> {
        // String pool (null-terminated, compact)
        // Offset 0  : "TestTable\0" (10)
        // Offset 10 : "ColA\0"      (5)
        // Offset 15 : "ColB\0"      (5)
        // Offset 20 : "hello\0"     (6)
        // Offset 26 : "world\0"     (6)
        let string_pool: &[u8] =
            b"TestTable\0ColA\0ColB\0hello\0world\0";
        assert_eq!(string_pool.len(), 32);

        // Schéma : 2 colonnes × 5 octets.
        let schema: &[u8] = &[
            0x24, 0x00, 0x00, 0x00, 0x0A, // Col 0 : flags=0x24 (ROW|U32), name_off=10
            0x2A, 0x00, 0x00, 0x00, 0x0F, // Col 1 : flags=0x2A (ROW|String), name_off=15
        ];

        // Row data : 2 lignes, stride = 8 (4 + 4).
        let row_data: &[u8] = &[
            // Ligne 0
            0x00, 0x00, 0x00, 42,  // ColA = 42
            0x00, 0x00, 0x00, 20,  // ColB → pool[20] = "hello"
            // Ligne 1
            0x00, 0x00, 0x00, 99,  // ColA = 99
            0x00, 0x00, 0x00, 26,  // ColB → pool[26] = "world"
        ];

        // Calcul des offsets (relatifs à UTF_BASE = 0x08).
        //
        // Layout du body (corps après les 8 octets outer header) :
        //  body[0x00..0x18)  → header body (24 octets)
        //  body[0x18..0x22)  → schéma 2 colonnes × 5 octets = 10 octets
        //  body[0x22..0x32)  → row data 2 lignes × 8 octets = 16 octets
        //  body[0x32..0x52)  → string pool 32 octets
        //  body[0x52..)      → data pool (vide)
        //
        // Les offsets stockés dans le header body sont des positions dans le body
        // (= position absolue dans `data` - UTF_BASE) :
        //   rows_offset_rel   = 0x22  (body[0x22])
        //   string_offset_rel = 0x32  (body[0x32])
        //   data_offset_rel   = 0x52  (body[0x52])
        //   table_name_off    = 0     (pool[0] = "TestTable")

        let rows_offset_rel: u32 = 0x22;
        let string_offset_rel: u32 = 0x32;
        let data_offset_rel: u32 = 0x52;
        let table_name_off: u32 = 0;
        let col_count: u16 = 2;
        let row_stride: u16 = 8;
        let row_count: u32 = 2;

        let mut body: Vec<u8> = Vec::new();
        // Header body (0x18 octets).
        body.extend_from_slice(&rows_offset_rel.to_be_bytes());    // +0x00
        body.extend_from_slice(&string_offset_rel.to_be_bytes());  // +0x04
        body.extend_from_slice(&data_offset_rel.to_be_bytes());    // +0x08
        body.extend_from_slice(&table_name_off.to_be_bytes());     // +0x0C
        body.extend_from_slice(&col_count.to_be_bytes());          // +0x10
        body.extend_from_slice(&row_stride.to_be_bytes());         // +0x12
        body.extend_from_slice(&row_count.to_be_bytes());          // +0x14
        // Schema.
        body.extend_from_slice(schema);
        // Row data.
        body.extend_from_slice(row_data);
        // String pool.
        body.extend_from_slice(string_pool);
        // Data pool (vide).

        // Outer header : magic + table_size.
        let table_size = body.len() as u32;
        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(&UTF_MAGIC);
        out.extend_from_slice(&table_size.to_be_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn parse_fixture_deux_lignes() {
        let data = build_utf_fixture();
        let table = parse_utf(&data).expect("parse_utf doit réussir sur la fixture");

        assert_eq!(table.name, "TestTable");
        assert_eq!(table.columns.len(), 2);
        assert_eq!(table.columns[0].name, "ColA");
        assert_eq!(table.columns[1].name, "ColB");
        assert_eq!(table.row_count(), 2);

        assert_eq!(table.rows[0][0], UtfValue::U32(42));
        assert_eq!(table.rows[0][1], UtfValue::String("hello".into()));
        assert_eq!(table.rows[1][0], UtfValue::U32(99));
        assert_eq!(table.rows[1][1], UtfValue::String("world".into()));
    }

    #[test]
    fn get_helpers() {
        let data = build_utf_fixture();
        let table = parse_utf(&data).unwrap();

        assert_eq!(table.get_i64(0, "ColA"), Some(42));
        assert_eq!(table.get_str(1, "ColB"), Some("world"));
        assert_eq!(table.get(0, "Inconnu"), None);
    }

    #[test]
    fn mauvais_magic_utf_rejete() {
        let mut data = build_utf_fixture();
        data[0] = b'X';
        assert!(matches!(parse_utf(&data), Err(FormatError::BadMagic { .. })));
    }

    #[test]
    fn trop_court_rejete() {
        let data = b"@UTF\x00\x00\x00\x0F"; // trop court (< 0x20)
        assert!(matches!(parse_utf(data), Err(FormatError::TooShort { .. })));
    }

    #[test]
    fn cpk_mauvais_magic_rejete() {
        let data = build_utf_fixture();
        // Préfixe avec un faux magic CPK (4 octets) + 12 zéros d'en-tête interne.
        let mut cpk_data = alloc::vec![b'X', b'P', b'K', b' '];
        cpk_data.extend_from_slice(&[0u8; 12]);
        cpk_data.extend_from_slice(&data);
        assert!(matches!(parse_cpk(&cpk_data), Err(FormatError::BadMagic { .. })));
    }

    #[test]
    fn cpk_valide_parse() {
        let utf_bytes = build_utf_fixture();
        let mut cpk_data: Vec<u8> = Vec::new();
        cpk_data.extend_from_slice(&CPK_MAGIC);
        cpk_data.extend_from_slice(&[0u8; 12]);
        cpk_data.extend_from_slice(&utf_bytes);

        let header = parse_cpk(&cpk_data).expect("CPK valide doit être parsé");
        assert_eq!(header.utf.name, "TestTable");
        assert_eq!(header.utf.row_count(), 2);
    }

    #[test]
    fn is_utf_detection() {
        assert!(is_utf(&UTF_MAGIC));
        assert!(is_utf(b"@UTF\x00\x00\x00\x00\x00"));
        assert!(!is_utf(b"@utF\x00\x00\x00\x00"));
        assert!(!is_utf(b""));
    }

    #[test]
    fn storage_zero_produit_valeur_nulle() {
        // Construire une table avec une colonne STORAGE_ZERO (flags = 0x04, pas de 0x20 ni 0x40).
        // Elle doit produire UtfValue::U32(0) pour chaque ligne.

        // String pool minimal.
        let string_pool: &[u8] = b"\0ColZ\0"; // table_name = "" (off 0), col = "ColZ" (off 1)

        // Schema : 1 col, flags = 0x04 (STORAGE_ZERO | U32), name_off = 1.
        let schema: &[u8] = &[0x04, 0x00, 0x00, 0x00, 0x01];

        // 1 ligne, stride = 0 (aucune col row-storage).
        let row_data: &[u8] = &[];

        let rows_offset_rel: u32 = 0x13; // 0x18 - 0x08 + schema.len()
        let string_offset_rel: u32 = rows_offset_rel;
        let data_offset_rel: u32 = string_offset_rel + string_pool.len() as u32;

        let mut body: Vec<u8> = Vec::new();
        body.extend_from_slice(&rows_offset_rel.to_be_bytes());
        body.extend_from_slice(&string_offset_rel.to_be_bytes());
        body.extend_from_slice(&data_offset_rel.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes()); // table_name_off = 0
        body.extend_from_slice(&1u16.to_be_bytes()); // col_count = 1
        body.extend_from_slice(&0u16.to_be_bytes()); // row_stride = 0
        body.extend_from_slice(&1u32.to_be_bytes()); // row_count = 1
        body.extend_from_slice(schema);
        body.extend_from_slice(row_data);
        body.extend_from_slice(string_pool);

        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(&UTF_MAGIC);
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend_from_slice(&body);

        let table = parse_utf(&out).expect("STORAGE_ZERO doit parser");
        assert_eq!(table.row_count(), 1);
        assert_eq!(table.rows[0][0], UtfValue::U32(0));
    }

    #[test]
    fn storage_const_partage_meme_valeur() {
        // Col STORAGE_CONST U32 = 0xFF pour chaque ligne.
        // flags = 0x14 (STORAGE_CONST=0x10 | U32=0x04), default value = 0xFF.

        let string_pool: &[u8] = b"\0ConstCol\0";
        let schema: &[u8] = &[
            0x14,                     // flags = CONST | U32
            0x00, 0x00, 0x00, 0x01,   // name_off = 1 → "ConstCol"
            0x00, 0x00, 0x00, 0xFF,   // valeur par défaut U32 = 255
        ];

        // body header = 0x18 octets, schema = 9 octets → rows commencent à body[0x21]
        // rows_offset relatif à base (0x08) = 0x21
        let rows_offset_rel: u32 = 0x21;
        let string_offset_rel: u32 = rows_offset_rel; // stride=0, 2 lignes → 0 octets de row data
        let data_offset_rel: u32 = string_offset_rel + string_pool.len() as u32;

        let mut body: Vec<u8> = Vec::new();
        body.extend_from_slice(&rows_offset_rel.to_be_bytes());
        body.extend_from_slice(&string_offset_rel.to_be_bytes());
        body.extend_from_slice(&data_offset_rel.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes()); // table_name_off = 0 → ""
        body.extend_from_slice(&1u16.to_be_bytes()); // col_count = 1
        body.extend_from_slice(&0u16.to_be_bytes()); // row_stride = 0 (col est CONST)
        body.extend_from_slice(&2u32.to_be_bytes()); // row_count = 2
        body.extend_from_slice(schema);
        // Pas de row data (stride = 0).
        body.extend_from_slice(string_pool);

        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(&UTF_MAGIC);
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend_from_slice(&body);

        let table = parse_utf(&out).expect("STORAGE_CONST doit parser");
        assert_eq!(table.row_count(), 2);
        assert_eq!(table.rows[0][0], UtfValue::U32(255));
        assert_eq!(table.rows[1][0], UtfValue::U32(255));
    }
}
