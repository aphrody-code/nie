//! IEVR tactic queries over the mirror's historical and special-tactic tables.
//!
//! `inagle_tactics` is the primary row source. `inagle_special_tactics` is an
//! optional table in older mirrors and is merged only when it exists. Placeholder
//! test rows are excluded exactly because they are not game tactics.

use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_LIMIT: u32 = 200;

/// Parameters for a bounded tactic list.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TacticListRequest {
    /// Literal case-insensitive search over names and internal codes.
    pub query: Option<String>,
    pub page: Option<u32>,
    pub limit: Option<u32>,
}

/// A normalized tactic row from either mirror source.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TacticRecord {
    pub id: Option<String>,
    pub internal_code: Option<String>,
    pub name: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub description_fr: Option<String>,
    pub description_en: Option<String>,
    pub description_ja: Option<String>,
    pub effect1: Option<String>,
    pub effect2: Option<String>,
    pub effect3: Option<String>,
    pub duration: Option<i64>,
    pub cooldown: Option<i64>,
    pub shop: Option<String>,
    pub element_id: Option<i64>,
    pub element: Option<String>,
    pub power: Option<i64>,
    pub recast_time: Option<i64>,
    pub partner_count: Option<i64>,
    pub partner_ids: Value,
    pub image_url: Option<String>,
    pub source: String,
    pub data: Value,
}

/// A paginated tactic result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TacticPage {
    pub data: Vec<TacticRecord>,
    pub total: usize,
    pub page: u32,
    pub limit: u32,
}

fn validate(request: &TacticListRequest) -> anyhow::Result<(String, u32, u32)> {
    let query = request.query.as_deref().unwrap_or("").trim().to_owned();
    anyhow::ensure!(
        query.len() <= 256 && !query.chars().any(char::is_control),
        "invalid tactic query"
    );
    let page = request.page.unwrap_or(1);
    let limit = request.limit.unwrap_or(50);
    anyhow::ensure!(
        page > 0 && limit > 0 && limit <= MAX_LIMIT,
        "require page >= 1 and limit 1..200"
    );
    Ok((query, page, limit))
}

fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )
}

fn json(raw: Option<String>) -> Value {
    raw.as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or(Value::Null)
}

fn placeholder(code: Option<&str>, fr: Option<&str>, en: Option<&str>) -> bool {
    let code = code.unwrap_or_default();
    code.is_empty()
        || code.starts_with("test_")
        || fr.unwrap_or_default().contains("必殺タクティクス")
        || en.unwrap_or_default().contains("必殺タクティクス")
}

fn main_row(row: &Row<'_>) -> rusqlite::Result<TacticRecord> {
    Ok(TacticRecord {
        name: row.get::<_, String>(0)?,
        name_fr: row.get(1)?,
        name_en: Some(row.get::<_, String>(0)?),
        name_ja: row.get(2)?,
        effect1: row.get(3)?,
        effect2: row.get(4)?,
        effect3: row.get(5)?,
        duration: row.get(6)?,
        cooldown: row.get(7)?,
        shop: row.get(8)?,
        id: row.get(9)?,
        internal_code: row.get(10)?,
        description_fr: row.get(11)?,
        description_en: row.get(12)?,
        description_ja: row.get(13)?,
        element_id: row.get(14)?,
        element: row.get(15)?,
        power: row.get(16)?,
        recast_time: row.get(17)?,
        partner_count: row.get(18)?,
        partner_ids: json(row.get(19)?),
        image_url: row.get(20)?,
        source: "inagle_tactics".to_owned(),
        data: Value::Null,
    })
}

