//! Historical Azalee JSON projections. Selection remains owned by `catalog`;
//! this adapter preserves the old field names and page-local variant grouping.
//!
//! Baseline: `rg` commit `93aea3ba8b703d8ca66ca8d3b98988edea3c97df`,
//! `packages/azalee/src/wiki/service.ts` and `src/db/sqlite-client.ts`.
//! Numeric strings and optional-field omission are intentional wire compatibility;
//! the canonical catalogue remains typed independently of this historical shape.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, types::ValueRef};
use serde::Deserialize;
use serde_json::{Map, Value, json};

#[derive(Debug, Default, Deserialize)]
pub struct CharacterListRequest {
    pub page: Option<u32>,
    pub limit: Option<u32>,
    pub q: Option<String>,
    pub element: Option<String>,
    pub position: Option<String>,
    pub rarity: Option<String>,
    pub team: Option<String>,
    pub series: Option<String>,
    pub gender: Option<String>,
    pub playstyle: Option<String>,
    pub status: Option<String>,
    pub role: Option<String>,
    #[serde(rename = "ageGroup")]
    pub age_group: Option<String>,
    #[serde(rename = "schoolYear")]
    pub school_year: Option<String>,
}

const COLUMNS: &[&str] = &[
    "id",
    "chara_id",
    "internal_code",
    "name_fr",
    "name_en",
    "name_ja",
    "rarity_label",
    "position",
    "element",
    "gender",
    "image_url",
    "description_fr",
    "description_en",
    "description_ja",
    "sheet_data",
    "skills",
    "stats",
    "teams",
    "wiki_sections",
    "slug",
    "base_slug",
    "series",
    "team_id",
    "zukan_hash",
    "zukan_order",
    "hero_type",
    "nickname",
    "age_group",
    "school_year",
    "uniform_number",
    "control_type",
    "is_controllable",
    "constellation",
    "constellation_index",
    "stat_frappe",
    "stat_controle",
    "stat_technique",
    "stat_pression",
    "stat_physique",
    "stat_agilite",
    "stat_intelligence",
    "stat_lv1_frappe",
    "stat_lv1_controle",
    "stat_lv1_technique",
    "stat_lv1_pression",
    "stat_lv1_physique",
    "stat_lv1_agilite",
    "stat_lv1_intelligence",
];

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64() != Some(0.0),
        Value::String(value) => !value.is_empty(),
        _ => true,
    }
}

fn value_or(value: &Value, fallback: Value) -> Value {
    if truthy(value) {
        value.clone()
    } else {
        fallback
    }
}

fn source_row(connection: &Connection, id: &str) -> anyhow::Result<Value> {
    let sql = format!(
        "SELECT {} FROM inagle_characters WHERE id=?1",
        COLUMNS.join(",")
    );
    connection
        .query_row(&sql, [id], |row| {
            let mut fields = Map::new();
            for (index, &name) in COLUMNS.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(value) => json!(value),
                    ValueRef::Real(value) => json!(value),
                    ValueRef::Text(bytes) => {
                        let text = String::from_utf8_lossy(bytes);
                        if matches!(text.as_ref(), "\\N" | "\\\\N") {
                            Value::Null
                        } else if name == "zukan_order" {
                            text.parse::<i64>()
                                .map_or_else(|_| json!(text), |value| json!(value))
                        } else if text.starts_with(['{', '[']) {
                            serde_json::from_str(&text).unwrap_or_else(|_| json!(text))
                        } else {
                            json!(text)
                        }
                    }
                    ValueRef::Blob(_) => Value::Null,
                };
                fields.insert(name.into(), value);
            }
            Ok(Value::Object(fields))
        })
        .map_err(Into::into)
}

fn stats(row: &Value, prefix: &str) -> Value {
    let fields = [
        ("kick", "frappe"),
        ("control", "controle"),
        ("technique", "technique"),
        ("pressure", "pression"),
        ("physical", "physique"),
        ("agility", "agilite"),
        ("intelligence", "intelligence"),
    ];
    Value::Object(
        fields
            .into_iter()
            .map(|(public, native)| {
                (
                    public.to_owned(),
                    value_or(&row[format!("{prefix}{native}")], json!(0)),
                )
            })
            .collect(),
    )
}

