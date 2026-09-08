//! Portable, bounded search over caller-provided reverse-engineering knowledge.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use thiserror::Error;

/// Maximum number of entries accepted by one in-memory index.
pub const MAX_ENTRIES: usize = 65_536;
/// Maximum combined UTF-8 bytes accepted across all entry fields.
pub const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
/// Maximum UTF-8 bytes accepted in one field or search query.
pub const MAX_FIELD_BYTES: usize = 16 * 1024;
/// Maximum anchors retained for one entry.
pub const MAX_ANCHORS_PER_ENTRY: usize = 64;
/// Maximum results returned by one query.
pub const MAX_RESULTS: usize = 256;

/// One searchable function, symbol, format, or data anchor.
///
/// `address` uses canonical hexadecimal text so values above JavaScript's safe integer
/// range remain exact when this type crosses a JSON or WebAssembly boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeEntry {
    pub address: String,
    pub name: Option<String>,
    pub subsystem: Option<String>,
    pub role: Option<String>,
    #[serde(default)]
    pub anchors: Vec<String>,
    pub confidence: f64,
}

/// A ranked match returned by [`MemoryIndex::search`].
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub entry: KnowledgeEntry,
    pub score: u32,
    pub matched_fields: Vec<String>,
}

/// Metadata and ranked hits for a bounded query.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub total_entries: usize,
    pub total_matches: usize,
    pub returned: usize,
    pub truncated: bool,
    pub hits: Vec<SearchHit>,
}

/// Validation failures for the portable index.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum MemoryIndexError {
    #[error("entry count {actual} exceeds limit {limit}")]
    TooManyEntries { actual: usize, limit: usize },
    #[error("input size exceeds limit {limit} bytes")]
    InputTooLarge { limit: usize },
    #[error("field `{field}` at entry {entry} exceeds limit {limit} bytes")]
    FieldTooLarge {
        entry: usize,
        field: &'static str,
        limit: usize,
    },
    #[error("entry {entry} has {actual} anchors; limit is {limit}")]
    TooManyAnchors {
        entry: usize,
        actual: usize,
        limit: usize,
    },
    #[error("entry {entry} has invalid hexadecimal address `{address}`")]
    InvalidAddress { entry: usize, address: String },
    #[error("entry {entry} confidence must be finite and between 0 and 1")]
    InvalidConfidence { entry: usize },
    #[error("query exceeds limit {limit} bytes")]
    QueryTooLarge { limit: usize },
    #[error("result limit {actual} exceeds maximum {limit}")]
    ResultLimitTooLarge { actual: usize, limit: usize },
}

#[derive(Debug, Clone)]
struct IndexedEntry {
    entry: KnowledgeEntry,
    name: String,
    subsystem: String,
    role: String,
    anchors: Vec<String>,
}

/// Deterministic in-memory index suitable for native, site, and WebAssembly callers.
#[derive(Debug, Clone)]
pub struct MemoryIndex {
    entries: Vec<IndexedEntry>,
}

impl MemoryIndex {
    /// Validates, canonicalizes, and indexes caller-provided entries.
    pub fn new(mut entries: Vec<KnowledgeEntry>) -> Result<Self, MemoryIndexError> {
        if entries.len() > MAX_ENTRIES {
            return Err(MemoryIndexError::TooManyEntries {
                actual: entries.len(),
                limit: MAX_ENTRIES,
            });
        }

        let mut total_bytes = 0usize;
        let mut indexed = Vec::with_capacity(entries.len());
        for (entry_index, entry) in entries.iter_mut().enumerate() {
            validate_field(entry_index, "address", &entry.address, &mut total_bytes)?;
            entry.address = canonical_address(&entry.address).ok_or_else(|| {
                MemoryIndexError::InvalidAddress {
                    entry: entry_index,
                    address: entry.address.clone(),
                }
            })?;
            for (field, value) in [
                ("name", entry.name.as_deref()),
                ("subsystem", entry.subsystem.as_deref()),
                ("role", entry.role.as_deref()),
            ] {
                if let Some(value) = value {
                    validate_field(entry_index, field, value, &mut total_bytes)?;
                }
            }
            if entry.anchors.len() > MAX_ANCHORS_PER_ENTRY {
                return Err(MemoryIndexError::TooManyAnchors {
                    entry: entry_index,
                    actual: entry.anchors.len(),
                    limit: MAX_ANCHORS_PER_ENTRY,
                });
            }
            for anchor in &entry.anchors {
                validate_field(entry_index, "anchor", anchor, &mut total_bytes)?;
            }
            if !entry.confidence.is_finite() || !(0.0..=1.0).contains(&entry.confidence) {
                return Err(MemoryIndexError::InvalidConfidence { entry: entry_index });
            }

            indexed.push(IndexedEntry {
                name: normalize(entry.name.as_deref().unwrap_or_default()),
                subsystem: normalize(entry.subsystem.as_deref().unwrap_or_default()),
                role: normalize(entry.role.as_deref().unwrap_or_default()),
                anchors: entry
                    .anchors
                    .iter()
                    .map(|anchor| normalize(anchor))
                    .collect(),
                entry: entry.clone(),
            });
        }

        Ok(Self { entries: indexed })
    }

