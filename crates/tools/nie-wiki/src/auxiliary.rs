//! Read-only IEVR wiki sections that used to live in Azalee's TypeScript service.
//!
//! The functions in this module deliberately project only columns that exist in the
//! SQLite mirror. JSON columns are decoded as values and are never enriched with
//! invented game data. HTTP and CLI bindings own pagination and transport errors.

use anyhow::Context;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;

fn text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_owned();
        (!value.is_empty()).then_some(value)
    })
}

fn json_column(raw: Option<String>) -> Value {
    raw.and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or(Value::Null)
}

fn localized(fr: Option<String>, en: Option<String>, ja: Option<String>) -> Value {
    json!({"fr": text(fr), "en": text(en), "ja": text(ja)})
}

// ─── Quests ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct QuestRequest {
    pub q: Option<String>,
    pub kind: Option<String>,
}

pub fn list_quests(conn: &Connection, request: &QuestRequest) -> anyhow::Result<Value> {
    let mut statement = conn.prepare(
        "SELECT id, type, phase, image_url, name_fr, name_en, name_ja, data
         FROM inagle_quests ORDER BY COALESCE(phase, 0), id",
    )?;
    let mut quests = Vec::new();
    let q = request.q.as_deref().unwrap_or("").trim().to_lowercase();
    for row in statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
        ))
    })? {
        let (id, flat_type, flat_phase, image, fr, en, ja, raw) = row?;
        let data = json_column(raw);
        let phase = data
            .get("phase")
            .and_then(Value::as_i64)
            .or(flat_phase)
            .unwrap_or(0);
        let kind = if phase >= 1000 { "side" } else { "main" };
        if request
            .kind
            .as_deref()
            .is_some_and(|value| value != "all" && value != kind)
        {
            continue;
        }
        let titles = data.get("titles").cloned().unwrap_or_else(|| {
            localized(
                fr.clone().or_else(|| {
                    data.get("explain_FR")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                }),
                en.clone().or_else(|| {
                    data.get("explain_EN")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                }),
                ja.clone().or_else(|| {
                    data.get("explain_JA")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                }),
            )
        });
        let title = titles
            .get("fr")
            .and_then(Value::as_str)
            .or_else(|| titles.get("en").and_then(Value::as_str))
            .or_else(|| titles.get("ja").and_then(Value::as_str))
            .unwrap_or(&id)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !q.is_empty() {
            let haystack = format!(
                "{} {} {} {}",
                id,
                title,
                titles.get("en").and_then(Value::as_str).unwrap_or(""),
                titles.get("ja").and_then(Value::as_str).unwrap_or("")
            )
            .to_lowercase();
            if !haystack.contains(&q) {
                continue;
            }
        }
        quests.push(json!({
            "id": id,
            "title": title,
            "titles": titles,
            "type": data.get("type").and_then(Value::as_i64).or(flat_type).unwrap_or(0),
            "phase": phase,
            "image": data.get("image").cloned().or_else(|| image.map(Value::String)).unwrap_or(Value::Null),
            "kind": kind,
            "area": if kind == "side" { Value::from(phase / 10000) } else { Value::Null },
        }));
    }
    let main = quests
        .iter()
        .filter(|quest| quest["kind"] == "main")
        .count();
    let total = quests.len();
    Ok(json!({"quests": quests, "total": total, "main": main, "side": total - main}))
}

pub fn get_quest(conn: &Connection, id: &str) -> anyhow::Result<Option<Value>> {
    let all = list_quests(conn, &QuestRequest::default())?;
    Ok(all["quests"].as_array().and_then(|quests| {
        quests
            .iter()
            .find(|quest| {
                quest["id"]
                    .as_str()
                    .is_some_and(|value| value.eq_ignore_ascii_case(id))
            })
            .cloned()
    }))
}

// ─── Shops ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct ShopRequest {
    pub shop_id: Option<i64>,
}

