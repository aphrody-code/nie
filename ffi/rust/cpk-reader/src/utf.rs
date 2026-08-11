//! Parser for CRI "@UTF" (Universal Table Format) tables.
//!
//! UTF is a big-endian row-column binary table format used throughout CRI
//! Middleware (CPK, ACB, AWB, USM).  Tables may optionally be encrypted
//! with `cri_decrypt_table` before the "@UTF" magic appears.
//!
//! Wire layout (all multi-byte fields are big-endian):
//!   offset 0x00  u32  magic ("@UTF" = 0x46545540 LE)
//!   offset 0x04  u32  table_size  (excludes the 8-byte outer header)
//!   offset 0x08  --- base for all relative offsets ---
//!   offset 0x08  u16  unknown (usually 0)
//!   offset 0x0A  u16  rows_offset   (relative to 0x08)
//!   offset 0x0C  u32  string_offset (relative to 0x08)
//!   offset 0x10  u32  data_offset   (relative to 0x08)
//!   offset 0x14  u32  table_name_offset (into string pool)
//!   offset 0x18  u16  column_count
//!   offset 0x1A  u16  row_stride
//!   offset 0x1C  u32  row_count
//!   offset 0x20  ...  column definitions
//!   ...           ...  row data
//!   ...           ...  string pool
//!   ...           ...  data pool

use crate::crypto;
use std::io;

// ─── Constants ────────────────────────────────────────────────────────────────

/// "@UTF" as little-endian u32 (the byte order of the raw magic field).
const UTF_MAGIC_LE: u32 = 0x46545540;

/// Encrypted magic value (first u32 before decryption).
const UTF_ENCRYPTED_MAGIC: u32 = 0x1F9EF3F5;

/// Absolute base offset for relative fields (right after the outer 8-byte header).
const UTF_BASE: usize = 0x08;

/// Minimum header size in bytes.
const UTF_MIN_SIZE: usize = 0x20;

// Column storage flags (bits 4-6 of the flag byte).
const FLAG_HAS_NAME: u8 = 0x10;
const FLAG_HAS_DEFAULT: u8 = 0x20;
const FLAG_ROW_STORAGE: u8 = 0x40;

// ─── Public types ─────────────────────────────────────────────────────────────

/// Column type discriminant (bits 0-3 of the flag byte).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ColumnType {
    Byte = 0,
    SByte = 1,
    UInt16 = 2,
    Int16 = 3,
    UInt32 = 4,
    Int32 = 5,
    UInt64 = 6,
    Int64 = 7,
    Single = 8,
    Double = 9,
    String = 10,
    Data = 11,
    Guid = 12,
}

impl ColumnType {
    fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Byte),
            1 => Some(Self::SByte),
            2 => Some(Self::UInt16),
            3 => Some(Self::Int16),
            4 => Some(Self::UInt32),
            5 => Some(Self::Int32),
            6 => Some(Self::UInt64),
            7 => Some(Self::Int64),
            8 => Some(Self::Single),
            9 => Some(Self::Double),
            10 => Some(Self::String),
            11 => Some(Self::Data),
            12 => Some(Self::Guid),
            _ => None,
        }
    }

    /// Wire size in bytes for one value of this type.
    pub fn wire_size(self) -> usize {
        match self {
            Self::Byte | Self::SByte => 1,
            Self::UInt16 | Self::Int16 => 2,
            Self::UInt32 | Self::Int32 | Self::Single => 4,
            Self::UInt64 | Self::Int64 | Self::Double => 8,
            Self::String => 4,
            Self::Data => 8,
            Self::Guid => 16,
        }
    }
}

/// A single cell value (untagged union over all possible column types).
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    U8(u8),
    U16(u16),
    U32(u32),
    U64(u64),
    F32(f32),
    F64(f64),
    Str(String),
    Blob(Vec<u8>),
}

impl Value {
    /// Extract as i64, widening any integer variant.  Returns `None` for
    /// non-integer types.
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::U8(v) => Some(*v as i64),
            Value::U16(v) => Some(*v as i64),
            Value::U32(v) => Some(*v as i64),
            Value::U64(v) => Some(*v as i64),
            _ => None,
        }
    }

    /// Extract as `u64`, widening any integer variant.
    pub fn as_u64(&self) -> Option<u64> {
        self.as_i64().map(|v| v as u64)
    }

    /// Extract the string payload, if any.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }
}