fn rarity_code(label: &str) -> u32 {
    match label {
        "En progression" => 1,
        "Expérimenté" => 2,
        "Émérite" => 3,
        "Légendaire" => 5,
        "Héros" => 10,
        "BASARA" => 20,
        _ => 0,
    }
}

fn face_code(code: &str, label: &str) -> String {
    if label != "Héros" {
        return code.into();
    }
    match code {
        "c03030100" => "c03032210",
        "c05024640" => "c02024040",
        "c05024690" => "c03030040",
        "c05026600" => "c03030010",
        "c06037430" => "c02023810",
        "c06037440" => "c03030020",
        "c06039070" => "c04000100",
        "c07020120" => "c01000300",
        "c07040120" => "c01000030",
        "c07050010" => "c01000100",
        "c07070010" => "c01000210",
        "c07070110" => "c02023700",
        "c07070120" => "c01000020",
        "c07080010" => "c01001900",
        "c07090010" => "c02023290",
        "c07110020" => "c01000010",
        "c07120060" => "c01010910",
        "c11010230" => "c11010070",
        "c11250060" => "c03033690",
        "c11600030" => "c05028160",
        _ => code,
    }
    .into()
}

fn project(row: &Value) -> anyhow::Result<Value> {
    // The measured character mirror contains no image URLs. Do not silently serve a
    // legacy storage path as though the corresponding migrated asset route existed.
    let image = row["image_url"].clone();
    anyhow::ensure!(
        image.is_null()
            || image.as_str().is_some_and(|url| url.starts_with("http")
                || (url.starts_with('/') && !url.starts_with("/menu/"))),
        "legacy character asset URL requires native resource resolution"
    );
    let label = row["rarity_label"].as_str().unwrap_or("Normal");
    let code = row["internal_code"]
        .as_str()
        .or(row["id"].as_str())
        .unwrap_or_default();
    let mut progression = json!({"lv99": stats(row, "stat_")});
    if !row["stat_lv1_frappe"].is_null() {
        progression["lv1"] = stats(row, "stat_lv1_");
    }
    for level in ["lv30", "lv50"] {
        if truthy(&row["stats"][level]["kick"]) {
            progression[level] = row["stats"][level].clone();
        }
    }
    let mut skills = row["skills"].as_array().cloned().unwrap_or_default();
    for skill in &mut skills {
        let skill_number = skill["skillId"].as_u64().or_else(|| {
            skill["skillId"]
                .as_str()
                .and_then(|id| u64::from_str_radix(id.trim_start_matches("0x"), 16).ok())
        });
        let learn_number = skill["learnLevel"].as_i64().or_else(|| {
            skill["learnLevel"]
                .as_str()
                .and_then(|value| value.parse().ok())
        });
        if let (Some(skill_number), Some(learn_number)) = (skill_number, learn_number)
            && skill_number < 1000
            && learn_number.unsigned_abs() > 1_000_000
        {
            *skill = json!({"skillId":format!("0x{:08X}", learn_number as u32),"learnLevel":skill_number});
        }
    }
    let mut variant = json!({"charaParamId":row["id"], "position":value_or(&row["position"],json!("MF")),
        "positionRaw":0,"element":value_or(&row["element"],json!("Void")),"elementRaw":0,
        "rarity":label,"rarityCode":rarity_code(label),"stats":progression,"skills":skills,
        "image":image,"sheetData":row["sheet_data"],"slug":row["slug"],"zukanOrder":row["zukan_order"],"internalCode":code});
    for (target, source) in [
        ("zukanHash", "zukan_hash"),
        ("series", "series"),
        ("heroType", "hero_type"),
    ] {
        if truthy(&row[source]) {
            variant[target] = row[source].clone();
        }
    }
    let mut result = json!({"charaId":value_or(&row["chara_id"],json!(code)),"internalCode":face_code(code,label),
        "names":{"fr":row["name_fr"],"en":row["name_en"],"ja":row["name_ja"]},
        "gender":match row["gender"].as_str() {Some("F")=>1,Some("X")=>2,_=>0},
        "variants":[variant],"bestRarity":label,"bestRarityCode":rarity_code(label),"isBasara":label=="BASARA",
        "image":image,"descriptions":{"fr":row["description_fr"],"en":row["description_en"],"ja":row["description_ja"]},
        "sheetData":row["sheet_data"],"wikiSections":value_or(&row["wiki_sections"],json!([])),
        "slug":row["slug"],"baseSlug":row["base_slug"],"teamId":row["team_id"],
        "teamName":value_or(&row["teams"][0]["names"]["fr"], value_or(&row["teams"][0]["names"]["en"],json!("")))});
    for (target, source) in [
        ("series", "series"),
        ("zukanHash", "zukan_hash"),
        ("nickname", "nickname"),
        ("ageGroup", "age_group"),
        ("schoolYear", "school_year"),
        ("controlType", "control_type"),
        ("isControllable", "is_controllable"),
    ] {
        if truthy(&row[source]) {
            result[target] = row[source].clone();
        }
    }
    if !row["uniform_number"].is_null() {
        result["uniformNumber"] = row["uniform_number"].clone();
    }
    if truthy(&row["constellation"]) {
        result["constellation"] = json!({"index":value_or(&row["constellation_index"],json!(0)),"names":{"fr":row["constellation"]}});
    }
    Ok(result)
}

