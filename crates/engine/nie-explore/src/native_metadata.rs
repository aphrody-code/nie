//! Bounded native container metadata. Parsers remain in nie-formats; no codec is inferred
//! from a filename and no binary payload is expanded into a JSON byte array.
use nie_formats::cpk::{UtfValue, parse_utf};
use serde_json::{Value, json};

pub const SUFFIXES: [&str; 5] = [".acb", ".awb", ".acf", ".utf", ".usm"];
const MAX_CELLS: usize = 65_536;
const MAX_TABLE_DEPTH: usize = 4;

/// Metadata recognized by its original container magic, independent of its extension.
#[must_use]
pub fn recognizes(bytes: &[u8]) -> bool {
    bytes.starts_with(b"@UTF") || bytes.starts_with(b"AFS2") || bytes.starts_with(b"CRID")
}

fn utf_metadata(bytes: &[u8], depth: usize, budget: &mut usize) -> Result<Value, String> {
    let table = parse_utf(bytes).map_err(|error| error.to_string())?;
    let count = table.rows.iter().try_fold(0usize, |count, row| count.checked_add(row.len()))
        .ok_or("Native table cell count overflow")?;
    *budget = budget.checked_sub(count).ok_or("Native table metadata exceeds its cell budget")?;
    let mut rows = Vec::with_capacity(table.rows.len());
    for row in &table.rows {
        let mut values = Vec::with_capacity(row.len());
        for value in row {
            values.push(match value {
                UtfValue::Bytes(blob) => {
                    if blob.starts_with(b"@UTF") && depth < MAX_TABLE_DEPTH {
                        json!({ "type": "table", "byteLength": blob.len(),
                            "table": utf_metadata(blob, depth + 1, budget)? })
                    } else {
                        json!({ "type": "binary", "byteLength": blob.len(),
                            "nestedTable": blob.starts_with(b"@UTF"), "payloadIncluded": false })
                    }
                }
                scalar => serde_json::to_value(scalar).map_err(|error| error.to_string())?,
            });
        }
        rows.push(values);
    }
    Ok(json!({ "name": table.name, "columns": table.columns, "rows": rows,
        "rowCount": table.rows.len(), "columnCount": table.columns.len() }))
}

/// Inspect ACB cues, AFS2 entry tables, generic UTF/ACF tables or named USM metadata.
/// Complex synthesizer execution, audio packet timing and MPEG-2 playback are not supplied.
pub fn inspect(original_path: &str, bytes: &[u8]) -> Result<Value, String> {
    if bytes.starts_with(b"AFS2") {
        let decoded = nie_formats::decode::decode(bytes).ok_or("Invalid native AWB container")?;
        let table: Value = serde_json::from_slice(&decoded.json).map_err(|error| error.to_string())?;
        return Ok(json!({ "format": "awb", "table": table, "waveformsDecoded": false }));
    }
    if bytes.starts_with(b"CRID") {
        let metadata = crate::native_video::metadata(original_path, bytes)?;
        let metadata: Value = serde_json::from_str(&metadata).map_err(|error| error.to_string())?;
        return Ok(json!({ "format": "usm", "metadata": metadata }));
    }
    if bytes.starts_with(b"@UTF") {
        let root = parse_utf(bytes).map_err(|error| error.to_string())?;
        let is_acb = root.column_index("CueTable").is_some()
            && root.column_index("CueNameTable").is_some();
        let mut budget = MAX_CELLS;
        let table = utf_metadata(bytes, 0, &mut budget)?;
        if is_acb {
            // A structurally valid cue table can still have unresolved playback selection.
            // Preserve its decoded table instead of turning missing cue resolution into
            // an assertion that the entire native container is unreadable.
            let cues = crate::native_audio::bank_cues(original_path, bytes).ok();
            let cue_resolution = if cues.is_some() { "resolved" } else { "unavailable" };
            return Ok(json!({ "format": "acb", "table": table, "cues": cues,
                "cueResolution": cue_resolution,
                "waveformsDecoded": false, "complexSynthExecutionSupported": false }));
        }
        return Ok(json!({ "format": "criware_utf", "table": table,
            "binaryPayloadsIncluded": false, "maximumNestedTableDepth": MAX_TABLE_DEPTH }));
    }
    Err("Unsupported native metadata container".to_owned())
}