    /// Returns the number of indexed entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Reports whether the index contains no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Searches all normalized terms and returns a stable, bounded ranking.
    ///
    /// Every term must match at least one field. Exact and prefix name matches rank above
    /// substring, subsystem, role, and anchor matches. Ties use address then name so the
    /// same input always produces the same output.
    pub fn search(&self, query: &str, limit: usize) -> Result<SearchResult, MemoryIndexError> {
        if query.len() > MAX_FIELD_BYTES {
            return Err(MemoryIndexError::QueryTooLarge {
                limit: MAX_FIELD_BYTES,
            });
        }
        if limit > MAX_RESULTS {
            return Err(MemoryIndexError::ResultLimitTooLarge {
                actual: limit,
                limit: MAX_RESULTS,
            });
        }

        let terms: Vec<String> = normalize(query)
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        let mut hits = Vec::new();
        for indexed in &self.entries {
            if let Some((score, matched_fields)) = score(indexed, &terms) {
                hits.push(SearchHit {
                    entry: indexed.entry.clone(),
                    score,
                    matched_fields,
                });
            }
        }
        hits.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.entry.address.cmp(&right.entry.address))
                .then_with(|| left.entry.name.cmp(&right.entry.name))
        });
        let total_matches = hits.len();
        hits.truncate(limit);
        Ok(SearchResult {
            total_entries: self.entries.len(),
            total_matches,
            returned: hits.len(),
            truncated: hits.len() < total_matches,
            hits,
        })
    }
}

fn validate_field(
    entry: usize,
    field: &'static str,
    value: &str,
    total_bytes: &mut usize,
) -> Result<(), MemoryIndexError> {
    if value.len() > MAX_FIELD_BYTES {
        return Err(MemoryIndexError::FieldTooLarge {
            entry,
            field,
            limit: MAX_FIELD_BYTES,
        });
    }
    *total_bytes = total_bytes
        .checked_add(value.len())
        .ok_or(MemoryIndexError::InputTooLarge {
            limit: MAX_INPUT_BYTES,
        })?;
    if *total_bytes > MAX_INPUT_BYTES {
        return Err(MemoryIndexError::InputTooLarge {
            limit: MAX_INPUT_BYTES,
        });
    }
    Ok(())
}

fn canonical_address(address: &str) -> Option<String> {
    let digits = address
        .trim()
        .strip_prefix("0x")
        .or_else(|| address.trim().strip_prefix("0X"))?;
    if digits.is_empty()
        || digits.len() > 16
        || !digits.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    u64::from_str_radix(digits, 16)
        .ok()
        .map(|value| format!("0x{value:x}"))
}

fn normalize(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut separated = true;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            normalized.push(character);
            separated = false;
        } else if !separated {
            normalized.push(' ');
            separated = true;
        }
    }
    if normalized.ends_with(' ') {
        normalized.pop();
    }
    normalized
}

