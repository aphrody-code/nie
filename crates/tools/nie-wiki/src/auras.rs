//! IEVR aura, Keshin, Soul, Miximax, awakening and mode-change queries.
//!
//! The mirror contains the descriptive rows and their JSON payloads. Asset URLs,
//! model manifests and the `change-aura-skills` ownership mapping are deliberately
//! not synthesized here: those are host/static-data concerns and are exposed only
//! when the mirror itself contains the value.

use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_LIMIT: u32 = 200;
const MAX_OFFSET: u32 = 1_000_000;

#[derive(Debug, Clone, Copy)]
struct AuraSource {
    table: &'static str,
    slug: &'static str,
    kind: &'static str,
}

const SOURCES: &[AuraSource] = &[
    AuraSource {
        table: "inagle_keshins",
        slug: "esprits-guerriers",
        kind: "keshin",
    },
    AuraSource {
        table: "inagle_souls",
        slug: "totems",
        kind: "soul",
    },
    AuraSource {
        table: "inagle_miximax",
        slug: "miximax",
        kind: "miximax",
    },
    AuraSource {
        table: "inagle_awakenings",
        slug: "eveil",
        kind: "awakening",
    },
    AuraSource {
        table: "inagle_mode_changes",
        slug: "changement-mode",
        kind: "mode_change",
    },
    AuraSource {
        table: "inagle_auras",
        slug: "autres",
        kind: "aura",
    },
];

/// Parameters for a bounded aura search.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct AuraListRequest {
    /// Literal case-insensitive text matched against IDs, asset codes and names.
    pub query: Option<String>,
    /// Azalée category slug, or `None` for all mirror aura tables.
    pub type_slug: Option<String>,
    /// One-based result page.
    pub page: Option<u32>,
    /// Page size, bounded to 1..=200.
    pub limit: Option<u32>,
}

/// One aura-like row from an IEVR mirror table.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuraRecord {
    /// Stable mirror identifier.
    pub id: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub description_fr: Option<String>,
    pub description_en: Option<String>,
    pub description_ja: Option<String>,
    pub element_id: Option<i64>,
    pub sub_type: Option<String>,
    /// URL/path as stored in the mirror; it is not asserted to be reachable.
    pub image_url: Option<String>,
    pub asset_code: Option<String>,
    pub aura_type: String,
    pub category_slug: String,
    /// Original `data` JSON when the source table has that column.
    pub data: Value,
    pub sheet_data: Value,
    /// Shallow `data` + `sheet_data` merge, with sheet data taking precedence.
    pub merged: Value,
}

/// A paginated aura result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuraPage {
    pub data: Vec<AuraRecord>,
    pub total: usize,
    pub page: u32,
    pub limit: u32,
}

impl AuraListRequest {
    fn normalized(&self) -> anyhow::Result<(String, Option<AuraSource>, u32, u32)> {
        let query = self.query.as_deref().unwrap_or("").trim().to_owned();
        anyhow::ensure!(
            query.len() <= 256 && !query.chars().any(char::is_control),
            "invalid aura query"
        );
        let source = self.type_slug.as_deref().map(source_for_slug).transpose()?;
        let page = self.page.unwrap_or(1);
        let limit = self.limit.unwrap_or(50);
        anyhow::ensure!(
            page > 0 && limit > 0 && limit <= MAX_LIMIT,
            "require page >= 1 and limit 1..200"
        );
        let offset = page
            .checked_sub(1)
            .and_then(|p| p.checked_mul(limit))
            .ok_or_else(|| anyhow::anyhow!("aura page offset overflow"))?;
        anyhow::ensure!(offset <= MAX_OFFSET, "aura page offset is too large");
        Ok((query, source, page, limit))
    }
}

fn source_for_slug(slug: &str) -> anyhow::Result<AuraSource> {
    SOURCES
        .iter()
        .copied()
        .find(|source| source.slug == slug)
        .ok_or_else(|| anyhow::anyhow!("unknown aura type slug: {slug}"))
}

fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )
}

fn json_value(raw: Option<String>) -> Value {
    raw.as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_else(|| Value::Object(Default::default()))
}

fn row_to_record(row: &Row<'_>, source: AuraSource) -> rusqlite::Result<AuraRecord> {
    let data_raw: Option<String> = row.get(9)?;
    let sheet_raw: Option<String> = row.get(10)?;
    let data = json_value(data_raw);
    let sheet_data = json_value(sheet_raw);
    let merged = match (&data, &sheet_data) {
        (Value::Object(base), Value::Object(overlay)) => {
            let mut merged = base.clone();
            merged.extend(overlay.clone());
            Value::Object(merged)
        }
        (_, Value::Object(overlay)) if !overlay.is_empty() => Value::Object(overlay.clone()),
        _ => data.clone(),
    };
    Ok(AuraRecord {
        id: row.get(0)?,
        name_fr: row.get(1)?,
        name_en: row.get(2)?,
        name_ja: row.get(3)?,
        description_fr: row.get(4)?,
        description_en: row.get(5)?,
        description_ja: row.get(6)?,
        element_id: row.get(7)?,
        sub_type: row.get(8)?,
        image_url: row.get(11)?,
        asset_code: row.get(12)?,
        aura_type: source.kind.to_owned(),
        category_slug: source.slug.to_owned(),
        data,
        sheet_data,
        merged,
    })
}