fn group(rows: Vec<Value>) -> Vec<Value> {
    let mut grouped: Vec<Value> = Vec::new();
    for row in rows {
        let key = value_or(&row["baseSlug"], row["charaId"].clone());
        if let Some(existing) = grouped
            .iter_mut()
            .find(|existing| value_or(&existing["baseSlug"], existing["charaId"].clone()) == key)
        {
            existing["variants"]
                .as_array_mut()
                .unwrap()
                .extend(row["variants"].as_array().unwrap().iter().cloned());
            existing["isBasara"] = json!(truthy(&existing["isBasara"]) || truthy(&row["isBasara"]));
            if !truthy(&existing["constellation"]) && row.get("constellation").is_some() {
                existing["constellation"] = row["constellation"].clone();
            }
            if existing["wikiSections"]
                .as_array()
                .is_none_or(Vec::is_empty)
            {
                existing["wikiSections"] = row["wikiSections"].clone();
            }
        } else {
            grouped.push(row);
        }
    }
    for row in &mut grouped {
        let variants = row["variants"].as_array_mut().unwrap();
        let mut seen = BTreeSet::new();
        let mut deduped: Vec<Value> = Vec::new();
        let key = |variant: &Value| {
            [
                "position",
                "element",
                "rarity",
                "heroType",
                "internalCode",
                "series",
            ]
            .map(|field| variant[field].as_str().unwrap_or_default())
            .join("|")
        };
        for variant in variants.drain(..) {
            let identity = key(&variant);
            if seen.insert(identity.clone()) {
                deduped.push(variant);
            } else if let Some(existing) = deduped
                .iter_mut()
                .find(|candidate| key(candidate) == identity)
                && ((!truthy(&existing["sheetData"]) && truthy(&variant["sheetData"]))
                    || variant["skills"].as_array().map_or(0, Vec::len)
                        > existing["skills"].as_array().map_or(0, Vec::len))
            {
                *existing = variant;
            }
        }
        deduped.sort_by_key(|variant| {
            (
                variant["zukanOrder"].as_i64().unwrap_or(999_999),
                u64::from_str_radix(
                    variant["charaParamId"]
                        .as_str()
                        .unwrap_or_default()
                        .trim_start_matches("0x"),
                    16,
                )
                .unwrap_or(0),
            )
        });
        *variants = deduped;
        if let Some(first) = variants.first().cloned() {
            row["bestRarity"] = first["rarity"].clone();
            row["bestRarityCode"] = first["rarityCode"].clone();
            for field in ["image", "zukanHash", "slug", "sheetData"] {
                if truthy(&first[field]) {
                    row[field] = first[field].clone();
                }
            }
        }
    }
    grouped
}

