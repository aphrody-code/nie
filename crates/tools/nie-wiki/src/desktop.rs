//! Native desktop queries for the read-only IEVR mirror.
//!
//! This module is the boundary used by the Tauri desktop host. SQL and mirror
//! policy stay here; the webview only sends a named operation and receives JSON.

use std::collections::HashSet;

use anyhow::{Context, bail};
use rusqlite::{Connection, ToSql};
use serde_json::{Value, json};

use crate::{mirror::query_rows, query};

/// Execute one named desktop wiki operation against an already opened mirror.
pub fn execute(conn: &Connection, operation: &str, args: &Value) -> anyhow::Result<Value> {
    match operation {
        "search_character" => {
            let q = required_string(args, "query")?;
            Ok(serde_json::to_value(query::search_characters(conn, q)?)?)
        }
        "search_skill" => {
            let q = required_string(args, "query")?;
            Ok(serde_json::to_value(query::search_skills(conn, q)?)?)
        }
        "load_name_index" => index_names(conn),
        "load_roster" => contract_rows(
            conn,
            ROSTER_SQL,
            &[
                "rarity_code",
                "zukan_order",
                "stat_frappe",
                "stat_controle",
                "stat_technique",
                "stat_pression",
                "stat_physique",
                "stat_agilite",
                "stat_intelligence",
            ],
        ),
        "load_staff" => contract_rows(conn, STAFF_SQL, &["id"]),
        "character_skills" => character_skills(conn, required_string(args, "id")?),
        "resolve_many_by_code" => resolve_many(conn, args),
        "mirror_stats" => mirror_stats(conn),
        other => bail!("unknown desktop wiki operation: {other}"),
    }
}

fn required_string<'a>(args: &'a Value, name: &str) -> anyhow::Result<&'a str> {
    args.get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .with_context(|| format!("missing wiki argument: {name}"))
}

fn readonly_rows(conn: &Connection, sql: &str) -> anyhow::Result<Value> {
    Ok(Value::Array(query::exec_readonly_sql(conn, sql)?))
}

