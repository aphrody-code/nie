//! IEVR passive queries backed by `inagle_passives` and its rule tables.
//!
//! The mirror has 128 passive rows plus generation/scaling rules. The larger
//! `passives-full.json` expansion used by Azalée is not a mirror table, so this
//! module does not pretend that the 128 database rows are that 1,716-instance
//! static catalogue.

use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_LIMIT: u32 = 200;

/// Parameters for a bounded passive list.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PassiveListRequest {
    pub query: Option<String>,
    pub category: Option<String>,
    pub boost_type: Option<String>,
    pub page: Option<u32>,
    pub limit: Option<u32>,
}

/// A passive row returned by the mirror.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassiveSummary {
    pub id: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub description_fr: Option<String>,
    pub description_en: Option<String>,
    pub description_ja: Option<String>,
    pub passive_type: Option<String>,
    pub category: Option<String>,
    pub boost_type: Option<String>,
    pub stat_boost: Option<String>,
    pub effect_value: Option<String>,
    pub image_url: Option<String>,
    pub data: Value,
}

/// One passive generation rule.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassiveGeneration {
    pub passive_id: String,
    pub number: i64,
    pub requirement: Option<String>,
    pub stat: Option<String>,
}

/// One global passive scaling rule from the mirror.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassiveScaling {
    pub id: i64,
    pub requirement: Option<String>,
    pub stat_affected: Option<String>,
    pub values: [Option<String>; 10],
}

/// A passive detail with generation rules linked by `passive_id`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassiveDetail {
    #[serde(flatten)]
    pub passive: PassiveSummary,
    pub generation: Vec<PassiveGeneration>,
}

/// A paginated passive result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassivePage {
    pub data: Vec<PassiveSummary>,
    pub total: usize,
    pub page: u32,
    pub limit: u32,
}

fn validate(request: &PassiveListRequest) -> anyhow::Result<(String, u32, u32)> {
    let query = request.query.as_deref().unwrap_or("").trim().to_owned();
    anyhow::ensure!(
        query.len() <= 256 && !query.chars().any(char::is_control),
        "invalid passive query"
    );
    for value in [request.category.as_deref(), request.boost_type.as_deref()]
        .into_iter()
        .flatten()
    {
        anyhow::ensure!(
            value.len() <= 128 && !value.chars().any(char::is_control),
            "invalid passive filter"
        );
    }
    let page = request.page.unwrap_or(1);
    let limit = request.limit.unwrap_or(60);
    anyhow::ensure!(
        page > 0 && limit > 0 && limit <= MAX_LIMIT,
        "require page >= 1 and limit 1..200"
    );
    Ok((query, page, limit))
}

fn json(raw: Option<String>) -> Value {
    raw.as_deref()
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_else(|| Value::Object(Default::default()))
}

fn summary(row: &Row<'_>) -> rusqlite::Result<PassiveSummary> {
    Ok(PassiveSummary {
        id: row.get(0)?,
        name_fr: row.get(1)?,
        name_en: row.get(2)?,
        name_ja: row.get(3)?,
        description_fr: row.get(4)?,
        description_en: row.get(5)?,
        description_ja: row.get(6)?,
        passive_type: row.get(7)?,
        image_url: row.get(8)?,
        data: json(row.get(9)?),
        category: row.get(10)?,
        boost_type: row.get(11)?,
        stat_boost: row.get(12)?,
        effect_value: row.get(13)?,
    })
}

fn read_all(conn: &Connection) -> anyhow::Result<Vec<PassiveSummary>> {
    let mut statement = conn.prepare("SELECT id,name_fr,name_en,name_ja,description_fr,description_en,description_ja,type,image_url,data,category,boost_type,stat_boost,effect_value FROM inagle_passives")?;
    Ok(statement
        .query_map([], summary)?
        .collect::<Result<Vec<_>, _>>()?)
}

/// List mirror passive rows with text/category filters and stable pagination.
pub fn list_passives(
    conn: &Connection,
    request: &PassiveListRequest,
) -> anyhow::Result<PassivePage> {
    let (query, page, limit) = validate(request)?;
    let q = query.to_lowercase();
    let mut rows = read_all(conn)?
        .into_iter()
        .filter(|row| {
            request
                .category
                .as_deref()
                .is_none_or(|value| row.category.as_deref() == Some(value))
                && request
                    .boost_type
                    .as_deref()
                    .is_none_or(|value| row.boost_type.as_deref() == Some(value))
                && (q.is_empty()
                    || [
                        row.id.as_str(),
                        row.name_fr.as_deref().unwrap_or(""),
                        row.name_en.as_deref().unwrap_or(""),
                        row.name_ja.as_deref().unwrap_or(""),
                        row.description_fr.as_deref().unwrap_or(""),
                    ]
                    .into_iter()
                    .any(|value| value.to_lowercase().contains(&q))
                    || row.data.to_string().to_lowercase().contains(&q))
        })
        .collect::<Vec<_>>();
    rows.sort_by_key(|row| {
        (
            row.name_fr
                .clone()
                .or_else(|| row.name_en.clone())
                .unwrap_or_default()
                .to_lowercase(),
            row.id.clone(),
        )
    });
    let total = rows.len();
    let offset = usize::try_from(
        (page - 1)
            .checked_mul(limit)
            .ok_or_else(|| anyhow::anyhow!("passive page offset overflow"))?,
    )
    .unwrap_or(usize::MAX);
    Ok(PassivePage {
        data: rows.into_iter().skip(offset).take(limit as usize).collect(),
        total,
        page,
        limit,
    })
}

