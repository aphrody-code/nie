//! Decodes a cfg.bin into relational rows, without a database and without JSON.
//!
//! Every binary value becomes one typed row: nothing the binary stores as a number is
//! reformatted as text.

use nie_formats::cfgbin::{self, CfgEntry, RdbnValue, Value};
use sha2::{Digest, Sha256};

/// `kind` of untyped RDBN values (types 0/1/2 and unknown types).
pub const KIND_BLOB: i16 = -1;
/// `kind` of a value outside the buffer (`<invalid>` in the C# reader).
pub const KIND_INVALID: i16 = -2;

/// A decoded cfg.bin, ready to be written.
#[derive(Debug, Clone, PartialEq)]
pub struct Decoded {
    pub sha256: [u8; 32],
    pub byte_size: i32,
    pub body: Body,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Body {
    Rdbn(Vec<RdbnListRows>),
    T2b {
        entries: Vec<T2bEntryRow>,
        vars: Vec<T2bVarRow>,
    },
}

impl Body {
    #[must_use]
    pub fn format(&self) -> &'static str {
        match self {
            Self::Rdbn(_) => "rdbn",
            Self::T2b { .. } => "t2b",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RdbnListRows {
    pub name: String,
    pub type_name: String,
    pub values: Vec<RdbnValueRow>,
}

/// One RDBN cell. Exactly one `v_*` column is set, except for `Invalid`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RdbnValueRow {
    pub row_idx: i32,
    pub field_idx: i16,
    pub field_name: String,
    pub kind: i16,
    pub v_int: Option<i64>,
    pub v_real: Option<f64>,
    pub v_text: Option<String>,
    pub v_vec: Option<Vec<f32>>,
    pub v_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct T2bEntryRow {
    pub idx: i32,
    pub parent_idx: Option<i32>,
    pub depth: i16,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct T2bVarRow {
    pub entry_idx: i32,
    pub ord: i16,
    pub kind: i16,
    pub v_int: Option<i32>,
    pub v_real: Option<f32>,
    pub v_text: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    #[error("neither RDBN nor T2B ({0} bytes)")]
    UnknownFormat(usize),
    #[error("file too large for a 32-bit size ({0} bytes)")]
    TooLarge(usize),
    #[error("{what} overflows its column ({value})")]
    Overflow { what: &'static str, value: usize },
    #[error(transparent)]
    Format(#[from] nie_formats::FormatError),
}

/// Decodes a cfg.bin (RDBN or T2B) into relational rows.
///
/// # Errors
/// [`DecodeError`] when the buffer is neither RDBN nor T2B, or is corrupt.
pub fn decode(data: &[u8]) -> Result<Decoded, DecodeError> {
    let byte_size = i32::try_from(data.len()).map_err(|_| DecodeError::TooLarge(data.len()))?;
    let sha256: [u8; 32] = Sha256::digest(data).into();
    let body = if cfgbin::is_rdbn(data) {
        let rdbn = cfgbin::parse(data)?;
        Body::Rdbn(rdbn_rows(cfgbin::read_values(&rdbn, data))?)
    } else {
        // `is_t2b` rejects a valid T2B whose string table is empty (e.g.
        // `data/common/action/human_base_act.cfg.bin`), so the parser itself decides, the
        // same way `nie vfs cat` does.
        let file = cfgbin::parse_t2b(data).map_err(|error| {
            if cfgbin::is_t2b(data) {
                DecodeError::Format(error)
            } else {
                DecodeError::UnknownFormat(data.len())
            }
        })?;
        let (entries, vars) = t2b_rows(&file.entries)?;
        Body::T2b { entries, vars }
    };
    Ok(Decoded {
        sha256,
        byte_size,
        body,
    })
}

fn to_i32(what: &'static str, value: usize) -> Result<i32, DecodeError> {
    i32::try_from(value).map_err(|_| DecodeError::Overflow { what, value })
}

fn to_i16(what: &'static str, value: usize) -> Result<i16, DecodeError> {
    i16::try_from(value).map_err(|_| DecodeError::Overflow { what, value })
}

fn rdbn_rows(lists: Vec<cfgbin::RdbnList>) -> Result<Vec<RdbnListRows>, DecodeError> {
    lists
        .into_iter()
        .map(|list| {
            let mut values = Vec::new();
            for (row_idx, row) in list.rows.into_iter().enumerate() {
                let row_idx = to_i32("row_idx", row_idx)?;
                for (field_idx, (field_name, value)) in row.fields.into_iter().enumerate() {
                    let mut cell = rdbn_cell(value);
                    cell.row_idx = row_idx;
                    cell.field_idx = to_i16("field_idx", field_idx)?;
                    cell.field_name = field_name;
                    values.push(cell);
                }
            }
            Ok(RdbnListRows {
                name: list.name,
                type_name: list.type_name,
                values,
            })
        })
        .collect()
}

fn rdbn_cell(value: RdbnValue) -> RdbnValueRow {
    let int = |kind: i16, v: i64| RdbnValueRow {
        kind,
        v_int: Some(v),
        ..Default::default()
    };
    let vec = |kind: i16, v: Vec<f32>| RdbnValueRow {
        kind,
        v_vec: Some(v),
        ..Default::default()
    };
    match value {
        RdbnValue::Bool(v) => int(3, i64::from(v)),
        RdbnValue::Byte(v) => int(4, i64::from(v)),
        RdbnValue::Short(v) => int(5, i64::from(v)),
        RdbnValue::Int(v) => int(6, i64::from(v)),
        RdbnValue::ActType(v) => int(9, i64::from(v)),
        RdbnValue::Flag(v) => int(10, i64::from(v)),
        RdbnValue::Float(v) => RdbnValueRow {
            kind: 13,
            v_real: Some(f64::from(v)),
            ..Default::default()
        },
        RdbnValue::Hash(v) => int(15, i64::from(v)),
        RdbnValue::Rates(v) => vec(18, v.to_vec()),
        RdbnValue::Position(v) => vec(19, v.to_vec()),
        RdbnValue::Condition(v) => RdbnValueRow {
            kind: 20,
            v_text: Some(v),
            ..Default::default()
        },
        // i16 -> f32 is exact (|i16| < 2^24).
        RdbnValue::ShortTuple(v) => vec(21, v.iter().map(|&x| f32::from(x)).collect()),
        RdbnValue::Blob(v) => RdbnValueRow {
            kind: KIND_BLOB,
            v_bytes: Some(v),
            ..Default::default()
        },
        RdbnValue::Invalid => RdbnValueRow {
            kind: KIND_INVALID,
            ..Default::default()
        },
    }
}

fn t2b_rows(roots: &[CfgEntry]) -> Result<(Vec<T2bEntryRow>, Vec<T2bVarRow>), DecodeError> {
    let mut entries = Vec::new();
    let mut vars = Vec::new();
    // Explicit pre-order walk: `idx` order reproduces the file order.
    let mut stack: Vec<(&CfgEntry, Option<i32>, usize)> =
        roots.iter().rev().map(|e| (e, None, 0)).collect();
    while let Some((entry, parent_idx, depth)) = stack.pop() {
        let idx = to_i32("t2b idx", entries.len())?;
        entries.push(T2bEntryRow {
            idx,
            parent_idx,
            depth: to_i16("t2b depth", depth)?,
            name: entry.name.clone(),
        });
        for (ord, value) in entry.variables.iter().enumerate() {
            let ord = to_i16("t2b ord", ord)?;
            vars.push(match value {
                Value::String(s) => T2bVarRow {
                    entry_idx: idx,
                    ord,
                    kind: 0,
                    v_int: None,
                    v_real: None,
                    v_text: Some(s.clone()),
                },
                Value::Int(v) => T2bVarRow {
                    entry_idx: idx,
                    ord,
                    kind: 1,
                    v_int: Some(*v),
                    v_real: None,
                    v_text: None,
                },
                Value::Float(v) => T2bVarRow {
                    entry_idx: idx,
                    ord,
                    kind: 2,
                    v_int: None,
                    v_real: Some(*v),
                    v_text: None,
                },
            });
        }
        stack.extend(
            entry
                .children
                .iter()
                .rev()
                .map(|c| (c, Some(idx), depth + 1)),
        );
    }
    Ok((entries, vars))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t2b_tree_is_flattened_in_file_order_with_parents() {
        let leaf = |name: &str, v: Value| CfgEntry {
            name: name.into(),
            variables: vec![v],
            children: vec![],
        };
        let roots = vec![
            CfgEntry {
                name: "LIST_BEGIN".into(),
                variables: vec![Value::Int(2)],
                children: vec![
                    leaf("A", Value::String("x".into())),
                    leaf("B", Value::Float(1.5)),
                ],
            },
            leaf("END", Value::Int(0)),
        ];
        let (entries, vars) = t2b_rows(&roots).unwrap();
        let names: Vec<_> = entries
            .iter()
            .map(|e| (e.name.as_str(), e.parent_idx, e.depth))
            .collect();
        assert_eq!(
            names,
            [
                ("LIST_BEGIN", None, 0),
                ("A", Some(0), 1),
                ("B", Some(0), 1),
                ("END", None, 0)
            ]
        );
        assert_eq!(vars.len(), 4);
        assert_eq!(vars[1].v_text.as_deref(), Some("x"));
        assert_eq!(vars[2].v_real, Some(1.5));
    }

    #[test]
    fn rdbn_cells_keep_binary_types() {
        assert_eq!(
            rdbn_cell(RdbnValue::Hash(0xFFFF_FFFF)).v_int,
            Some(4_294_967_295)
        );
        assert_eq!(
            rdbn_cell(RdbnValue::ShortTuple([-2, 7])).v_vec,
            Some(vec![-2.0, 7.0])
        );
        let invalid = rdbn_cell(RdbnValue::Invalid);
        assert_eq!(invalid.kind, KIND_INVALID);
        assert!(invalid.v_int.is_none() && invalid.v_bytes.is_none());
    }

    #[test]
    fn decodes_the_checked_in_rdbn_fixture() {
        // The checked-in `font_color.cfg.bin` is RDBN: one list, 64 colours x 7 fields.
        let data = include_bytes!("../../nie-formats/tests/fixtures/font_color.cfg.bin");
        let decoded = decode(data).unwrap();
        assert_eq!(decoded.body.format(), "rdbn");
        let Body::Rdbn(lists) = decoded.body else {
            unreachable!()
        };
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].name, "m_FontColorDataList");
        assert_eq!(lists[0].values.len(), 64 * 7);
        let id = lists[0]
            .values
            .iter()
            .find(|v| v.field_name == "fontColorId")
            .unwrap();
        assert!(id.v_int.is_some() && id.v_text.is_none());
    }

    #[test]
    fn rejects_unknown_formats() {
        assert!(matches!(
            decode(&[0u8; 8]),
            Err(DecodeError::UnknownFormat(8))
        ));
    }
}