/// Typed native/browser DTOs normalize mirror TEXT numbers and dump null markers.
/// The unrestricted read-only SQL inspector deliberately retains raw storage types.
fn contract_rows(conn: &Connection, sql: &str, numbers: &[&str]) -> anyhow::Result<Value> {
    let mut statement = conn.prepare(sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let rows = statement
        .query_map([], |row| {
            let mut record = crate::entities::ligne_en_json(row, &columns)?;
            for (index, column) in columns.iter().enumerate() {
                if numbers.contains(&column.as_str()) {
                    record[column] = json!(crate::mirror::entier_souple(row, index)?);
                } else if record[column]
                    .as_str()
                    .is_some_and(|value| matches!(value, "\\N" | "\\\\N"))
                {
                    record[column] = Value::Null;
                }
            }
            Ok(Value::Object(record))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(rows))
}

const ROSTER_SQL: &str = "\
SELECT id, chara_id, name_fr, name_en, name_ja, internal_code, slug, base_slug,
       element, position, rarity_label,
       CASE WHEN json_valid(data) THEN json_extract(data, '$.rarityCode') END AS rarity_code,
       CASE WHEN json_valid(data) THEN json_extract(data, '$.subPosition') END AS sub_position,
       series, gender, team_id, zukan_order,
       stat_frappe, stat_controle, stat_technique, stat_pression,
       stat_physique, stat_agilite, stat_intelligence
FROM inagle_characters
WHERE internal_code IS NULL OR internal_code NOT LIKE '%\\_5000' ESCAPE '\\'
ORDER BY CASE WHEN zukan_order IS NULL OR zukan_order IN ('\\N','\\\\N') THEN 1 ELSE 0 END,
         CAST(zukan_order AS INTEGER) ASC, id ASC";

const STAFF_SQL: &str = "\
SELECT id, name_localised, name_romaji, name_kanji, role, playstyle, element, buff, requirements
FROM inagle_coordinators
ORDER BY role ASC, id ASC";

fn index_names(conn: &Connection) -> anyhow::Result<Value> {
    let sql = "\
SELECT 'chara' AS type, id, name_fr, name_en, name_ja, internal_code
FROM inagle_characters
WHERE internal_code IS NULL OR internal_code NOT LIKE '%\\_5000' ESCAPE '\\'
UNION ALL
SELECT 'waza', id, name_fr, name_en, name_ja, internal_code FROM inagle_skills
UNION ALL
SELECT CASE WHEN category = 'special_tactics' THEN 'tactique' ELSE 'objet' END,
       id, name_fr, name_en, name_ja, internal_code
FROM inagle_items
UNION ALL
SELECT 'equipe', id, name_fr, name_en, name_ja, internal_code FROM inagle_teams
UNION ALL
SELECT 'keshin', id, name_fr, name_en, name_ja, NULL FROM inagle_keshins
UNION ALL
SELECT 'totem', id, name_fr, name_en, name_ja, NULL FROM inagle_souls
ORDER BY name_fr ASC, id ASC";
    readonly_rows(conn, sql)
}

fn character_skills(conn: &Connection, id: &str) -> anyhow::Result<Value> {
    let character = query::get_character(conn, id)?.context("character not found")?;
    let mut result = Vec::new();
    for slot in character.skills {
        let Some(skill) = query::get_skill(conn, &slot.skill_id)? else {
            continue;
        };
        result.push(json!({
            "id": skill.id,
            "name_fr": skill.name_fr,
            "name_en": skill.name_en,
            "category": skill.category,
            "element": skill.element,
            "power_max": skill.power_max,
            "tp_cost": skill.tp_cost,
            "is_hyper": skill.is_hyper,
        }));
    }
    Ok(Value::Array(result))
}

fn resolve_many(conn: &Connection, args: &Value) -> anyhow::Result<Value> {
    let codes = args
        .get("codes")
        .and_then(Value::as_array)
        .context("missing wiki argument: codes")?
        .iter()
        .filter_map(Value::as_str)
        .filter(|code| !code.is_empty())
        .collect::<Vec<_>>();
    if codes.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let placeholders = std::iter::repeat_n("?", codes.len())
        .collect::<Vec<_>>()
        .join(",");
    let params = codes
        .iter()
        .map(|code| code as &dyn ToSql)
        .collect::<Vec<_>>();
    let mut rows = Vec::new();

    for (table, kind, key, projection) in [
        (
            "inagle_characters",
            "chara",
            "internal_code",
            "element, position, NULL AS category",
        ),
        (
            "inagle_skills",
            "skill",
            "internal_code",
            "element, NULL AS position, category",
        ),
        (
            "inagle_items",
            "item",
            "internal_code",
            "NULL AS element, NULL AS position, category",
        ),
        (
            "inagle_teams",
            "team",
            "internal_code",
            "NULL AS element, NULL AS position, NULL AS category",
        ),
        (
            "inagle_keshins",
            "keshin",
            "asset_code",
            "NULL AS element, NULL AS position, NULL AS category",
        ),
        (
            "inagle_souls",
            "soul",
            "asset_code",
            "NULL AS element, NULL AS position, NULL AS category",
        ),
    ] {
        let sql = format!(
            "SELECT id, {key}, name_fr, name_en, name_ja, {projection} \
             FROM {table} WHERE {key} IN ({placeholders}) ORDER BY {key}, id"
        );
        let table_rows = query_rows(conn, &sql, &params, |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "code": row.get::<_, String>(1)?,
                "name_fr": row.get::<_, Option<String>>(2)?,
                "name_en": row.get::<_, Option<String>>(3)?,
                "name_ja": row.get::<_, Option<String>>(4)?,
                "element": row.get::<_, Option<String>>(5).unwrap_or(None),
                "position": row.get::<_, Option<String>>(6).unwrap_or(None),
                "category": row.get::<_, Option<String>>(7).unwrap_or(None),
                "kind": kind,
            }))
        });
        if let Ok(mut table_rows) = table_rows {
            rows.append(&mut table_rows);
        }
    }
    Ok(Value::Array(rows))
}

fn mirror_stats(conn: &Connection) -> anyhow::Result<Value> {
    let table_names = query_rows(
        conn,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'inagle_%'",
        &[],
        |row| row.get::<_, String>(0),
    )?;
    let present = table_names.into_iter().collect::<HashSet<_>>();
    let count = |table: &str| -> anyhow::Result<Option<i64>> {
        if !present.contains(table) {
            return Ok(None);
        }
        Ok(Some(conn.query_row(
            &format!("SELECT count(*) FROM {table}"),
            [],
            |row| row.get(0),
        )?))
    };
    Ok(json!({
        "tables": present.len(),
        "personnages": count("inagle_characters")?,
        "techniques": count("inagle_skills")?,
        "objets": count("inagle_items")?,
        "equipes": count("inagle_teams")?,
        "avatars": count("inagle_keshins")?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_contracts_normalize_numbers_without_touching_raw_inspection() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE sample(id,stat,marker,marker2,name); INSERT INTO sample VALUES('2',' 238 ','\\N','\\\\N','Native'); INSERT INTO sample VALUES(3,'invalid',NULL,'','Other');").unwrap();
        let rows = contract_rows(
            &connection,
            "SELECT * FROM sample ORDER BY id",
            &["id", "stat"],
        )
        .unwrap();
        let values = rows.as_array().unwrap();
        let row = values.iter().find(|row| row["id"] == 2).unwrap();
        assert_eq!(row["stat"], 238);
        assert!(row["marker"].is_null() && row["marker2"].is_null());
        assert_eq!(row["name"], "Native");
        assert!(values.iter().find(|row| row["id"] == 3).unwrap()["stat"].is_null());
        let raw = readonly_rows(
            &connection,
            "SELECT id,stat FROM sample WHERE name='Native'",
        )
        .unwrap();
        assert_eq!(raw[0]["id"], "2");
        assert_eq!(raw[0]["stat"], " 238 ");
    }
}