fn score(entry: &IndexedEntry, terms: &[String]) -> Option<(u32, Vec<String>)> {
    if terms.is_empty() {
        return Some((0, Vec::new()));
    }
    let mut total = 0u32;
    let mut matched_fields = BTreeSet::new();
    for term in terms {
        let mut term_score = 0;
        if entry.name == *term {
            term_score = 100;
            matched_fields.insert("name".to_owned());
        } else if entry.name.starts_with(term) {
            term_score = 80;
            matched_fields.insert("name".to_owned());
        } else if entry.name.contains(term) {
            term_score = 60;
            matched_fields.insert("name".to_owned());
        }
        if entry.subsystem == *term {
            term_score = term_score.max(50);
            matched_fields.insert("subsystem".to_owned());
        } else if entry.subsystem.contains(term) {
            term_score = term_score.max(35);
            matched_fields.insert("subsystem".to_owned());
        }
        if entry.role == *term {
            term_score = term_score.max(45);
            matched_fields.insert("role".to_owned());
        } else if entry.role.contains(term) {
            term_score = term_score.max(30);
            matched_fields.insert("role".to_owned());
        }
        if entry.anchors.iter().any(|anchor| anchor.contains(term)) {
            term_score = term_score.max(25);
            matched_fields.insert("anchors".to_owned());
        }
        if term_score == 0 {
            return None;
        }
        total = total.saturating_add(term_score);
    }
    total = total.saturating_add((entry.entry.confidence * 10.0).round() as u32);
    Some((total, matched_fields.into_iter().collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(address: &str, name: &str, subsystem: &str, anchors: &[&str]) -> KnowledgeEntry {
        KnowledgeEntry {
            address: address.to_owned(),
            name: Some(name.to_owned()),
            subsystem: Some(subsystem.to_owned()),
            role: Some("callback".to_owned()),
            anchors: anchors.iter().map(|value| (*value).to_owned()).collect(),
            confidence: 0.75,
        }
    }

    #[test]
    fn searches_exact_vfs_and_nie_exe_names_without_changing_output() {
        let index = MemoryIndex::new(vec![
            entry(
                "0X1400024B80",
                "funcLuaMenuCommand",
                "mainmenu01",
                &["CHARA_PARAM_INFO", "G4TX"],
            ),
            entry("0x140001000", "FUN_140001000", "render", &["G4MD"]),
        ])
        .unwrap();

        let result = index.search("mainmenu01 G4TX", 10).unwrap();
        assert_eq!(result.total_entries, 2);
        assert_eq!(result.total_matches, 1);
        assert_eq!(result.hits[0].entry.address, "0x1400024b80");
        assert_eq!(
            result.hits[0].entry.name.as_deref(),
            Some("funcLuaMenuCommand")
        );
        assert_eq!(
            result.hits[0].entry.subsystem.as_deref(),
            Some("mainmenu01")
        );
        assert_eq!(result.hits[0].entry.anchors, ["CHARA_PARAM_INFO", "G4TX"]);
    }

    #[test]
    fn ranks_exact_names_before_substrings_and_breaks_ties_stably() {
        let index = MemoryIndex::new(vec![
            entry("0x30", "menu_dispatch", "menu", &[]),
            entry("0x20", "menu", "script", &[]),
            entry("0x10", "menu", "script", &[]),
        ])
        .unwrap();
        let result = index.search("menu", 2).unwrap();
        assert_eq!(result.total_matches, 3);
        assert_eq!(result.returned, 2);
        assert!(result.truncated);
        assert_eq!(result.hits[0].entry.address, "0x10");
        assert_eq!(result.hits[1].entry.address, "0x20");
        assert!(result.hits[0].score > 100);
    }

    #[test]
    fn rejects_invalid_or_unbounded_input() {
        let mut invalid = entry("1400", "name", "menu", &[]);
        assert!(matches!(
            MemoryIndex::new(vec![invalid.clone()]),
            Err(MemoryIndexError::InvalidAddress { .. })
        ));
        invalid.address = "0x1".to_owned();
        invalid.confidence = f64::NAN;
        assert!(matches!(
            MemoryIndex::new(vec![invalid]),
            Err(MemoryIndexError::InvalidConfidence { .. })
        ));

        let index = MemoryIndex::new(Vec::new()).unwrap();
        assert!(matches!(
            index.search("", MAX_RESULTS + 1),
            Err(MemoryIndexError::ResultLimitTooLarge { .. })
        ));
        let long_query = "x".repeat(MAX_FIELD_BYTES + 1);
        assert!(matches!(
            index.search(&long_query, 1),
            Err(MemoryIndexError::QueryTooLarge { .. })
        ));
    }

    #[test]
    fn serializes_addresses_as_precision_safe_strings() {
        let index = MemoryIndex::new(vec![entry(
            "0xffffffffffffffff",
            "maximum_address",
            "pdata",
            &[],
        )])
        .unwrap();
        let result = index.search("maximum", 1).unwrap();
        assert_eq!(result.hits[0].entry.address, "0xffffffffffffffff");
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(
            json["hits"][0]["entry"]["address"],
            serde_json::json!("0xffffffffffffffff")
        );
    }
}