fn read_source(
    conn: &Connection,
    source: AuraSource,
    query: &str,
) -> anyhow::Result<Vec<AuraRecord>> {
    if !table_exists(conn, source.table)? {
        return Ok(Vec::new());
    }
    let sql = format!(
        "SELECT id, name_fr, name_en, name_ja, description_fr, {description_en}, description_ja,
                element_id, sub_type, {data_column}, sheet_data, image_url, asset_code
         FROM {table}
         WHERE ?1 = '' OR instr(lower(id), lower(?1)) > 0 OR instr(lower(coalesce(asset_code, '')), lower(?1)) > 0
            OR instr(lower(coalesce(name_fr, '')), lower(?1)) > 0 OR instr(lower(coalesce(name_en, '')), lower(?1)) > 0
            OR instr(lower(coalesce(name_ja, '')), lower(?1)) > 0",
        table = source.table,
        description_en = if source.table == "inagle_auras" {
            "NULL"
        } else {
            "description_en"
        },
        data_column = if source.table == "inagle_auras" { "NULL" } else { "data" },
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([query], |row| row_to_record(row, source))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Search the aura-like mirror tables with stable in-memory pagination.
pub fn list_auras(conn: &Connection, request: &AuraListRequest) -> anyhow::Result<AuraPage> {
    let (query, selected, page, limit) = request.normalized()?;
    let mut records = Vec::new();
    for source in SOURCES
        .iter()
        .copied()
        .filter(|source| selected.is_none_or(|selected| selected.table == source.table))
    {
        records.extend(read_source(conn, source, &query)?);
    }
    records.sort_by_key(|record| {
        (
            record
                .name_fr
                .clone()
                .or_else(|| record.name_en.clone())
                .unwrap_or_default()
                .to_lowercase(),
            record.id.clone(),
        )
    });
    let total = records.len();
    let offset = usize::try_from((page - 1) * limit).unwrap_or(usize::MAX);
    let data = records
        .into_iter()
        .skip(offset)
        .take(limit as usize)
        .collect();
    Ok(AuraPage {
        data,
        total,
        page,
        limit,
    })
}

/// Resolve one aura by mirror ID or asset code.
pub fn get_aura(
    conn: &Connection,
    id: &str,
    type_slug: Option<&str>,
) -> anyhow::Result<Option<AuraRecord>> {
    anyhow::ensure!(
        id.len() <= 256 && !id.chars().any(char::is_control),
        "invalid aura identifier"
    );
    let selected = type_slug.map(source_for_slug).transpose()?;
    let clean = id.strip_prefix("0x").unwrap_or(id).to_uppercase();
    for source in SOURCES
        .iter()
        .copied()
        .filter(|source| selected.is_none_or(|selected| selected.table == source.table))
    {
        let records = read_source(conn, source, id)?;
        if let Some(record) = records.into_iter().find(|record| {
            record.id == id
                || record.asset_code.as_deref() == Some(id)
                || record.id.to_uppercase().contains(&clean)
        }) {
            return Ok(Some(record));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"CREATE TABLE inagle_auras (id TEXT, name_fr TEXT, name_en TEXT, name_ja TEXT, description_fr TEXT, description_ja TEXT, element_id INTEGER, sub_type TEXT, image_url TEXT, asset_code TEXT, sheet_data TEXT);
             CREATE TABLE inagle_keshins (id TEXT, name_fr TEXT, name_en TEXT, name_ja TEXT, description_fr TEXT, description_en TEXT, description_ja TEXT, element_id INTEGER, sub_type TEXT, image_url TEXT, asset_code TEXT, data TEXT, sheet_data TEXT);
             INSERT INTO inagle_auras VALUES ('aura_0x01', 'Aura forêt', 'Wood Aura', NULL, 'desc', NULL, 2, 'Aura', NULL, 'a01', '{"config":{"rank":2}}');
             INSERT INTO inagle_keshins VALUES ('keshin_0x02', 'Esprit', 'Spirit', NULL, NULL, 'desc en', NULL, 1, 'Keshin', NULL, 'wks01', '{"owner":"c1"}', '{"config":{"rank":7}}');"#,
        ).unwrap();
        conn
    }

    #[test]
    fn lists_existing_tables_and_merges_sheet_data() {
        let page = list_auras(&fixture(), &AuraListRequest::default()).unwrap();
        assert_eq!(page.total, 2);
        let keshin = page.data.iter().find(|a| a.aura_type == "keshin").unwrap();
        assert_eq!(keshin.merged["config"]["rank"], 7);
        assert_eq!(keshin.category_slug, "esprits-guerriers");
    }

    #[test]
    fn resolves_asset_code_without_treating_percent_as_sql_wildcard() {
        let aura = get_aura(&fixture(), "a01", Some("autres"))
            .unwrap()
            .unwrap();
        assert_eq!(aura.id, "aura_0x01");
        assert!(get_aura(&fixture(), "%", None).unwrap().is_none());
    }
}