/// Resolve a passive by mirror ID or the hex/string identifiers in its JSON payload.
pub fn get_passive(conn: &Connection, identifier: &str) -> anyhow::Result<Option<PassiveDetail>> {
    anyhow::ensure!(
        identifier.len() <= 256 && !identifier.chars().any(char::is_control),
        "invalid passive identifier"
    );
    let Some(passive) = read_all(conn)?.into_iter().find(|row| {
        row.id == identifier
            || ["passiveId", "passiveIdStr", "stringId"]
                .into_iter()
                .any(|key| row.data.get(key).and_then(Value::as_str) == Some(identifier))
    }) else {
        return Ok(None);
    };
    let mut generation = Vec::new();
    if table_exists(conn, "inagle_passive_generation")? {
        let mut statement = conn.prepare("SELECT passive_id,no,requirement,stat FROM inagle_passive_generation WHERE passive_id = ?1 ORDER BY no")?;
        generation = statement
            .query_map([&passive.id], |row| {
                Ok(PassiveGeneration {
                    passive_id: row.get(0)?,
                    number: row.get(1)?,
                    requirement: row.get(2)?,
                    stat: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
    }
    Ok(Some(PassiveDetail {
        passive,
        generation,
    }))
}

/// Read the global scaling rule table separately; it has no passive foreign key in the schema.
pub fn list_passive_scaling(conn: &Connection) -> anyhow::Result<Vec<PassiveScaling>> {
    if !table_exists(conn, "inagle_passive_scaling")? {
        return Ok(Vec::new());
    }
    let mut statement = conn.prepare("SELECT id,requirement,stat_affected,legendary_low,legendary_high,top_low,top_high,advanced_low,advanced_high,growing_low,growing_high,common_low,common_high FROM inagle_passive_scaling ORDER BY id")?;
    Ok(statement
        .query_map([], |row| {
            Ok(PassiveScaling {
                id: row.get(0)?,
                requirement: row.get(1)?,
                stat_affected: row.get(2)?,
                values: [
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                ],
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"CREATE TABLE inagle_passives (id TEXT,name_fr TEXT,name_en TEXT,name_ja TEXT,description_fr TEXT,description_en TEXT,description_ja TEXT,type TEXT,image_url TEXT,data TEXT,category TEXT,boost_type TEXT,stat_boost TEXT,effect_value TEXT);
             CREATE TABLE inagle_passive_generation (passive_id TEXT,no INTEGER,requirement TEXT,stat TEXT);
             CREATE TABLE inagle_passive_scaling (id INTEGER,requirement TEXT,stat_affected TEXT,legendary_low TEXT,legendary_high TEXT,top_low TEXT,top_high TEXT,advanced_low TEXT,advanced_high TEXT,growing_low TEXT,growing_high TEXT,common_low TEXT,common_high TEXT);
             INSERT INTO inagle_passives VALUES ('passive_1','Boost','Boost',NULL,'desc','desc',NULL,NULL,NULL,'{"passiveId":"0x01","passiveIdStr":"ps001"}','Joueur','Puissance','Kick','10');
             INSERT INTO inagle_passive_generation VALUES ('passive_1',2,'same element','Kick');
             INSERT INTO inagle_passive_scaling VALUES (1,'same element','Kick','1%','2%',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);"#,
        ).unwrap();
        conn
    }
    #[test]
    fn filters_and_resolves_json_identifiers_with_generation() {
        let conn = fixture();
        assert_eq!(
            list_passives(
                &conn,
                &PassiveListRequest {
                    query: Some("ps001".into()),
                    ..Default::default()
                }
            )
            .unwrap()
            .total,
            1
        );
        let detail = get_passive(&conn, "0x01").unwrap().unwrap();
        assert_eq!(detail.generation[0].number, 2);
    }
    #[test]
    fn exposes_scaling_as_unlinked_global_rules() {
        let rules = list_passive_scaling(&fixture()).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].values[0].as_deref(), Some("1%"));
    }
}