/// A column descriptor.
#[derive(Debug, Clone)]
pub struct Column {
    pub name: String,
    pub col_type: ColumnType,
}

/// One row — a flat Vec of values aligned to the column list.
#[derive(Debug, Clone)]
pub struct Row {
    pub values: Vec<Value>,
}

/// A fully-parsed UTF table.
#[derive(Debug, Clone)]
pub struct UtfTable {
    pub name: String,
    pub columns: Vec<Column>,
    pub rows: Vec<Row>,
}

impl UtfTable {
    /// Find the column index by name.
    pub fn column_index(&self, name: &str) -> Option<usize> {
        self.columns.iter().position(|c| c.name == name)
    }

    /// Get a value by row index and column name.
    pub fn get(&self, row: usize, col: &str) -> Option<&Value> {
        let ci = self.column_index(col)?;
        self.rows.get(row)?.values.get(ci)
    }

    /// Convenience: get as i64.
    pub fn get_i64(&self, row: usize, col: &str) -> Option<i64> {
        self.get(row, col)?.as_i64()
    }

    /// Convenience: get as string reference.
    pub fn get_str(&self, row: usize, col: &str) -> Option<&str> {
        self.get(row, col)?.as_str()
    }
}

// ─── Internal column definition (includes per-column default) ────────────────

struct ColDef {
    name: String,
    col_type: ColumnType,
    has_default: bool,
    is_row_storage: bool,
    default_value: Option<Value>,
}

// ─── Byte reader helpers (big-endian) ────────────────────────────────────────

fn read_u8(data: &[u8], off: usize) -> Option<u8> {
    data.get(off).copied()
}

fn read_u16_be(data: &[u8], off: usize) -> Option<u16> {
    let bytes: [u8; 2] = data.get(off..off + 2)?.try_into().ok()?;
    Some(u16::from_be_bytes(bytes))
}

fn read_u32_be(data: &[u8], off: usize) -> Option<u32> {
    let bytes: [u8; 4] = data.get(off..off + 4)?.try_into().ok()?;
    Some(u32::from_be_bytes(bytes))
}

fn read_u64_be(data: &[u8], off: usize) -> Option<u64> {
    let bytes: [u8; 8] = data.get(off..off + 8)?.try_into().ok()?;
    Some(u64::from_be_bytes(bytes))
}

fn read_f32_be(data: &[u8], off: usize) -> Option<f32> {
    read_u32_be(data, off).map(f32::from_bits)
}

fn read_f64_be(data: &[u8], off: usize) -> Option<f64> {
    read_u64_be(data, off).map(f64::from_bits)
}

fn read_u32_le(data: &[u8], off: usize) -> Option<u32> {
    let bytes: [u8; 4] = data.get(off..off + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}

fn read_cstr(data: &[u8], abs_off: usize) -> String {
    let slice = data.get(abs_off..).unwrap_or(&[]);
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..end]).into_owned()
}

// ─── Value reader ────────────────────────────────────────────────────────────

fn read_value(
    data: &[u8],
    off: usize,
    col_type: ColumnType,
    string_pool: usize,
    data_pool: usize,
) -> Option<Value> {
    match col_type {
        ColumnType::Byte | ColumnType::SByte => Some(Value::U8(read_u8(data, off)?)),
        ColumnType::UInt16 | ColumnType::Int16 => Some(Value::U16(read_u16_be(data, off)?)),
        ColumnType::UInt32 | ColumnType::Int32 => Some(Value::U32(read_u32_be(data, off)?)),
        ColumnType::UInt64 | ColumnType::Int64 => Some(Value::U64(read_u64_be(data, off)?)),
        ColumnType::Single => Some(Value::F32(read_f32_be(data, off)?)),
        ColumnType::Double => Some(Value::F64(read_f64_be(data, off)?)),
        ColumnType::String => {
            let str_off = read_u32_be(data, off)? as usize;
            Some(Value::Str(read_cstr(data, string_pool + str_off)))
        }
        ColumnType::Data => {
            let blob_off = read_u32_be(data, off)? as usize;
            let blob_size = read_u32_be(data, off + 4)? as usize;
            let abs = data_pool + blob_off;
            if blob_size == 0 || abs + blob_size > data.len() {
                Some(Value::Blob(vec![]))
            } else {
                Some(Value::Blob(data[abs..abs + blob_size].to_vec()))
            }
        }
        ColumnType::Guid => {
            if off + 16 > data.len() {
                Some(Value::Blob(vec![]))
            } else {
                Some(Value::Blob(data[off..off + 16].to_vec()))
            }
        }
    }
}