pub fn list_shops(conn: &Connection, request: &ShopRequest) -> anyhow::Result<Value> {
    let mut statement = conn.prepare(
        "SELECT shop_id, name_fr, name_en, name_ja, item_db_id, item_name_fr,
                item_name_en, slot_index
         FROM inagle_shops WHERE (?1 IS NULL OR shop_id = ?1)
         ORDER BY shop_id, slot_index, item_db_id",
    )?;
    let mut shops: HashMap<i64, Value> = HashMap::new();
    for row in statement.query_map(params![request.shop_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<i64>>(7)?,
        ))
    })? {
        let (id, name_fr, name_en, name_ja, item_id, item_fr, item_en, slot) = row?;
        let item = json!({"id": item_id.unwrap_or_default(), "name": text(item_fr).or_else(|| text(item_en)).unwrap_or_else(|| "Unknown item".into()), "slotIndex": slot.unwrap_or_default()});
        let entry = shops.entry(id).or_insert_with(|| json!({"shopId": id, "name": text(name_fr.clone()).unwrap_or_else(|| format!("Shop {id}")), "nameEn": text(name_en.clone()), "nameJa": text(name_ja.clone()), "itemCount": 0, "categories": [], "items": []}));
        entry["itemCount"] = Value::from(entry["itemCount"].as_i64().unwrap_or(0) + 1);
        entry["items"]
            .as_array_mut()
            .expect("items array")
            .push(item);
    }
    let mut values: Vec<Value> = shops.into_values().collect();
    values.sort_by(|a, b| {
        b["itemCount"]
            .as_i64()
            .cmp(&a["itemCount"].as_i64())
            .then_with(|| a["shopId"].as_i64().cmp(&b["shopId"].as_i64()))
    });
    Ok(Value::Array(values))
}

pub fn get_shop(conn: &Connection, shop_id: i64) -> anyhow::Result<Option<Value>> {
    Ok(list_shops(
        conn,
        &ShopRequest {
            shop_id: Some(shop_id),
        },
    )?
    .as_array()
    .and_then(|shops| shops.first().cloned()))
}

// ─── Capsules and costumes ─────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct CapsuleRequest {
    pub q: Option<String>,
    pub pool: Option<String>,
    pub page: Option<u32>,
    pub limit: Option<u32>,
}

fn hex_u32(value: i64) -> String {
    format!("0x{:08X}", value as u32)
}

pub fn list_capsules(conn: &Connection, request: &CapsuleRequest) -> anyhow::Result<Value> {
    let mut statement = conn.prepare("SELECT id, prize_data FROM inagle_capsules ORDER BY id")?;
    let mut all = Vec::new();
    for row in statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    })? {
        let (id, raw) = row?;
        let vars: Vec<i64> = json_column(raw)
            .as_array()
            .map(|values| values.iter().filter_map(Value::as_i64).collect())
            .unwrap_or_default();
        let prize = json!({"id": id, "contentRef": vars.get(1).map_or_else(|| hex_u32(0), |v| hex_u32(*v)), "poolRef": vars.get(3).map_or_else(|| hex_u32(0), |v| hex_u32(*v)), "extraFlag": vars.get(5).copied().unwrap_or(0), "vars": vars});
        let pool_match = request
            .pool
            .as_deref()
            .is_none_or(|pool| prize["poolRef"] == pool);
        let q_match = request.q.as_deref().is_none_or(|q| {
            let q = q.to_lowercase();
            prize["id"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(&q)
                || prize["contentRef"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&q)
        });
        if pool_match && q_match {
            all.push(prize);
        }
    }
    let page = request.page.unwrap_or(1).max(1);
    let limit = request.limit.unwrap_or(48).clamp(1, 200);
    let start = ((page - 1) * limit) as usize;
    let data = all
        .iter()
        .skip(start)
        .take(limit as usize)
        .cloned()
        .collect::<Vec<_>>();
    Ok(json!({"data": data, "total": all.len(), "page": page, "limit": limit}))
}

