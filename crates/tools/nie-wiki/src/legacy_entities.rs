//! Frozen Azalee team/staff wire projections (rg 93aea3ba).
//!
//! Canonical typed profiles intentionally normalize IDs and omit spreadsheet cells.
//! This compatibility boundary retains those public scalar types and joins the same
//! mirror tables through the shared row decoder; no gameplay rules live here.

use rusqlite::{Connection, types::Value as SqlValue};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;

#[derive(Debug, Default, Deserialize)]
pub struct CoachRequest {
    pub q: Option<String>,
}

pub(crate) fn rows(
    connection: &Connection,
    sql: &str,
    parameters: &[SqlValue],
) -> anyhow::Result<Vec<Value>> {
    let mut statement = connection.prepare(sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    Ok(statement
        .query_map(rusqlite::params_from_iter(parameters), |row| {
            let mut record = crate::entities::ligne_en_json(row, &columns)?;
            for value in record.values_mut() {
                if value
                    .as_str()
                    .is_some_and(|value| matches!(value, "\\N" | "\\\\N"))
                {
                    *value = Value::Null;
                }
            }
            Ok(Value::Object(record))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn clean(value: &Value) -> Option<&str> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.starts_with("#N/A"))
}

fn scaling(connection: &Connection) -> anyhow::Result<HashMap<String, Value>> {
    Ok(rows(connection, "SELECT id,coord_common,coord_legendary,manager_common,manager_legendary,requirements,stat FROM inagle_manager_passives", &[])?.into_iter().map(|row| {
        (row["id"].to_string(), json!({"id":row["id"],"coordCommon":clean(&row["coord_common"]),"coordLegendary":clean(&row["coord_legendary"]),"managerCommon":clean(&row["manager_common"]),"managerLegendary":clean(&row["manager_legendary"]),"requirements":clean(&row["requirements"]),"stat":clean(&row["stat"])}))
    }).collect())
}

fn project_coach(row: &Value, passive: Option<&Value>, code: Option<&str>) -> Value {
    let (role, role_fr) = match row["role"].as_str() {
        Some("Coach") => ("Coach", "Coach"),
        Some("Manager") => ("Manager", "Manager"),
        _ => ("Coordinator", "Coordinateur"),
    };
    let element = clean(&row["element"]);
    let (element_key, element_fr) = match element {
        Some("山") => (Some("mountain"), Some("Montagne")),
        Some("林") => (Some("forest"), Some("Forêt")),
        Some("火") => (Some("fire"), Some("Feu")),
        Some("風") => (Some("wind"), Some("Vent")),
        _ => (None, None),
    };
    let playstyle = clean(&row["playstyle"]);
    let playstyle_fr = playstyle.map(|value| match value {
        "Bond" => "Lien",
        "Breach" => "Percée",
        "Counter" => "Contre",
        "Justice" => "Justice",
        "Rough Play" => "Jeu rugueux",
        "Tension" => "Tension",
        other => other,
    });
    let fallback = format!(
        "#{}",
        row["id"]
            .as_str()
            .map_or_else(|| row["id"].to_string(), str::to_owned)
    );
    let name = clean(&row["name_localised"])
        .or_else(|| clean(&row["name_romaji"]))
        .or_else(|| clean(&row["name_kanji"]))
        .unwrap_or(&fallback);
    json!({"buff":clean(&row["buff"]),"elementFr":element_fr,"elementKanji":element,"elementKey":element_key,"gender":clean(&row["gender"]),"id":row["id"],"image":clean(&row["image"]),"internalCode":code,"name":name,"nameKanji":clean(&row["name_kanji"]),"nameLocalised":clean(&row["name_localised"]),"nameRomaji":clean(&row["name_romaji"]),"passiveNo":row["passive_no"],"playstyle":playstyle,"playstyleFr":playstyle_fr,"requirements":clean(&row["requirements"]),"role":role,"roleFr":role_fr,"scaling":passive,"stat":clean(&row["stat"])})
}

const COACH_COLUMNS: &str = "id,image,name_kanji,name_romaji,name_localised,gender,role,element,playstyle,passive_no,requirements,stat,buff";

/// The historical HTTP list only accepts `q`; other query fields were ignored.
pub fn coaches(connection: &Connection, input: &CoachRequest) -> anyhow::Result<Value> {
    let passives = scaling(connection)?;
    let mut codes = HashMap::new();
    for row in rows(
        connection,
        "SELECT name_en,internal_code FROM inagle_characters",
        &[],
    )? {
        if let (Some(name), Some(code)) = (
            row["name_en"]
                .as_str()
                .map(str::trim)
                .filter(|v| !v.is_empty()),
            row["internal_code"].as_str().filter(|v| !v.is_empty()),
        ) {
            codes
                .entry(name.to_owned())
                .or_insert_with(|| code.to_owned());
        }
    }
    let query = input.q.as_deref().unwrap_or("").trim().to_lowercase();
    Ok(Value::Array(
        rows(
            connection,
            &format!("SELECT {COACH_COLUMNS} FROM inagle_coordinators ORDER BY id ASC"),
            &[],
        )?
        .iter()
        .map(|row| {
            let code = row["name_localised"]
                .as_str()
                .and_then(|name| codes.get(name.trim()))
                .map(String::as_str);
            project_coach(row, passives.get(&row["passive_no"].to_string()), code)
        })
        .filter(|row| {
            query.is_empty()
                || ["name", "nameRomaji", "nameKanji", "nameLocalised", "stat"]
                    .iter()
                    .filter_map(|key| row[key].as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_lowercase()
                    .contains(&query)
        })
        .collect(),
    ))
}

/// Decimal prefix parsing reproduces the historical route's `parseInt(id, 10)`.
pub fn coach(connection: &Connection, key: &str) -> anyhow::Result<Option<Value>> {
    let key = key.trim_start();
    let end = key
        .char_indices()
        .find(|(i, ch)| !ch.is_ascii_digit() && !(*i == 0 && matches!(ch, '+' | '-')))
        .map_or(key.len(), |(i, _)| i);
    let Ok(id) = key[..end].parse::<i64>() else {
        return Ok(None);
    };
    let Some(row) = rows(
        connection,
        &format!("SELECT {COACH_COLUMNS} FROM inagle_coordinators WHERE id=?1"),
        &[SqlValue::Integer(id)],
    )?
    .into_iter()
    .next() else {
        return Ok(None);
    };
    let passives = scaling(connection)?;
    let code = if let Some(name) = row["name_localised"]
        .as_str()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        rows(
            connection,
            "SELECT internal_code FROM inagle_characters WHERE name_en=?1 LIMIT 1",
            &[SqlValue::Text(name.into())],
        )?
        .first()
        .and_then(|row| row["internal_code"].as_str())
        .map(str::to_owned)
    } else {
        None
    };
    Ok(Some(project_coach(
        &row,
        passives.get(&row["passive_no"].to_string()),
        code.as_deref(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coach_projection_preserves_raw_types_and_cleans_spreadsheet_errors() {
        let row = json!({"id":"10","passive_no":"3","name_romaji":" Name ","name_localised":"#N/A bad","element":" 林 ","role":"unknown","stat":"#N/A missing","playstyle":"Breach"});
        let projected = project_coach(&row, None, None);
        assert_eq!(projected["id"], "10");
        assert_eq!(projected["passiveNo"], "3");
        assert_eq!(projected["name"], "Name");
        assert_eq!(projected["role"], "Coordinator");
        assert_eq!(projected["elementKey"], "forest");
        assert_eq!(projected["playstyleFr"], "Percée");
        assert!(projected["stat"].is_null());
        assert!(projected["internalCode"].is_null());
    }

    #[test]
    fn staff_joins_preserve_list_and_detail_portrait_resolution() {
        let connection = Connection::open_in_memory().unwrap();
        let columns = COACH_COLUMNS
            .split(',')
            .map(|name| format!("{name} TEXT"))
            .collect::<Vec<_>>()
            .join(",");
        connection.execute_batch(&format!("CREATE TABLE inagle_coordinators({columns});
            CREATE TABLE inagle_manager_passives(id TEXT,coord_common TEXT,coord_legendary TEXT,manager_common TEXT,manager_legendary TEXT,requirements TEXT,stat TEXT);
            CREATE TABLE inagle_characters(name_en TEXT,internal_code TEXT);
            INSERT INTO inagle_coordinators(id,name_localised,role,passive_no,stat) VALUES('1','Alex','Coach','4','Shot'),('10','Zed','Manager',NULL,'#N/A'),('2','Bob','Coordinator',NULL,'Pass');
            INSERT INTO inagle_manager_passives(id,coord_common,stat) VALUES('4',' 5% ',' Kick ');
            INSERT INTO inagle_characters VALUES('Alex',NULL),('Alex','c_second'),(' Alex ','c_third');")).unwrap();
        let list = coaches(&connection, &CoachRequest::default()).unwrap();
        assert_eq!(
            list.as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["1", "10", "2"]
        );
        assert_eq!(list[0]["internalCode"], "c_second");
        assert_eq!(list[0]["scaling"]["coordCommon"], "5%");
        assert_eq!(list[0]["scaling"]["id"], "4");
        let detail = coach(&connection, " +1trailing").unwrap().unwrap();
        assert!(detail["internalCode"].is_null());
        assert_eq!(detail["id"], "1");
        for query in ["aLeX", " sHot "] {
            assert_eq!(
                coaches(
                    &connection,
                    &CoachRequest {
                        q: Some(query.into())
                    }
                )
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
                1
            );
        }
        assert!(
            coaches(
                &connection,
                &CoachRequest {
                    q: Some("Coach".into())
                }
            )
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
        );
        for id in ["missing", "0x10", "999", "-1", "+"] {
            assert!(coach(&connection, id).unwrap().is_none());
        }
    }

    #[test]
    #[ignore = "requires frozen historical entities fixture and licensed mirror"]
    fn coaches_match_complete_historical_oracle() {
        let fixture = std::env::var("NIE_ENTITIES_PARITY_FIXTURE").expect("fixture");
        let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror");
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
        let connection =
            Connection::open_with_flags(mirror, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        let mut count = 0;
        for case in cases {
            let actual = match case["kind"].as_str().unwrap() {
                "coach" => coach(&connection, case["request"]["id"].as_str().unwrap())
                    .unwrap()
                    .unwrap_or(Value::Null),
                "coaches" => coaches(
                    &connection,
                    &serde_json::from_value(case["request"].clone()).unwrap(),
                )
                .unwrap(),
                _ => continue,
            };
            assert!(
                actual == case["expected"],
                "staff contract differs at request {}",
                case["request"]
            );
            count += 1;
        }
        assert_eq!(count, 115);
    }
}