fn zero_value(col_type: ColumnType) -> Value {
    match col_type {
        ColumnType::Byte | ColumnType::SByte => Value::U8(0),
        ColumnType::UInt16 | ColumnType::Int16 => Value::U16(0),
        ColumnType::UInt32 | ColumnType::Int32 => Value::U32(0),
        ColumnType::UInt64 | ColumnType::Int64 => Value::U64(0),
        ColumnType::Single => Value::F32(0.0),
        ColumnType::Double => Value::F64(0.0),
        ColumnType::String => Value::Str(String::new()),
        ColumnType::Data | ColumnType::Guid => Value::Blob(vec![]),
    }
}

// ─── Core parser ─────────────────────────────────────────────────────────────

/// Parse a UTF table from a raw byte slice.
///
/// The slice must start exactly at the "@UTF" magic (or its encrypted form).
/// If the data starts with the encrypted magic, it is decrypted in a temporary
/// buffer before parsing.
pub fn parse(data: &[u8]) -> io::Result<UtfTable> {
    if data.len() < UTF_MIN_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("UTF table too short: {} bytes (min {})", data.len(), UTF_MIN_SIZE),
        ));
    }

    // Detect encryption.
    let magic_le = read_u32_le(data, 0).unwrap();
    let owned_buf: Vec<u8>;
    let table: &[u8] = if magic_le == UTF_ENCRYPTED_MAGIC {
        owned_buf = {
            let mut buf = data.to_vec();
            crypto::cri_decrypt_table(&mut buf);
            buf
        };
        // Verify magic after decryption.
        let decrypted_magic = read_u32_le(&owned_buf, 0).unwrap_or(0);
        if decrypted_magic != UTF_MAGIC_LE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("UTF decrypt failed: got magic 0x{:08X}", decrypted_magic),
            ));
        }
        &owned_buf
    } else if magic_le == UTF_MAGIC_LE {
        data
    } else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Not a UTF table: magic 0x{:08X}", magic_le),
        ));
    };

    // Read header fields (all big-endian, relative to UTF_BASE = 0x08).
    let rows_offset_rel = read_u16_be(table, 0x0A).unwrap_or(0) as usize;
    let string_offset_rel = read_u32_be(table, 0x0C).unwrap_or(0) as usize;
    let data_offset_rel = read_u32_be(table, 0x10).unwrap_or(0) as usize;
    let table_name_off = read_u32_be(table, 0x14).unwrap_or(0) as usize;
    let column_count = read_u16_be(table, 0x18).unwrap_or(0) as usize;
    let row_stride = read_u16_be(table, 0x1A).unwrap_or(0) as usize;
    let row_count = read_u32_be(table, 0x1C).unwrap_or(0) as usize;

    let rows_abs = rows_offset_rel + UTF_BASE;
    let string_pool = string_offset_rel + UTF_BASE;
    let data_pool = data_offset_rel + UTF_BASE;

    if string_pool > table.len() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "UTF string pool offset out of bounds",
        ));
    }

    let table_name = read_cstr(table, string_pool + table_name_off);

    // Parse column definitions (starting at 0x20).
    let mut col_defs: Vec<ColDef> = Vec::with_capacity(column_count);
    let mut col_off = 0x20usize;

    for _ in 0..column_count {
        let flags = read_u8(table, col_off).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "EOF reading column flags")
        })?;
        col_off += 1;

        let type_val = flags & 0x0F;
        let col_type = ColumnType::from_u8(type_val).unwrap_or(ColumnType::Byte);
        let has_name = (flags & FLAG_HAS_NAME) != 0;
        let has_default = (flags & FLAG_HAS_DEFAULT) != 0;
        let is_row_storage = (flags & FLAG_ROW_STORAGE) != 0;

        let name = if has_name {
            let name_off = read_u32_be(table, col_off).unwrap_or(0) as usize;
            col_off += 4;
            read_cstr(table, string_pool + name_off)
        } else {
            String::new()
        };

        let default_value = if has_default {
            let val = read_value(table, col_off, col_type, string_pool, data_pool)
                .unwrap_or_else(|| zero_value(col_type));
            col_off += col_type.wire_size();
            Some(val)
        } else {
            None
        };

        col_defs.push(ColDef {
            name,
            col_type,
            has_default,
            is_row_storage,
            default_value,
        });
    }

    // Build public column list.
    let columns: Vec<Column> = col_defs
        .iter()
        .map(|d| Column {
            name: d.name.clone(),
            col_type: d.col_type,
        })
        .collect();

    // Parse rows.
    let mut rows: Vec<Row> = Vec::with_capacity(row_count);
    for row_idx in 0..row_count {
        let mut row_data_off = rows_abs + row_idx * row_stride;
        let mut values: Vec<Value> = Vec::with_capacity(column_count);

        for def in &col_defs {
            let val = if def.is_row_storage {
                let v = read_value(table, row_data_off, def.col_type, string_pool, data_pool)
                    .unwrap_or_else(|| zero_value(def.col_type));
                row_data_off += def.col_type.wire_size();
                v
            } else if def.has_default {
                def.default_value.clone().unwrap_or_else(|| zero_value(def.col_type))
            } else {
                zero_value(def.col_type)
            };
            values.push(val);
        }

        rows.push(Row { values });
    }

    Ok(UtfTable {
        name: table_name,
        columns,
        rows,
    })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_magic_returns_error() {
        let bad = b"NOPE\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
        let result = parse(bad);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("magic") || msg.contains("Not a UTF"));
    }

    /// Build a minimal but valid UTF table with 0 columns and 0 rows.
    fn minimal_utf_table() -> Vec<u8> {
        // The layout we produce:
        //   0x00  u32 LE  magic "@UTF"
        //   0x04  u32 BE  table_size (size of the table body after the 8-byte outer header)
        //   0x08  u16 BE  unknown = 0
        //   0x0A  u16 BE  rows_offset_rel  = 0x18 (rows start right after header, no columns)
        //   0x0C  u32 BE  string_offset_rel = 0x18 (string pool right after row section)
        //   0x10  u32 BE  data_offset_rel   = 0x19 (data pool after the 1-byte empty string)
        //   0x14  u32 BE  table_name_offset = 0x00 (index 0 in string pool → "")
        //   0x18  u16 BE  column_count = 0
        //   0x1A  u16 BE  row_stride = 0
        //   0x1C  u32 BE  row_count = 0
        //   0x20  --- column definitions (none) ---
        //   0x20  --- row data (none, rows_abs=0x20) ---
        //   0x20  --- string pool (one null byte for the empty table name) ---
        //   0x21  --- data pool ---
        let mut buf = vec![0u8; 0x21];

        // magic LE
        buf[0..4].copy_from_slice(&0x46545540u32.to_le_bytes());
        // table_size (big-endian): size of everything after the first 8 bytes = 0x21-8 = 0x19
        buf[4..8].copy_from_slice(&0x00000019u32.to_be_bytes());
        // rows_offset_rel = 0x18 (relative to 0x08, so abs = 0x20)
        buf[0x0A..0x0C].copy_from_slice(&0x0018u16.to_be_bytes());
        // string_offset_rel = 0x18 (abs 0x20)
        buf[0x0C..0x10].copy_from_slice(&0x00000018u32.to_be_bytes());
        // data_offset_rel = 0x19 (abs 0x21)
        buf[0x10..0x14].copy_from_slice(&0x00000019u32.to_be_bytes());
        // table_name_offset = 0 → string at pool+0 = '\0' → ""
        buf[0x14..0x18].copy_from_slice(&0x00000000u32.to_be_bytes());
        // column_count = 0
        buf[0x18..0x1A].copy_from_slice(&0x0000u16.to_be_bytes());
        // row_stride = 0
        buf[0x1A..0x1C].copy_from_slice(&0x0000u16.to_be_bytes());
        // row_count = 0
        buf[0x1C..0x20].copy_from_slice(&0x00000000u32.to_be_bytes());
        // string pool byte at 0x20 = 0 (null terminator for the empty table name)
        buf[0x20] = 0x00;

        buf
    }

    #[test]
    fn test_parse_zero_columns_zero_rows() {
        let buf = minimal_utf_table();
        let table = parse(&buf).expect("should parse empty UTF table");
        assert_eq!(table.columns.len(), 0);
        assert_eq!(table.rows.len(), 0);
    }

    #[test]
    fn test_too_short_returns_error() {
        let short = b"\x40\x55\x54\x46"; // just the magic, no header
        let result = parse(short);
        assert!(result.is_err());
    }
}