pub fn get_capsule(conn: &Connection, id: &str) -> anyhow::Result<Option<Value>> {
    let mut statement = conn.prepare("SELECT id, prize_data FROM inagle_capsules WHERE id = ?1")?;
    let row = statement
        .query_row([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .optional()?;
    row.map(|(id, raw)| {
        let vars: Vec<i64> = json_column(raw).as_array().map(|values| values.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
        Ok(json!({"id": id, "contentRef": vars.get(1).map_or_else(|| hex_u32(0), |v| hex_u32(*v)), "poolRef": vars.get(3).map_or_else(|| hex_u32(0), |v| hex_u32(*v)), "extraFlag": vars.get(5).copied().unwrap_or(0), "vars": vars}))
    }).transpose()
}

pub fn list_costumes(conn: &Connection, page: u32, limit: u32) -> anyhow::Result<Value> {
    let total: u64 =
        conn.query_row("SELECT count(*) FROM inagle_costumes", [], |row| row.get(0))?;
    let mut statement = conn.prepare("SELECT id, costume_index, type, model_ref, flag1, flag2 FROM inagle_costumes ORDER BY costume_index LIMIT ?1 OFFSET ?2")?;
    let rows = statement.query_map(params![i64::from(limit.clamp(1, 200)), i64::from(page.saturating_sub(1) * limit)], |row| {
        let kind: i64 = row.get(2)?;
        Ok(json!({"id": row.get::<_, String>(0)?, "index": row.get::<_, i64>(1)?, "type": kind, "typeLabel": match kind { 0 => "Standard", 1 => "Variant A", 2 => "Variant B", _ => "Unknown" }, "modelRef": row.get::<_, Option<String>>(3)?.unwrap_or_default(), "flag1": row.get::<_, Option<i64>>(4)?.unwrap_or_default(), "flag2": row.get::<_, Option<i64>>(5)?.unwrap_or_default()}))
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"data": rows, "total": total, "page": page.max(1), "limit": limit.clamp(1, 200)}))
}

// ─── Stages, trophies and coaches ──────────────────────────────────────────

pub fn list_stadiums(conn: &Connection, q: Option<&str>) -> anyhow::Result<Value> {
    let mut statement = conn.prepare("SELECT id, field_index, image_path, condition, data FROM inagle_stadiums ORDER BY field_index, id")?;
    let q = q.unwrap_or("").trim().to_lowercase();
    let rows = statement.query_map([], |row| {
        Ok(json!({"id": row.get::<_, String>(0)?, "index": row.get::<_, Option<i64>>(1)?, "imagePath": row.get::<_, Option<String>>(2)?, "condition": row.get::<_, Option<String>>(3)?, "data": json_column(row.get::<_, Option<String>>(4)?)}))
    })?.collect::<Result<Vec<_>, _>>()?;
    let rows = rows
        .into_iter()
        .filter(|row| q.is_empty() || row.to_string().to_lowercase().contains(&q))
        .collect::<Vec<_>>();
    let total = rows.len();
    Ok(json!({"data": rows, "total": total}))
}

pub fn get_stadium(conn: &Connection, id: &str) -> anyhow::Result<Option<Value>> {
    Ok(conn.query_row("SELECT id, field_index, image_path, condition, data FROM inagle_stadiums WHERE id = ?1", [id], |row| Ok(json!({"id": row.get::<_, String>(0)?, "index": row.get::<_, Option<i64>>(1)?, "imagePath": row.get::<_, Option<String>>(2)?, "condition": row.get::<_, Option<String>>(3)?, "data": json_column(row.get::<_, Option<String>>(4)?)}))).optional()?)
}

pub fn list_trophies(
    conn: &Connection,
    q: Option<&str>,
    category: Option<&str>,
) -> anyhow::Result<Value> {
    let mut statement = conn.prepare("SELECT trophy_id, code, name_en, name_fr, name_ja, desc_en, desc_fr, desc_ja FROM inagle_trophies ORDER BY code")?;
    let q = q.unwrap_or("").trim().to_lowercase();
    let mut rows = statement.query_map([], |row| {
        let trophy_id: String = row.get(0)?;
        let code: String = row.get(1)?;
        let name_en: Option<String> = row.get(2)?;
        let name_fr: Option<String> = row.get(3)?;
        let name_ja: Option<String> = row.get(4)?;
        let desc_en: Option<String> = row.get(5)?;
        let desc_fr: Option<String> = row.get(6)?;
        let desc_ja: Option<String> = row.get(7)?;
        let kind = if code.starts_with("trophy") { "trophy" } else { "activity" };
        let group = code.split('_').nth(1).unwrap_or("");
        Ok(json!({"id": if code.is_empty() { trophy_id } else { code.clone() }, "code": code, "category": kind, "group": group, "name": text(name_fr.clone()).or_else(|| text(name_en.clone())).unwrap_or_default(), "desc": text(desc_fr.clone()).or_else(|| text(desc_en.clone())).unwrap_or_default(), "names": localized(name_fr, name_en, name_ja), "descriptions": localized(desc_fr, desc_en, desc_ja)}))
    })?.collect::<Result<Vec<_>, _>>()?;
    rows.retain(|row| {
        category.is_none_or(|value| value == row["category"].as_str().unwrap_or(""))
            && (q.is_empty() || row.to_string().to_lowercase().contains(&q))
    });
    let total = rows.len();
    Ok(json!({"trophies": rows, "total": total}))
}

pub fn list_coaches(conn: &Connection, q: Option<&str>) -> anyhow::Result<Value> {
    let mut statement = conn.prepare("SELECT id, name_kanji, name_romaji, name_localised, gender, role, element, playstyle, passive_no, requirements, stat, buff FROM inagle_coordinators ORDER BY id")?;
    let q = q.unwrap_or("").trim().to_lowercase();
    let rows = statement.query_map([], |row| {
        let id: i64 = row.get(0)?;
        let name_kanji: Option<String> = row.get(1)?;
        let name_romaji: Option<String> = row.get(2)?;
        let name_localised: Option<String> = row.get(3)?;
        let gender: Option<String> = row.get(4)?;
        let role: Option<String> = row.get(5)?;
        let element: Option<String> = row.get(6)?;
        let playstyle: Option<String> = row.get(7)?;
        let passive_no: Option<i64> = row.get(8)?;
        let requirements: Option<String> = row.get(9)?;
        let stat: Option<String> = row.get(10)?;
        let buff: Option<String> = row.get(11)?;
        let name = text(name_localised.clone()).or_else(|| text(name_romaji.clone())).or_else(|| text(name_kanji.clone())).unwrap_or_else(|| format!("#{id}"));
        Ok(json!({"id": id, "name": name, "nameKanji": name_kanji, "nameRomaji": name_romaji, "nameLocalised": name_localised, "gender": gender, "role": role, "element": element, "playstyle": playstyle, "passiveNo": passive_no, "requirements": text(requirements), "stat": text(stat), "buff": text(buff)}))
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(
        rows.into_iter()
            .filter(|row| q.is_empty() || row.to_string().to_lowercase().contains(&q))
            .collect(),
    ))
}

pub fn list_drops(conn: &Connection) -> anyhow::Result<Value> {
    let mut statement = conn.prepare("SELECT id, team, game, fixed_beans, passive_type, no, requirement, stat, value FROM inagle_drops ORDER BY id")?;
    let rows = statement.query_map([], |row| Ok(json!({"id": row.get::<_, i64>(0)?, "team": row.get::<_, Option<String>>(1)?, "game": row.get::<_, Option<String>>(2)?, "fixedBeans": row.get::<_, Option<String>>(3)?, "passiveType": row.get::<_, Option<String>>(4)?, "no": row.get::<_, Option<i64>>(5)?, "requirement": row.get::<_, Option<String>>(6)?, "stat": row.get::<_, Option<String>>(7)?, "value": row.get::<_, Option<String>>(8)?})))?.collect::<Result<Vec<_>, _>>()?;
    let count = rows.len();
    Ok(json!({"drops": rows, "count": count}))
}

pub fn list_invocations(conn: &Connection) -> anyhow::Result<Value> {
    let mut statement = conn.prepare("SELECT id, idx, name_fr, name_en, name_ja, character_count, character_ids, data FROM inagle_constellations ORDER BY idx, id")?;
    let rows = statement.query_map([], |row| {
        let id: String = row.get(0)?;
        let sign_no: Option<i64> = row.get(1)?;
        let name_fr: Option<String> = row.get(2)?;
        let name_en: Option<String> = row.get(3)?;
        let name_ja: Option<String> = row.get(4)?;
        let total_chars: Option<i64> = row.get(5)?;
        let character_ids: Option<String> = row.get(6)?;
        let data: Option<String> = row.get(7)?;
        Ok(json!({"id": id, "signNo": sign_no, "name": text(name_fr).or_else(|| text(name_en)).or_else(|| text(name_ja)), "totalChars": total_chars, "characterIds": json_column(character_ids), "data": json_column(data)}))
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(rows))
}

/// Verifies that all auxiliary tables used by the native wiki are readable.
pub fn verify_auxiliary_schema(conn: &Connection) -> anyhow::Result<usize> {
    let tables = [
        "inagle_quests",
        "inagle_shops",
        "inagle_capsules",
        "inagle_costumes",
        "inagle_stadiums",
        "inagle_trophies",
        "inagle_coordinators",
        "inagle_drops",
        "inagle_constellations",
    ];
    for table in tables {
        conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |_| Ok(()))
            .with_context(|| format!("missing or unreadable table {table}"))?;
    }
    Ok(tables.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE inagle_quests(id TEXT, type INTEGER, phase INTEGER, image_url TEXT, name_fr TEXT, name_en TEXT, name_ja TEXT, data TEXT);
             INSERT INTO inagle_quests VALUES ('q2', 2, 12000, NULL, NULL, NULL, NULL, '{\"titles\":{\"fr\":\"Quête annexe\"},\"phase\":12000}');
             INSERT INTO inagle_quests VALUES ('q1', 1, 2, NULL, 'Chapitre 1', NULL, NULL, NULL);
             CREATE TABLE inagle_shops(shop_id INTEGER, name_fr TEXT, name_en TEXT, name_ja TEXT, item_db_id TEXT, item_name_fr TEXT, item_name_en TEXT, slot_index INTEGER);
             INSERT INTO inagle_shops VALUES (7, 'Boutique', 'Shop', NULL, 'i1', 'Ballon', NULL, 0);
             CREATE TABLE inagle_trophies(trophy_id TEXT, code TEXT, name_en TEXT, name_fr TEXT, name_ja TEXT, desc_en TEXT, desc_fr TEXT, desc_ja TEXT);
             INSERT INTO inagle_trophies VALUES ('t1', 'trophy_story_01', 'Story', 'Histoire', NULL, 'Done', 'Terminé', NULL);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn quest_projection_preserves_real_fields_and_kind() {
        let page = list_quests(&fixture(), &QuestRequest::default()).unwrap();
        assert_eq!(page["total"], 2);
        assert_eq!(page["quests"][0]["id"], "q1");
        assert_eq!(page["quests"][1]["kind"], "side");
        assert_eq!(page["quests"][1]["area"], 1);
    }

    #[test]
    fn shop_projection_groups_rows_and_detail_resolves() {
        let shops = list_shops(&fixture(), &ShopRequest::default()).unwrap();
        assert_eq!(shops[0]["shopId"], 7);
        assert_eq!(shops[0]["itemCount"], 1);
        assert_eq!(
            get_shop(&fixture(), 7).unwrap().unwrap()["name"],
            "Boutique"
        );
    }

    #[test]
    fn trophy_projection_falls_back_and_filters() {
        let trophies = list_trophies(&fixture(), Some("termin"), Some("trophy")).unwrap();
        assert_eq!(trophies["total"], 1);
        assert_eq!(trophies["trophies"][0]["name"], "Histoire");
        assert!(verify_auxiliary_schema(&fixture()).is_err());
    }
}