fn character_ids(
    connection: &Connection,
    column: &str,
    value: &str,
    ordered: bool,
    constellation_only: bool,
) -> anyhow::Result<Vec<String>> {
    // Column names are internal constants, never interpolated request input.
    anyhow::ensure!(matches!(
        column,
        "id" | "slug" | "base_slug" | "chara_id" | "name_en"
    ));
    let condition = if constellation_only {
        " AND constellation IS NOT NULL AND constellation NOT IN ('\\N', '\\\\N')"
    } else {
        ""
    };
    let order = if ordered {
        " ORDER BY zukan_order ASC NULLS LAST, id ASC"
    } else {
        ""
    };
    let mut statement = connection.prepare(&format!(
        "SELECT id FROM inagle_characters WHERE {column}=?1{condition}{order}"
    ))?;
    Ok(statement
        .query_map([value], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

/// Preserve the historical base-slug, variant-slug, then exact-ID resolution order.
/// The selected row controls constellation inheritance; the returned group keeps source order.
pub fn character(connection: &Connection, key: &str) -> anyhow::Result<Option<Value>> {
    if key.is_empty() || key.len() > 256 || key.chars().any(char::is_control) {
        return Ok(None);
    }
    let mut ids = character_ids(connection, "base_slug", key, true, false)?;
    let selected = if let Some(id) = ids.first() {
        source_row(connection, id)?
    } else {
        let exact = character_ids(connection, "slug", key, false, false)?;
        let exact = if exact.is_empty() {
            character_ids(connection, "id", key, false, false)?
        } else {
            exact
        };
        let Some(id) = exact.first() else {
            return Ok(None);
        };
        let selected = source_row(connection, id)?;
        let field = if truthy(&selected["base_slug"]) {
            "base_slug"
        } else {
            "chara_id"
        };
        if let Some(value) = selected[field].as_str() {
            ids = character_ids(connection, field, value, true, false)?;
        }
        if ids.is_empty() {
            ids.push(id.clone());
        }
        selected
    };
    let mapped = ids
        .iter()
        .map(|id| project(&source_row(connection, id)?))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let Some(mut base) = group(mapped).into_iter().next() else {
        return Ok(None);
    };
    if !truthy(&base["constellation"]) {
        for field in ["chara_id", "name_en"] {
            let Some(value) = selected[field].as_str().filter(|value| !value.is_empty()) else {
                continue;
            };
            let matches = character_ids(connection, field, value, false, true)?;
            if let Some(id) = matches.first() {
                let sibling = source_row(connection, id)?;
                if truthy(&sibling["constellation"]) {
                    let index = if sibling["constellation_index"].is_null() {
                        json!(0)
                    } else {
                        sibling["constellation_index"].clone()
                    };
                    base["constellation"] =
                        json!({"index":index,"names":{"fr":sibling["constellation"]}});
                    break;
                }
            }
        }
    }
    if selected["rarity_label"] == "Héros" {
        let mut constellations = Vec::new();
        let mut seen = BTreeSet::new();
        if let Some(name) = selected["name_en"].as_str().filter(|name| !name.is_empty()) {
            for id in character_ids(connection, "name_en", name, false, true)? {
                let row = source_row(connection, &id)?;
                if seen.insert(row["constellation"].to_string()) {
                    let index = if row["constellation_index"].is_null() {
                        json!(0)
                    } else {
                        row["constellation_index"].clone()
                    };
                    constellations.push(json!({"name":row["constellation"],"index":index}));
                }
            }
        }
        base["heroConstellations"] = json!(constellations);
    }
    Ok(Some(base))
}

/// Preserve the legacy list envelope, row count and page-local grouping.
pub fn characters(connection: &Connection, input: &CharacterListRequest) -> anyhow::Result<Value> {
    if matches!(input.role.as_deref(), Some("Coach" | "Coordinator"))
        || input.position.as_deref() == Some("COACH")
    {
        return coordinators(connection, input);
    }
    let page = input.page.unwrap_or(1).max(1);
    let limit = input.limit.unwrap_or(24).clamp(1, 200);
    let translate = |value: &Option<String>, pairs: &[(&str, &str)]| {
        value.as_ref().map(|value| {
            pairs
                .iter()
                .find(|(from, _)| value == from)
                .map_or(value.as_str(), |(_, to)| *to)
                .to_owned()
        })
    };
    let mut attributes = BTreeMap::new();
    for (key, value) in [
        ("gender", &input.gender),
        ("playstyle", &input.playstyle),
        ("age_group", &input.age_group),
        ("school_year", &input.school_year),
        ("team_id", &input.team),
    ] {
        if let Some(value) = value {
            attributes.insert(key.to_owned(), vec![value.clone()]);
        }
    }
    let result = crate::catalog::query_character_catalog(
        connection,
        &crate::catalog::CharacterCatalogRequest {
            legacy_selection: true,
            query: input.q.as_deref().map(crate::query::sanitize_filter),
            element: translate(
                &input.element,
                &[
                    ("Fire", "Feu"),
                    ("Wind", "Vent"),
                    ("Forest", "Forêt"),
                    ("Mountain", "Montagne"),
                ],
            ),
            position: translate(
                &input.position,
                &[
                    ("GK", "Gardien"),
                    ("DF", "Défenseur"),
                    ("MF", "Milieu"),
                    ("FW", "Attaquant"),
                ],
            ),
            rarity: input.rarity.clone(),
            series: input.series.clone(),
            attributes,
            playable: (input.status.as_deref() == Some("jouable")).then_some(true),
            incomplete: (input.status.as_deref() != Some("all")).then_some(false),
            limit,
            offset: ((page - 1) as usize).saturating_mul(limit as usize),
            ..Default::default()
        },
    )?;
    let rows = result
        .records
        .iter()
        .filter_map(|record| record.id.as_deref())
        .map(|id| project(&source_row(connection, id)?))
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(json!({"data":group(rows),"total":result.total,"page":page,"limit":limit}))
}

// Published Zukan references from Azalee's getCoordinatorsList; these are source
// identities, not generated character hashes or synthetic native assets.
const COORDINATOR_ZUKAN: [&str; 60] = [
    "k/c/b/cb88nfolkwe",
    "k/z/p/zpndk6oxjls",
    "k/x/i/xikbkjcdmjs",
    "k/t/2/t2vvykaoccs",
    "k/n/z/nz2ghxvgpic",
    "k/q/u/quvzfkeq5ns",
    "k/o/3/o32tnwlthge",
    "k/k/h/kh5u-b7dslk",
    "k/v/v/vvi1tkdn_4m",
    "k/h/f/hf3tipefyhk",
    "k/k/5/k5er_or9jem",
    "k/o/y/oyxxlfats7e",
    "k/6/x/6xd84b32hzk",
    "k/b/x/bxrne-6vwfk",
    "k/e/u/euxp3_h_s_c",
    "k/o/z/ozsfcxwjxve",
    "k/u/g/ugqtm_smug0",
    "k/d/d/dddirygeelc",
    "k/h/c/hcb0r88rb-s",
    "k/k/f/kfck9hlg5js",
    "k/y/a/yaeyhvxpmwc",
    "k/s/y/sy5iwvawaj0",
    "k/u/t/ut_eshg5f8e",
    "k/n/l/nl_glun8epm",
    "k/c/m/cmtsbm0og6u",
    "k/t/k/tkcz2zs0rj8",
    "k/h/j/hjc80umli2k",
    "k/o/m/om1n5jmhidm",
    "k/7/8/78eqog2k9du",
    "k/y/5/y5zbdtcoxo8",
    "k/9/i/9ixx-wa6jqu",
    "k/8/w/8wocttgsuu0",
    "k/n/y/ny_j-sgwdnc",
    "k/p/5/p54_qlu6ghc",
    "k/e/-/e-qruphieye",
    "k/v/w/vwbkdwhyzbs",
    "k/b/8/b8ksybiqu-e",
    "k/e/8/e8o-flnjyhm",
    "k/1/u/1u_foarz1sk",
    "k/v/7/v7cq7herayu",
    "k/v/v/vvrzhm1aiie",
    "k/k/t/kttlw44rtb8",
    "k/s/n/snbzvhuzhmm",
    "k/m/i/mi4sg8b7ug8",
    "k/u/g/ugcf748fkgm",
    "k/9/g/9gjnrd9b51u",
    "k/o/p/op_woljxra8",
    "k/f/u/futkwhaljtk",
    "k/c/f/cft3awvkb0e",
    "k/g/-/g-obvenkgrc",
    "k/b/w/bwxwy2_pw90",
    "k/8/w/8w28mu4bix0",
    "k/c/f/cfvj1znj93e",
    "k/t/3/t3koymrzqes",
    "k/v/w/vwj02v5fvcs",
    "k/e/-/e-svbqfl4xe",
    "k/-/r/-rxgi3qtnr0",
    "k/p/5/p5ablimxgic",
    "k/7/t/7t_zufp1hd0",
    "k/k/7/k7o456ppquc",
];

/// Historical coordinator/player-card projection from the native staff source.
pub fn coordinators(
    connection: &Connection,
    input: &CharacterListRequest,
) -> anyhow::Result<Value> {
    let page = input.page.unwrap_or(1).max(1);
    let limit = input.limit.unwrap_or(24).clamp(1, 200);
    let q = format!(
        "%{}%",
        crate::query::sanitize_filter(input.q.as_deref().unwrap_or_default())
    );
    let element = match input.element.as_deref() {
        Some("Wind") => Some("風"),
        Some("Wood" | "Forest") => Some("林"),
        Some("Fire") => Some("火"),
        Some("Earth" | "Mountain") => Some("山"),
        Some("Void") => Some("無"),
        _ => None,
    };
    let columns = [
        "id",
        "name_localised",
        "name_romaji",
        "name_kanji",
        "gender",
        "role",
        "game",
        "element",
        "passive_no",
        "buff",
        "stat",
        "requirements",
    ];
    let filter = " FROM inagle_coordinators WHERE (?1='%%' OR name_localised LIKE ?1 OR name_romaji LIKE ?1)
        AND (?2 IS NULL OR (?2='Coordinator' AND role='Coordinator') OR (?2='Coach' AND role IN ('Coach','Manager')) OR ?2 NOT IN ('Coach','Coordinator'))
        AND (?3 IS NULL OR element=?3)";
    let total: usize = connection.query_row(
        &format!("SELECT count(*){filter}"),
        rusqlite::params![q, input.role, element],
        |row| row.get(0),
    )?;
    let mut statement = connection.prepare(&format!(
        "SELECT {}{filter} ORDER BY name_localised LIMIT ?4 OFFSET ?5",
        columns.join(",")
    ))?;
    let records = statement
        .query_map(
            rusqlite::params![
                q,
                input.role,
                element,
                limit,
                ((page - 1) as usize).saturating_mul(limit as usize)
            ],
            |row| {
                let mut fields = Map::new();
                for (index, column) in columns.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(value) => json!(value),
                        ValueRef::Text(bytes) => {
                            let value = String::from_utf8_lossy(bytes);
                            if matches!(value.as_ref(), "\\N" | "\\\\N") {
                                Value::Null
                            } else {
                                json!(value)
                            }
                        }
                        _ => Value::Null,
                    };
                    fields.insert((*column).into(), value);
                }
                Ok(Value::Object(fields))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let data = records.into_iter().map(|row| {
        let id = row["id"].as_str().map(str::to_owned).unwrap_or_else(||row["id"].to_string());
        let reference = id.parse::<usize>().ok().and_then(|id|id.checked_sub(1)).and_then(|id|COORDINATOR_ZUKAN.get(id));
        let image = reference.map(|hash|format!("https://dxi4wb638ujep.cloudfront.net/1/{hash}.png"));
        let element = match row["element"].as_str() {Some("風")=>"Wind",Some("林")=>"Forest",Some("火")=>"Fire",Some("山")=>"Mountain",_=>"Void"};
        let mut variant = json!({"charaParamId":format!("coord_{id}"),"position":"COACH","positionRaw":0,"element":element,
            "rarity":value_or(&row["role"],json!("Coach")),"rarityCode":1,"stats":{"lv99":{}},"skills":[],"image":image});
        if let Some(reference)=reference {variant["zukanHash"]=json!(reference);}
        let string = |key:&str|row[key].as_str().map(str::to_owned).unwrap_or_else(||row[key].to_string());
        let mut result = json!({"charaId":format!("coord_{id}"),"internalCode":format!("COORD_{id}"),
            "names":{"fr":row["name_localised"],"en":row["name_localised"],"ja":row["name_kanji"]},
            "gender":if row["gender"]=="女" {1}else{0},"variants":[variant],"bestRarity":value_or(&row["role"],json!("Coach")),
            "bestRarityCode":1,"isBasara":false,"image":image,
            "descriptions":{"fr":format!("Rôle: {}\nEffet: {} +{}\nCondition: {}",string("role"),string("stat"),string("buff"),string("requirements"))},
            "sheetData":{"passive_no":row["passive_no"],"buff":row["buff"],"stat":row["stat"],"requirements":row["requirements"]},
            "wikiSections":[],"slug":format!("coord-{id}"),"series":value_or(&row["game"],json!("Inazuma Eleven")),
            "teamId":null,"teamName":"Coach/Manager"});
        if let Some(reference)=reference {result["zukanHash"]=json!(reference);}
        result
    }).collect::<Vec<_>>();
    Ok(json!({"data":data,"total":total,"page":page,"limit":limit}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn character_detail_resolves_variants_and_inherits_hero_constellations() {
        let connection = Connection::open_in_memory().unwrap();
        let columns = COLUMNS
            .iter()
            .map(|name| format!("{name} TEXT"))
            .collect::<Vec<_>>()
            .join(",");
        connection
            .execute_batch(&format!("CREATE TABLE inagle_characters ({columns});"))
            .unwrap();
        for (id, slug, base, family, rarity, order, constellation) in [
            (
                "0x0",
                "byron-null",
                "missing1",
                "family0",
                "Normal",
                "0",
                Some("\\N"),
            ),
            (
                "0x00",
                "byron-null-double",
                "missing2",
                "family00",
                "Normal",
                "0",
                Some("\\\\N"),
            ),
            (
                "0x1",
                "byron-normal",
                "byron",
                "family1",
                "Normal",
                "2",
                Some("Main"),
            ),
            (
                "0x2",
                "byron-basara",
                "byron",
                "family1",
                "BASARA",
                "10",
                None,
            ),
            ("0x3", "byron-hero", "hero", "family2", "Héros", "3", None),
            (
                "0x4",
                "byron-other",
                "other",
                "family3",
                "Héros",
                "4",
                Some("Other"),
            ),
        ] {
            connection.execute("INSERT INTO inagle_characters(id,slug,base_slug,chara_id,rarity_label,zukan_order,constellation,name_en,internal_code,skills) VALUES (?1,?2,?3,?4,?5,?6,?7,'Byron','c01001900','[]')", rusqlite::params![id,slug,base,family,rarity,order,constellation]).unwrap();
        }
        for identity in ["byron", "byron-basara", "0x2"] {
            let card = character(&connection, identity).unwrap().unwrap();
            assert_eq!(card["variants"].as_array().unwrap().len(), 2);
            assert_eq!(card["variants"][0]["charaParamId"], "0x1");
        }
        let hero = character(&connection, "byron-hero").unwrap().unwrap();
        assert_eq!(hero["constellation"]["names"]["fr"], "Main");
        assert_eq!(
            hero["heroConstellations"],
            json!([{"name":"Main","index":0},{"name":"Other","index":0}])
        );
        assert!(character(&connection, "unknown").unwrap().is_none());
        assert!(character(&connection, "' OR 1=1 --").unwrap().is_none());
        assert!(character(&connection, "\n").unwrap().is_none());
    }

    #[test]
    #[ignore = "requires historical character detail fixtures and the same licensed mirror"]
    fn character_detail_matches_captured_historical_json() {
        fn difference(actual: &Value, expected: &Value, path: &str) -> Option<String> {
            match (actual, expected) {
                (Value::Object(left), Value::Object(right)) => {
                    for key in left.keys().chain(right.keys()) {
                        if let Some(diff) =
                            difference(&actual[key], &expected[key], &format!("{path}.{key}"))
                        {
                            return Some(diff);
                        }
                    }
                    (left.len() != right.len())
                        .then(|| format!("{path}: optional field presence differs"))
                }
                (Value::Array(left), Value::Array(right)) if left.len() == right.len() => left
                    .iter()
                    .zip(right)
                    .enumerate()
                    .find_map(|(index, (a, b))| difference(a, b, &format!("{path}[{index}]"))),
                _ => (actual != expected).then(|| format!("{path}: {actual} != {expected}")),
            }
        }
        let path = std::env::var("NIE_CHARACTER_DETAIL_PARITY_FIXTURE").expect("fixture path");
        let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert!(!cases.is_empty());
        let connection =
            Connection::open_with_flags(mirror, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        for case in cases {
            let input = case["input"].as_str().unwrap();
            let actual = character(&connection, input)
                .unwrap()
                .unwrap_or(Value::Null);
            assert!(
                actual == case["expected"],
                "Historical character detail differs for {input}: {}",
                difference(&actual, &case["expected"], "$").unwrap_or_default()
            );
        }
    }

    #[test]
    fn player_selection_preserves_legacy_primary_exclusions_total_and_pagination() {
        let connection = Connection::open_in_memory().unwrap();
        let columns = COLUMNS
            .iter()
            .copied()
            .chain(["model_id", "is_primary", "rarity"])
            .map(|name| format!("{name} TEXT"))
            .collect::<Vec<_>>()
            .join(",");
        connection
            .execute_batch(&format!("CREATE TABLE inagle_characters ({columns});"))
            .unwrap();
        for (id, code, order, primary, rarity) in [
            ("0x1", "c1", "2", "t", "Normal"),
            ("0x2", "c2", "10", "t", "Normal"),
            ("0x3", "c3_5000", "1", "t", "Normal"),
            ("0x4", "c4", "3", "f", "BASARA"),
        ] {
            connection.execute("INSERT INTO inagle_characters
                (id,chara_id,internal_code,name_fr,name_en,base_slug,zukan_order,is_primary,rarity_label,gender,element,position,skills)
                VALUES (?1,'h1',?2,'Byron','Byron','byron',?3,?4,?5,'M','Forêt','Milieu','[]')",
                rusqlite::params![id,code,order,primary,rarity]).unwrap();
        }
        let page = characters(
            &connection,
            &CharacterListRequest {
                page: Some(1),
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page["total"], 2);
        assert_eq!(page["data"][0]["variants"][0]["charaParamId"], "0x2");
        assert_eq!(page["data"].as_array().unwrap().len(), 1);
        let basara = characters(
            &connection,
            &CharacterListRequest {
                rarity: Some("BASARA".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(basara["total"], 1);
        assert_eq!(basara["data"][0]["isBasara"], true);
        let absent = characters(
            &connection,
            &CharacterListRequest {
                q: Some("absent".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(absent["total"], 0);
        assert_eq!(absent["data"], json!([]));
    }

    #[test]
    fn projection_preserves_legacy_shape_numeric_strings_and_page_local_variants() {
        let row = json!({"id":"0x1","chara_id":"h1","internal_code":"c1","name_fr":"One",
            "name_en":"One","base_slug":"one","rarity_label":"Normal","position":"Milieu",
            "element":"Vent","gender":"M","stat_frappe":"12","stat_lv1_frappe":"1",
            "skills":[{"skillId":"0x0000000A","learnLevel":-1666310536i64}],"zukan_order":2,
            "image_url":null,"is_controllable":"f"});
        let projected = project(&row).unwrap();
        assert_eq!(projected["variants"][0]["stats"]["lv99"]["kick"], "12");
        assert_eq!(projected["variants"][0]["stats"]["lv1"]["kick"], "1");
        assert!(projected["variants"][0]["stats"].get("lv30").is_none());
        assert!(projected.get("uniformNumber").is_none());
        assert_eq!(projected["isControllable"], "f");
        assert_eq!(projected["variants"][0]["skills"][0]["learnLevel"], 10);
        assert_eq!(
            group(vec![projected.clone(), projected])[0]["variants"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    #[ignore = "requires ignored legacy responses captured from the same licensed mirror"]
    fn real_mirror_matches_captured_legacy_contract() {
        let fixture = std::env::var("NIE_LEGACY_PARITY_FIXTURE").expect("fixture path");
        let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror path");
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
        assert!(!cases.is_empty());
        let connection =
            Connection::open_with_flags(mirror, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        for case in cases {
            let input = serde_json::from_value(case["input"].clone()).unwrap();
            let actual = characters(&connection, &input).unwrap();
            fn differences(
                actual: &Value,
                expected: &Value,
                path: String,
                output: &mut Vec<String>,
            ) {
                if actual == expected {
                    return;
                }
                match (actual, expected) {
                    (Value::Object(actual), Value::Object(expected)) => {
                        let keys: BTreeSet<_> = actual.keys().chain(expected.keys()).collect();
                        for key in keys {
                            match (actual.get(key), expected.get(key)) {
                                (Some(actual), Some(expected)) => {
                                    differences(actual, expected, format!("{path}.{key}"), output)
                                }
                                _ => output.push(format!("{path}.{key} (presence)")),
                            }
                        }
                    }
                    (Value::Array(actual), Value::Array(expected))
                        if actual.len() == expected.len() =>
                    {
                        for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
                            differences(actual, expected, format!("{path}[{index}]"), output);
                        }
                    }
                    _ => output.push(path),
                }
            }
            let mut paths = Vec::new();
            differences(&actual, &case["expected"], "response".into(), &mut paths);
            assert!(
                paths.is_empty(),
                "request {} differs at {:?}",
                case["input"],
                paths
            );
        }
    }
}