fn special_row(row: &Row<'_>) -> rusqlite::Result<TacticRecord> {
    let id: Option<String> = row.get(0)?;
    let code: Option<String> = row.get(1)?;
    let fr: Option<String> = row.get(2)?;
    let en: Option<String> = row.get(3)?;
    let name = en
        .clone()
        .or(fr.clone())
        .or(code.clone())
        .unwrap_or_default();
    Ok(TacticRecord {
        id,
        internal_code: code,
        name,
        name_fr: fr,
        name_en: en,
        name_ja: row.get(4)?,
        description_fr: row.get(5)?,
        description_en: row.get(6)?,
        description_ja: row.get(7)?,
        effect1: None,
        effect2: None,
        effect3: None,
        duration: None,
        cooldown: row.get(9)?,
        shop: None,
        element_id: row.get(10)?,
        element: row.get(11)?,
        power: row.get(8)?,
        recast_time: row.get(9)?,
        partner_count: row.get(12)?,
        partner_ids: json(row.get(13)?),
        image_url: None,
        source: "inagle_special_tactics".to_owned(),
        data: json(row.get(14)?),
    })
}

fn read_main(conn: &Connection) -> anyhow::Result<Vec<TacticRecord>> {
    if !table_exists(conn, "inagle_tactics")? {
        return Ok(Vec::new());
    }
    let mut statement = conn.prepare("SELECT name,name_fr,name_ja,effect1,effect2,effect3,duration,cooldown,shop,id,internal_code,description_fr,description_en,description_ja,element_id,element,power,recast_time,partner_count,partner_ids,image_url FROM inagle_tactics")?;
    Ok(statement
        .query_map([], main_row)?
        .collect::<Result<Vec<_>, _>>()?)
}

fn read_special(conn: &Connection) -> anyhow::Result<Vec<TacticRecord>> {
    if !table_exists(conn, "inagle_special_tactics")? {
        return Ok(Vec::new());
    }
    let mut statement = conn.prepare("SELECT id,internal_code,name_fr,name_en,name_ja,description_fr,description_en,description_ja,power,recast_time,element_id,element,partner_count,partner_ids,data FROM inagle_special_tactics")?;
    Ok(statement
        .query_map([], special_row)?
        .collect::<Result<Vec<_>, _>>()?)
}

fn slug(value: &str) -> String {
    let mut result = String::new();
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            result.push(ch);
        } else if !result.ends_with('-') && !result.is_empty() {
            result.push('-');
        }
    }
    result.trim_end_matches('-').to_owned()
}

fn merge_rows(mut main: Vec<TacticRecord>, special: Vec<TacticRecord>) -> Vec<TacticRecord> {
    for extra in special {
        if placeholder(
            extra.internal_code.as_deref(),
            extra.name_fr.as_deref(),
            extra.name_en.as_deref(),
        ) {
            continue;
        }
        if let Some(code) = extra.internal_code.as_deref()
            && let Some(primary) = main
                .iter_mut()
                .find(|row| row.internal_code.as_deref() == Some(code))
        {
            if primary.element.is_none() {
                primary.element = extra.element;
            }
            if primary.element_id.is_none() {
                primary.element_id = extra.element_id;
            }
            if primary.power.is_none() {
                primary.power = extra.power;
            }
            if primary.recast_time.is_none() {
                primary.recast_time = extra.recast_time;
            }
            if primary.partner_count.is_none() {
                primary.partner_count = extra.partner_count;
            }
            if primary.partner_ids.is_null() {
                primary.partner_ids = extra.partner_ids;
            }
            continue;
        }
        main.push(extra);
    }
    main
}

/// List primary tactics plus non-placeholder special tactics.
pub fn list_tactics(conn: &Connection, request: &TacticListRequest) -> anyhow::Result<TacticPage> {
    let (query, page, limit) = validate(request)?;
    let mut rows = merge_rows(read_main(conn)?, read_special(conn)?);
    if !query.is_empty() {
        let q = query.to_lowercase();
        rows.retain(|row| {
            row.name.to_lowercase().contains(&q)
                || row
                    .name_fr
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&q)
                || row
                    .name_en
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&q)
                || row
                    .internal_code
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&q)
        });
    }
    rows.sort_by_key(|row| {
        (
            row.name_fr
                .clone()
                .or_else(|| row.name_en.clone())
                .unwrap_or_else(|| row.name.clone())
                .to_lowercase(),
            row.internal_code.clone().unwrap_or_default(),
        )
    });
    let total = rows.len();
    let offset = usize::try_from(
        (page - 1)
            .checked_mul(limit)
            .ok_or_else(|| anyhow::anyhow!("tactic page offset overflow"))?,
    )
    .unwrap_or(usize::MAX);
    Ok(TacticPage {
        data: rows.into_iter().skip(offset).take(limit as usize).collect(),
        total,
        page,
        limit,
    })
}

/// Resolve a tactic by internal code, database ID, source name or normalized slug.
pub fn get_tactic(conn: &Connection, identifier: &str) -> anyhow::Result<Option<TacticRecord>> {
    anyhow::ensure!(
        identifier.len() <= 256 && !identifier.chars().any(char::is_control),
        "invalid tactic identifier"
    );
    let rows = merge_rows(read_main(conn)?, read_special(conn)?);
    let wanted = slug(identifier);
    Ok(rows.into_iter().find(|row| {
        row.internal_code.as_deref() == Some(identifier)
            || row.id.as_deref() == Some(identifier)
            || row.name == identifier
            || slug(&row.name) == wanted
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE inagle_tactics (name TEXT,name_fr TEXT,name_ja TEXT,effect1 TEXT,effect2 TEXT,effect3 TEXT,duration INTEGER,cooldown INTEGER,shop TEXT,id TEXT,internal_code TEXT,description_fr TEXT,description_en TEXT,description_ja TEXT,element_id INTEGER,element TEXT,power INTEGER,recast_time INTEGER,partner_count INTEGER,partner_ids TEXT,image_url TEXT);
             CREATE TABLE inagle_special_tactics (id TEXT,internal_code TEXT,name_fr TEXT,name_en TEXT,name_ja TEXT,description_fr TEXT,description_en TEXT,description_ja TEXT,power INTEGER,recast_time INTEGER,element_id INTEGER,element TEXT,partner_count INTEGER,partner_ids TEXT,data TEXT);
             INSERT INTO inagle_tactics VALUES ('Alpha Formation','Formation Alpha',NULL,'e1',NULL,NULL,3,4,'shop','id1','wht00001',NULL,NULL,NULL,NULL,'Néant',NULL,NULL,NULL,NULL,NULL);
             INSERT INTO inagle_special_tactics VALUES ('id1','wht00001','Formation Alpha','Alpha Formation',NULL,NULL,NULL,NULL,40,6,1,'Feu',2,'[\"c1\"]','{}');
             INSERT INTO inagle_special_tactics VALUES ('id2','wht00002','Scénario','Scenario Move',NULL,NULL,NULL,NULL,30,5,1,'Vent',1,'[]','{}');
             INSERT INTO inagle_special_tactics VALUES ('test','test_fake','必殺タクティクス','必殺タクティクス',NULL,NULL,NULL,NULL,0,0,0,NULL,0,'[]','{}');",
        ).unwrap();
        conn
    }
    #[test]
    fn merges_primary_and_special_rows_and_filters_placeholders() {
        let page = list_tactics(
            &fixture(),
            &TacticListRequest {
                limit: Some(20),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 2);
        let primary = page
            .data
            .iter()
            .find(|row| row.internal_code.as_deref() == Some("wht00001"))
            .unwrap();
        assert_eq!(primary.power, Some(40));
        assert_eq!(primary.partner_ids[0], "c1");
    }
    #[test]
    fn resolves_special_tactic_by_slug() {
        assert_eq!(
            get_tactic(&fixture(), "scenario-move")
                .unwrap()
                .unwrap()
                .internal_code
                .as_deref(),
            Some("wht00002")
        );
    }
}
