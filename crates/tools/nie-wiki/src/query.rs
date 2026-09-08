//! Requêtes sur les tables `inagle_*` du miroir SQLite.
//!
//! Reproduit fidèlement les comportements du TS :
//! - fusion `data` + `sheet_data`
//! - résolution element/category depuis les colonnes texte FR
//! - IDs non-strippés (sanitizeFilter ne retire pas `_`)
//! - vues `*_clean` émulées par `GROUP BY name_fr`
//! - lookup d'auras dans keshins/souls/miximax avec prefixe et hex normalisé

use std::{path::Path, process::Command, time::Instant};

use rusqlite::Connection;
use serde_json::Value;

use crate::{
    mirror::{merge_data_sheet, query_one, query_rows},
    model::{
        AuditReport, AuraSummary, CharaCompareSlot, CharaProfile, CharaSummary, CharacterAudit,
        CompareResult, CompareSkillSlot, DialogueMatch, DialogueText, GitStatus, ItemProfile,
        ProcessMemoryStatus, ProcessStatus, RandomTeam, RandomTeamCoord, RandomTeamPlayer,
        RedisStatus, SearchResult, SkillAudit, SkillProfile, SkillSlot, SqliteStatus, StatBlock,
        StatusReport, SystemStatus, TeamBuildEntry, TeamProfile,
    },
};

// ─── Sanitize ────────────────────────────────────────────────────────────────

/// Sanitize identique à wiki-service.ts `sanitizeFilter` :
/// retire `%`, `,`, `(`, `)`, `.`, `*`, `\` — mais PAS `_` (IDs d'auras).
pub fn sanitize_filter(input: &str) -> String {
    input
        .chars()
        .filter(|&c| !matches!(c, '%' | ',' | '(' | ')' | '.' | '*' | '\\'))
        .collect()
}

// ─── Personnage ───────────────────────────────────────────────────────────────

/// Recherche des personnages par ID ou nom (FR/EN/JA).
///
/// Retourne tous les matches (plusieurs variantes possible pour un même charaId).
pub fn search_characters(conn: &Connection, query: &str) -> anyhow::Result<Vec<CharaSummary>> {
    let q = sanitize_filter(query);
    let like_pat = format!("%{}%", q);

    query_rows(
        conn,
        "SELECT id, chara_id, name_fr, name_en, name_ja, element, position,
                rarity_label, internal_code, slug, base_slug
         FROM inagle_characters
         WHERE id = ?1
            OR chara_id = ?1
            OR internal_code = ?1
            OR slug = ?1
            OR base_slug = ?1
            OR name_fr LIKE ?2
            OR name_en LIKE ?2
            OR name_ja LIKE ?2
         ORDER BY zukan_order ASC NULLS LAST, id ASC
         LIMIT 50",
        &[&q as &dyn rusqlite::ToSql, &like_pat],
        |row| {
            Ok(CharaSummary {
                id: row.get(0)?,
                chara_id: row.get(1)?,
                name_fr: row.get(2)?,
                name_en: row.get(3)?,
                name_ja: row.get(4)?,
                element: row.get(5)?,
                position: row.get(6)?,
                rarity_label: row.get(7)?,
                internal_code: row.get(8)?,
                slug: row.get(9)?,
                base_slug: row.get(10)?,
            })
        },
    )
}

/// Charge le profil complet d'un personnage par son `id` (charaParamId).
pub fn get_character(conn: &Connection, id: &str) -> anyhow::Result<Option<CharaProfile>> {
    let row = query_one(
        conn,
        "SELECT id, chara_id, name_fr, name_en, name_ja, element, position,
                rarity_label, internal_code, slug, base_slug,
                description_fr, description_en, gender, team_id, series, zukan_hash,
                data, sheet_data, skills
         FROM inagle_characters WHERE id = ?1",
        &[&id as &dyn rusqlite::ToSql],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, Option<String>>(18)?,
                row.get::<_, Option<String>>(19)?,
            ))
        },
    )?;

    let Some((
        db_id,
        chara_id,
        name_fr,
        name_en,
        name_ja,
        element,
        position,
        rarity_label,
        internal_code,
        slug,
        base_slug,
        description_fr,
        description_en,
        gender,
        team_id,
        series,
        zukan_hash,
        data,
        sheet_data,
        _skills_col,
    )) = row
    else {
        return Ok(None);
    };

    let source_data = data
        .as_deref()
        .and_then(|json| serde_json::from_str::<Value>(json).ok())
        .unwrap_or_else(|| Value::Object(Default::default()));
    let merged = merge_data_sheet(data.as_deref(), sheet_data.as_deref());

    // Résoudre le nom de l'équipe depuis data.teams[0].names.fr
    let team_name = merged
        .get("teams")
        .and_then(|t| t.as_array())
        .and_then(|arr| arr.first())
        .and_then(|t| {
            t.get("names")
                .and_then(|n| n.get("fr").and_then(Value::as_str))
                .or_else(|| t.get("name_FR").and_then(Value::as_str))
                .or_else(|| t.get("name_EN").and_then(Value::as_str))
                .or_else(|| t.get("name").and_then(Value::as_str))
        })
        .map(str::to_string)
        .or_else(|| team_id.clone());

    // Variant curves and movesets come from the game data. `sheet_data` enriches
    // presentation fields but must not replace these canonical gameplay arrays.
    let gameplay = if source_data.get("stats").is_some() || source_data.get("skills").is_some() {
        &source_data
    } else {
        &merged
    };
    let (stats_lv1, stats_lv30, stats_lv50, stats_lv99) = extract_stats_from_merged(gameplay);
    let skills = extract_skills_from_merged(gameplay);

    // Auras du personnage (keshin/soul/miximax)
    let auras = get_auras_for_character(conn, &chara_id, &db_id, &merged)?;

    Ok(Some(CharaProfile {
        id: db_id,
        chara_id,
        name_fr,
        name_en,
        name_ja,
        element,
        position,
        rarity_label,
        internal_code,
        slug,
        base_slug,
        description_fr,
        description_en,
        gender,
        team_name,
        series,
        zukan_hash,
        stats_lv1,
        stats_lv30,
        stats_lv50,
        stats_lv99,
        skills,
        auras,
        merged,
    }))
}

/// Extrait les blocs de stats lv1/lv50/lv99 depuis le JSON fusionné.
fn extract_stats_from_merged(
    merged: &Value,
) -> (
    Option<StatBlock>,
    Option<StatBlock>,
    Option<StatBlock>,
    Option<StatBlock>,
) {
    let stats_obj = merged.get("stats");
    let lv1 = stats_obj
        .and_then(|s| s.get("lv1"))
        .and_then(StatBlock::from_json);
    let lv30 = stats_obj
        .and_then(|s| s.get("lv30"))
        .and_then(StatBlock::from_json);
    let lv50 = stats_obj
        .and_then(|s| s.get("lv50"))
        .and_then(StatBlock::from_json);
    let lv99 = stats_obj
        .and_then(|s| s.get("lv99"))
        .and_then(StatBlock::from_json);
    (lv1, lv30, lv50, lv99)
}

/// Extrait les slots de skills depuis le JSON fusionné (data.skills).
fn extract_skills_from_merged(merged: &Value) -> Vec<SkillSlot> {
    merged
        .get("skills")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| {
                    let skill_id = entry.get("skillId")?.as_str()?.to_string();
                    let learn_level = entry
                        .get("learnLevel")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32;
                    Some(SkillSlot {
                        skill_id,
                        learn_level,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Calcule les stats interpolées à un niveau donné.
///
/// Identique à `getInterpolatedStats` dans azalee.ts, qui implémente
/// la même logique segmentée que nie-core::stats::calculate_single_stat.
pub fn interpolate_stats(lv1: StatBlock, lv50: StatBlock, lv99: StatBlock, level: u8) -> StatBlock {
    // La DB n'expose pas de lv30 séparé dans stats.lv30 (pas présent pour tous les persos).
    // On utilise la courbe simplifiée à 2 segments : lv1→lv50→lv99.
    // Si on avait lv30 on ferait 3 segments, mais le TS lui-même fallback sur 2 segments
    // quand hasCompleteData = false.
    if level == 0 || level == 1 {
        return lv1;
    }
    if level >= 99 {
        return lv99;
    }
    // Segment 1 : lv1 → lv50
    if level <= 50 {
        let t = f64::from(level - 1) / 49.0;
        return lv1.lerp(lv50, t);
    }
    // Segment 2 : lv50 → lv99
    let t = f64::from(level - 50) / 49.0;
    lv50.lerp(lv99, t)
}

/// Reproduce Azalee's variant interpolation, including its partial-curve fallback.
pub fn interpolate_stat_curve(
    lv1: Option<StatBlock>,
    lv30: Option<StatBlock>,
    lv50: Option<StatBlock>,
    lv99: Option<StatBlock>,
    level: u8,
) -> StatBlock {
    let end = lv99.unwrap_or_default();
    if level >= 99 {
        return end;
    }
    if level <= 1
        && let Some(start) = lv1
    {
        return start;
    }

    let (Some(start), Some(mid30), Some(mid50)) = (lv1, lv30, lv50) else {
        let start = lv1.unwrap_or(end);
        let t = f64::from(level.saturating_sub(1)) / 98.0;
        return start.lerp(end, t);
    };

    if level <= 30 {
        return start.lerp(mid30, f64::from(level.saturating_sub(1)) / 29.0);
    }
    if level <= 50 {
        return mid30.lerp(mid50, f64::from(level - 30) / 20.0);
    }
    mid50.lerp(end, f64::from(level - 50) / 49.0)
}

/// Recherche les auras (keshins/souls/miximax) associées à un personnage.
///
/// Reproduit fidèlement `getAurasForChara` de azalee.ts :
/// - lit `data.auras[].skillId` (hex)
/// - pour chaque hex : cherche dans keshin_/soul_/miximax_ avec prefixe normalisé
fn get_auras_for_character(
    conn: &Connection,
    _chara_id: &str,
    _param_id: &str,
    merged: &Value,
) -> anyhow::Result<Vec<AuraSummary>> {
    // Collecte les hex IDs d'aura depuis data.auras
    let mut hex_ids: Vec<String> = merged
        .get("auras")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| {
                    entry
                        .get("skillId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_lowercase())
                })
                .collect()
        })
        .unwrap_or_default();

    // Dédoublonnage
    hex_ids.sort();
    hex_ids.dedup();

    let tables = [
        ("inagle_keshins", "keshin_", "keshin"),
        ("inagle_souls", "soul_", "soul"),
        ("inagle_miximax", "miximax_", "miximax"),
        ("inagle_auras", "aura_", "aura"),
    ];

    let mut results = Vec::new();

    for hex_id in &hex_ids {
        let clean_hex = hex_id.trim_start_matches("0x").to_uppercase();
        let formatted = format!("0x{clean_hex}");

        let mut found = false;
        for (table, prefix, aura_type) in &tables {
            if found {
                break;
            }
            let prefixed_id = format!("{}{}", prefix, formatted);
            // Essaie prefixed_id, formatted_id, et hex_id brut (identique au TS)
            let possible: [&str; 3] = [prefixed_id.as_str(), formatted.as_str(), hex_id.as_str()];

            for candidate in &possible {
                let maybe = query_one(
                    conn,
                    &format!(
                        "SELECT id, name_fr, name_en, name_ja FROM {} WHERE id = ?1 LIMIT 1",
                        table
                    ),
                    &[candidate as &dyn rusqlite::ToSql],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )?;

                if let Some((aid, a_name_fr, a_name_en, a_name_ja)) = maybe {
                    let name = a_name_fr
                        .or(a_name_en)
                        .or(a_name_ja)
                        .unwrap_or_else(|| "Inconnu".to_string());
                    results.push(AuraSummary {
                        id: aid,
                        name,
                        aura_type: aura_type.to_string(),
                    });
                    found = true;
                    break;
                }
            }
        }
    }

    Ok(results)
}

// ─── Skill ───────────────────────────────────────────────────────────────────

/// Recherche des skills par ID ou nom.
pub fn search_skills(conn: &Connection, query: &str) -> anyhow::Result<Vec<SkillProfile>> {
    let q = sanitize_filter(query);
    // Quand le CLI demande seulement des filtres (catégorie/élément), une
    // recherche vide ne doit pas tronquer le corpus aux 20 premières lignes :
    // les filtres sont appliqués après cette fonction.
    if q.is_empty() {
        return query_rows(
            conn,
            "SELECT id, name_fr, name_en, name_ja,
                    category, element,
                    power_max, power_min, tp_cost,
                    description_fr, description_en,
                    internal_code, is_hyper,
                    data, sheet_data
             FROM inagle_skills
             ORDER BY name_fr ASC",
            &[],
            skill_row_map,
        );
    }
    let like_pat = format!("%{}%", q);

    query_rows(
        conn,
        "SELECT id, name_fr, name_en, name_ja,
                category, element,
                power_max, power_min, tp_cost,
                description_fr, description_en,
                internal_code, is_hyper,
                data, sheet_data
         FROM inagle_skills
         WHERE id = ?1
            OR internal_code = ?1
            OR name_fr LIKE ?2
            OR name_en LIKE ?2
            OR name_ja LIKE ?2
         ORDER BY name_fr ASC
         LIMIT 20",
        &[&q as &dyn rusqlite::ToSql, &like_pat],
        skill_row_map,
    )
}

/// Charge un skill par son ID exact.
pub fn get_skill(conn: &Connection, id: &str) -> anyhow::Result<Option<SkillProfile>> {
    let q = sanitize_filter(id);
    query_one(
        conn,
        "SELECT id, name_fr, name_en, name_ja,
                category, element,
                power_max, power_min, tp_cost,
                description_fr, description_en,
                internal_code, is_hyper,
                data, sheet_data
         FROM inagle_skills
         WHERE id = ?1 OR internal_code = ?1",
        &[&q as &dyn rusqlite::ToSql],
        skill_row_map,
    )
}

fn skill_row_map(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillProfile> {
    let id: String = row.get(0)?;
    let name_fr: Option<String> = row.get(1)?;
    let name_en: Option<String> = row.get(2)?;
    let name_ja: Option<String> = row.get(3)?;
    // category et element : colonnes texte FR (category_id/element_id sont NULL)
    let category_fr: Option<String> = row.get(4)?;
    let element_fr: Option<String> = row.get(5)?;
    let power_max: Option<i64> = row.get(6)?;
    let power_min: Option<i64> = row.get(7)?;
    let tp_cost: Option<i64> = row.get(8)?;
    let description_fr: Option<String> = row.get(9)?;
    let description_en: Option<String> = row.get(10)?;
    let internal_code: Option<String> = row.get(11)?;
    let is_hyper: Option<i64> = row.get(12)?;
    let data: Option<String> = row.get(13)?;
    let sheet_data: Option<String> = row.get(14)?;

    let merged = merge_data_sheet(data.as_deref(), sheet_data.as_deref());

    // Résolution element et category : priorité colonne DB → merged JSON
    let element = element_fr
        .as_deref()
        .or_else(|| merged.get("element").and_then(|v| v.as_str()))
        .map(crate::model::element_fr_to_en);

    let category = category_fr
        .as_deref()
        .or_else(|| {
            merged
                .get("categoryName")
                .and_then(|cn| cn.get("fr").and_then(|v| v.as_str()))
        })
        .or_else(|| merged.get("category").and_then(|v| v.as_str()))
        .map(crate::model::category_fr_to_en);

    // description fallbacks depuis merged
    let desc_fr = description_fr.or_else(|| {
        merged
            .get("desc_FR")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    });
    let desc_en = description_en.or_else(|| {
        merged
            .get("desc_EN")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    });

    Ok(SkillProfile {
        id,
        name_fr,
        name_en,
        name_ja,
        category,
        element,
        power_max,
        power_min,
        tp_cost,
        description_fr: desc_fr,
        description_en: desc_en,
        internal_code,
        is_hyper: is_hyper.unwrap_or(0) != 0,
        merged,
    })
}

/// Resolve main, passive and aura skills using the exact legacy precedence and result shapes.
pub fn lookup_skill_legacy(
    data_root: &std::path::Path,
    query: &str,
) -> anyhow::Result<serde_json::Value> {
    let load = |name: &str| -> anyhow::Result<Vec<Value>> {
        let path = data_root.join("all-gamedata").join(name);
        let bytes = std::fs::read(&path)
            .map_err(|e| anyhow::anyhow!("skill corpus {} not found: {e}", path.display()))?;
        serde_json::from_slice(&bytes)
            .map_err(|e| anyhow::anyhow!("invalid skill corpus {}: {e}", path.display()))
    };
    let main = load("skills.json")?;
    let passives = load("passives.json")?;
    let auras = load("auras.json")?;
    Ok(lookup_skill_values(&main, &passives, &auras, query))
}

fn lookup_skill_values(main: &[Value], passives: &[Value], auras: &[Value], query: &str) -> Value {
    let exact = |values: &[Value], fields: &[&str]| {
        values
            .iter()
            .find(|value| {
                fields
                    .iter()
                    .any(|field| value.get(field).and_then(Value::as_str) == Some(query))
            })
            .cloned()
    };
    if let Some(value) = exact(main, &["skillIDStr", "skillID"])
        .or_else(|| exact(passives, &["passiveId", "passiveIdStr"]))
        .or_else(|| exact(auras, &["auraId", "auraIdStr"]))
    {
        return value;
    }

    let query = query.to_lowercase();
    let mut matches = main
        .iter()
        .filter(|skill| {
            ["name_EN", "name_JA", "name_FR"].into_iter().any(|field| {
                skill
                    .get(field)
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.to_lowercase().contains(&query))
            })
        })
        .take(5)
        .map(|skill| {
            let mut skill = skill.clone();
            skill["skillType"] = Value::String("main".to_string());
            skill
        })
        .collect::<Vec<_>>();
    matches.extend(
        auras
            .iter()
            .filter(|aura| {
                ["displayName", "name_FR", "desc_FR"]
                    .into_iter()
                    .any(|field| {
                        aura.get(field)
                            .and_then(Value::as_str)
                            .is_some_and(|name| name.to_lowercase().contains(&query))
                    })
            })
            .take(5)
            .map(|aura| {
                let mut aura = aura.clone();
                aura["skillType"] = Value::String("aura".to_string());
                if aura.get("displayName").is_none() {
                    aura["displayName"] = aura
                        .get("name_FR")
                        .or_else(|| aura.get("name_EN"))
                        .cloned()
                        .unwrap_or(Value::Null);
                }
                aura
            }),
    );

    match matches.as_slice() {
        [] => Value::Array(Vec::new()),
        [skill] => skill.clone(),
        _ => Value::Array(matches),
    }
}

// ─── Item ────────────────────────────────────────────────────────────────────

/// Recherche des items par ID ou nom.
pub fn search_items(conn: &Connection, query: &str) -> anyhow::Result<Vec<ItemProfile>> {
    let q = sanitize_filter(query);
    let like_pat = format!("%{}%", q);

    query_rows(
        conn,
        "SELECT id, name_fr, name_en, name_ja,
                category, rarity, description_fr,
                internal_code, price, shops,
                data, sheet_data
         FROM inagle_items
         WHERE id = ?1
            OR internal_code = ?1
            OR name_fr LIKE ?2
            OR name_en LIKE ?2
            OR name_ja LIKE ?2
         ORDER BY name_fr ASC
         LIMIT 20",
        &[&q as &dyn rusqlite::ToSql, &like_pat],
        item_row_map,
    )
}

/// Charge un item par son ID exact.
pub fn get_item(conn: &Connection, id: &str) -> anyhow::Result<Option<ItemProfile>> {
    let q = sanitize_filter(id);
    query_one(
        conn,
        "SELECT id, name_fr, name_en, name_ja,
                category, rarity, description_fr,
                internal_code, price, shops,
                data, sheet_data
         FROM inagle_items WHERE id = ?1 OR internal_code = ?1",
        &[&q as &dyn rusqlite::ToSql],
        item_row_map,
    )
}

fn item_row_map(row: &rusqlite::Row<'_>) -> rusqlite::Result<ItemProfile> {
    let id: String = row.get(0)?;
    let name_fr: Option<String> = row.get(1)?;
    let name_en: Option<String> = row.get(2)?;
    let name_ja: Option<String> = row.get(3)?;
    let category: Option<String> = row.get(4)?;
    let rarity: Option<i64> = row.get(5)?;
    let description_fr: Option<String> = row.get(6)?;
    let internal_code: Option<String> = row.get(7)?;
    let price_col: Option<i64> = row.get(8)?;
    let shops_col: Option<String> = row.get(9)?;
    let data: Option<String> = row.get(10)?;
    let sheet_data: Option<String> = row.get(11)?;

    let merged = merge_data_sheet(data.as_deref(), sheet_data.as_deref());

    // Prix : depuis sheet_data.price (la colonne price contient des sort IDs, pas de vrais prix)
    let price = merged
        .get("price")
        .and_then(|v| v.as_i64())
        .or(price_col.filter(|_| false)); // on ignore la colonne price brute comme le TS

    // Shops : colonne shops (JSON array) ou sheet_data.shops
    let shops = parse_shops(shops_col.as_deref(), &merged);

    // description fallback depuis merged
    let desc_fr = description_fr.or_else(|| {
        merged
            .get("descriptions")
            .and_then(|d| d.get("fr").and_then(|v| v.as_str()))
            .map(str::to_string)
    });

    Ok(ItemProfile {
        id,
        name_fr,
        name_en,
        name_ja,
        category,
        rarity,
        description_fr: desc_fr,
        internal_code,
        price,
        shops,
        merged,
    })
}

/// Resolve an item exactly as the legacy command does from the enriched mirror payload.
///
/// An exact `itemId` returns the complete object. A name search returns that object when unique,
/// the legacy `{id,name}` selection list when ambiguous, or an empty array when absent.
pub fn lookup_item_legacy(conn: &Connection, query: &str) -> anyhow::Result<serde_json::Value> {
    let exact = query_one(
        conn,
        "SELECT COALESCE(data, sheet_data) FROM inagle_items WHERE id = ?1 LIMIT 1",
        &[&query as &dyn rusqlite::ToSql],
        |row| row.get::<_, String>(0),
    )?;
    if let Some(serialized) = exact {
        return serde_json::from_str(&serialized)
            .map_err(|e| anyhow::anyhow!("invalid enriched item payload: {e}"));
    }

    let pattern = format!("%{}%", query.to_lowercase());
    let matches = query_rows(
        conn,
        "SELECT COALESCE(data, sheet_data) FROM inagle_items
         WHERE LOWER(name_en) LIKE ?1 OR LOWER(name_ja) LIKE ?1 OR LOWER(name_fr) LIKE ?1
         LIMIT 15",
        &[&pattern as &dyn rusqlite::ToSql],
        |row| row.get::<_, String>(0),
    )?
    .into_iter()
    .map(|serialized| {
        serde_json::from_str::<Value>(&serialized)
            .map_err(|e| anyhow::anyhow!("invalid enriched item payload: {e}"))
    })
    .collect::<anyhow::Result<Vec<_>>>()?;

    match matches.as_slice() {
        [] => Ok(Value::Array(Vec::new())),
        [item] => Ok(item.clone()),
        items => Ok(Value::Array(
            items
                .iter()
                .map(|item| {
                    let id = item.get("itemId").cloned().unwrap_or(Value::Null);
                    let name = item
                        .pointer("/names/fr")
                        .or_else(|| item.get("name"))
                        .cloned()
                        .unwrap_or(Value::Null);
                    serde_json::json!({ "id": id, "name": name })
                })
                .collect(),
        )),
    }
}

fn parse_shops(shops_col: Option<&str>, merged: &Value) -> Vec<String> {
    // Tente la colonne shops (JSON) puis merged.shops.fr
    if let Some(s) = shops_col
        && let Ok(val) = serde_json::from_str::<Value>(s)
    {
        if let Some(arr) = val.as_array() {
            let names: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();
            if !names.is_empty() {
                return names;
            }
        }
        // shops peut être {"fr": [...], "en": [...]}
        if let Some(fr) = val.get("fr").and_then(|v| v.as_array()) {
            let names: Vec<String> = fr
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();
            if !names.is_empty() {
                return names;
            }
        }
    }
    // Fallback merged.shops
    merged
        .get("shops")
        .and_then(|s| {
            s.get("fr")
                .and_then(|v| v.as_array())
                .or_else(|| s.as_array())
        })
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

// ─── Team ────────────────────────────────────────────────────────────────────

/// Recherche des équipes par ID ou nom.
pub fn search_teams(conn: &Connection, query: &str) -> anyhow::Result<Vec<TeamProfile>> {
    let q = sanitize_filter(query);
    let like_pat = format!("%{}%", q);

    query_rows(
        conn,
        "SELECT id, name_fr, name_en, name_ja,
                internal_code, series, region,
                data, sheet_data
         FROM inagle_teams
         WHERE id = ?1
            OR internal_code = ?1
            OR name_fr LIKE ?2
            OR name_en LIKE ?2
            OR name_ja LIKE ?2
         ORDER BY name_fr ASC
         LIMIT 20",
        &[&q as &dyn rusqlite::ToSql, &like_pat],
        team_row_map,
    )
}

/// Charge une équipe par son ID exact.
pub fn get_team(conn: &Connection, id: &str) -> anyhow::Result<Option<TeamProfile>> {
    let q = sanitize_filter(id);
    query_one(
        conn,
        "SELECT id, name_fr, name_en, name_ja,
                internal_code, series, region,
                data, sheet_data
         FROM inagle_teams WHERE id = ?1 OR internal_code = ?1",
        &[&q as &dyn rusqlite::ToSql],
        team_row_map,
    )
}

fn team_row_map(row: &rusqlite::Row<'_>) -> rusqlite::Result<TeamProfile> {
    let id: String = row.get(0)?;
    let name_fr: Option<String> = row.get(1)?;
    let name_en: Option<String> = row.get(2)?;
    let name_ja: Option<String> = row.get(3)?;
    let internal_code: Option<String> = row.get(4)?;
    let series: Option<String> = row.get(5)?;
    let region: Option<String> = row.get(6)?;
    let data: Option<String> = row.get(7)?;
    let sheet_data: Option<String> = row.get(8)?;

    let merged = merge_data_sheet(data.as_deref(), sheet_data.as_deref());

    // Kits depuis data.kits (objet avec clés de version: ie, go, v)
    let kits = merged
        .get("kits")
        .and_then(|k| k.as_object())
        .map(|obj| {
            obj.values()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    // Seasons depuis data.seasons (objet {V: 7, IE1: 1, ...})
    let seasons = merged
        .get("seasons")
        .and_then(|s| s.as_object())
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default();

    Ok(TeamProfile {
        id,
        name_fr,
        name_en,
        name_ja,
        internal_code,
        series,
        region,
        kits,
        seasons,
        merged,
    })
}

/// Resolve a team with the exact legacy JSON result shapes and canonical source order.
pub fn lookup_team_legacy(
    conn: &Connection,
    corpus_path: &std::path::Path,
    query: &str,
) -> anyhow::Result<serde_json::Value> {
    let bytes = std::fs::read(corpus_path)
        .map_err(|e| anyhow::anyhow!("canonical team corpus not found: {e}"))?;
    let corpus: Vec<Value> = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow::anyhow!("invalid canonical team corpus: {e}"))?;
    let payloads = query_rows(
        conn,
        "SELECT id, COALESCE(data, sheet_data) FROM inagle_teams",
        &[],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?
    .into_iter()
    .collect::<std::collections::HashMap<_, _>>();
    let teams = corpus
        .iter()
        .filter_map(|team| team.get("teamId").and_then(Value::as_str))
        .filter_map(|id| payloads.get(id))
        .map(|serialized| {
            serde_json::from_str::<Value>(serialized)
                .map_err(|e| anyhow::anyhow!("invalid enriched team payload: {e}"))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(lookup_team_values(&teams, query))
}

fn lookup_team_values(teams: &[Value], query: &str) -> Value {
    if let Some(team) = teams
        .iter()
        .find(|team| team.get("teamId").and_then(Value::as_str) == Some(query))
    {
        return team.clone();
    }

    let lowercase_query = query.to_lowercase();
    let matches = teams
        .iter()
        .filter(|team| {
            ["name", "displayName", "name_EN"].into_iter().any(|field| {
                team.get(field)
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.to_lowercase().contains(&lowercase_query))
            }) || team
                .get("name_JA")
                .and_then(Value::as_str)
                .is_some_and(|name| name.contains(query))
        })
        .collect::<Vec<_>>();

    match matches.as_slice() {
        [] => Value::Array(Vec::new()),
        [team] => (*team).clone(),
        teams => Value::Array(
            teams
                .iter()
                .map(|team| {
                    serde_json::json!({
                        "id": team.get("teamId").cloned().unwrap_or(Value::Null),
                        "name": team.get("name").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect(),
        ),
    }
}

// ─── Résolution nom de skill ──────────────────────────────────────────────────

/// Retourne le nom FR d'un skill depuis son ID (internal_code) ou son hex skillID.
///
/// Les personnages référencent leurs skills via un hex hash (ex: `0xF9B80F86`).
/// Ce hash est stocké dans `data->>'skillID'` de la table inagle_skills.
/// On essaie d'abord par `id` (internal_code), puis par le JSON data.
pub fn skill_name_by_id(conn: &Connection, skill_id: &str) -> String {
    let q = sanitize_filter(skill_id);
    // Essai 1 : correspondance directe sur id (internal_code comme rhd10010)
    let direct = query_one(
        conn,
        "SELECT name_fr, name_en FROM inagle_skills WHERE id = ?1 LIMIT 1",
        &[&q as &dyn rusqlite::ToSql],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    )
    .ok()
    .flatten()
    .and_then(|(fr, en)| fr.or(en));

    if let Some(name) = direct {
        return name;
    }

    // Second pass: resolve the game hash stored in the JSON payload. Using
    // json_extract avoids depending on whitespace or property order.
    let via_data = query_one(
        conn,
        "SELECT name_fr, name_en FROM inagle_skills \
         WHERE UPPER(json_extract(data, '$.skillID')) = UPPER(?1) LIMIT 1",
        &[&q as &dyn rusqlite::ToSql],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    )
    .ok()
    .flatten()
    .and_then(|(fr, en)| fr.or(en));

    via_data.unwrap_or_else(|| skill_id.to_string())
}

// ─── Compare ─────────────────────────────────────────────────────────────────

/// Compare deux personnages par ID/nom et retourne leurs stats interpolées + skills.
///
/// Identique à `compare` TS : recherche les profils, interpole au niveau demandé,
/// résout les skills via `skill_name_by_id`.
pub fn compare_characters(
    conn: &Connection,
    data_root: &Path,
    query1: &str,
    query2: &str,
    level: u8,
) -> anyhow::Result<CompareResult> {
    let raw_variants = load_compare_variants(data_root)?;
    let raw_bases = load_compare_bases(data_root)?;
    let skill_values = load_compare_skills(data_root)?;
    let aura_ids = load_compare_aura_ids(data_root)?;
    let base1 = find_compare_base(&raw_variants, &raw_bases, query1)
        .ok_or_else(|| anyhow::anyhow!("aucun personnage trouvé pour : \"{query1}\""))?;
    let base2 = find_compare_base(&raw_variants, &raw_bases, query2)
        .ok_or_else(|| anyhow::anyhow!("aucun personnage trouvé pour : \"{query2}\""))?;

    let p1 = select_compare_variant(conn, &raw_variants, &raw_bases, &aura_ids, base1, query1)?;
    let p2 = select_compare_variant(conn, &raw_variants, &raw_bases, &aura_ids, base2, query2)?;

    let slot = |p: &CharaProfile| -> CharaCompareSlot {
        let stats =
            interpolate_stat_curve(p.stats_lv1, p.stats_lv30, p.stats_lv50, p.stats_lv99, level);

        let name = p
            .name_fr
            .clone()
            .or_else(|| p.name_en.clone())
            .or_else(|| p.name_ja.clone())
            .unwrap_or_else(|| p.id.clone());

        let skills = p
            .skills
            .iter()
            .map(|sk| {
                let details = skill_values.iter().find(|value| {
                    ["skillID", "skillIDStr"].into_iter().any(|field| {
                        value.get(field).and_then(Value::as_str) == Some(sk.skill_id.as_str())
                    })
                });
                CompareSkillSlot {
                    learn_level: sk.learn_level,
                    skill_id: sk.skill_id.clone(),
                    name: details
                        .and_then(compare_skill_name)
                        .unwrap_or_else(|| sk.skill_id.clone()),
                    power: details.and_then(|value| {
                        value
                            .get("power_max")
                            .or_else(|| value.get("power"))
                            .and_then(Value::as_i64)
                    }),
                    cost: details.and_then(|value| {
                        value
                            .get("cost")
                            .or_else(|| value.get("tp"))
                            .and_then(Value::as_i64)
                    }),
                    element: details.and_then(|value| compare_localized_name(value, "elementName")),
                    category: details
                        .and_then(|value| compare_localized_name(value, "categoryName")),
                }
            })
            .collect();

        CharaCompareSlot {
            id: p.chara_id.clone(),
            chara_id: p.chara_id.clone(),
            name,
            position: p.position.as_deref().map(compare_position_code),
            element: p.element.as_deref().map(compare_element_name),
            rarity: p.rarity_label.clone(),
            stats,
            skills,
        }
    };

    Ok(CompareResult {
        level,
        chara1: slot(&p1),
        chara2: slot(&p2),
    })
}

fn select_compare_variant(
    conn: &Connection,
    raw_variants: &[RawCompareVariant],
    raw_bases: &[RawCompareBase],
    aura_ids: &std::collections::HashSet<String>,
    base: &RawCompareBase,
    query: &str,
) -> anyhow::Result<CharaProfile> {
    let base_name = compare_base_name(base);
    let mut variants = raw_variants
        .iter()
        .filter(|variant| {
            raw_bases
                .iter()
                .find(|candidate| candidate.id.eq_ignore_ascii_case(&variant.base_id))
                .is_some_and(|candidate| compare_base_name(candidate) == base_name)
        })
        .collect::<Vec<_>>();
    variants.sort_by_key(|variant| {
        let order = conn
            .query_row(
                "SELECT COALESCE(zukan_order, 999999) FROM inagle_characters WHERE id = ?1",
                [&variant.param_id],
                |row| row.get::<_, u64>(0),
            )
            .unwrap_or(999_999);
        (
            order,
            u64::from_str_radix(variant.param_id.trim_start_matches("0x"), 16)
                .map(|value| value as u32 as i32)
                .unwrap_or_default(),
        )
    });
    let first_variant = variants
        .first()
        .ok_or_else(|| anyhow::anyhow!("raw variant unavailable for {query}"))?;
    let mut profile = get_character(conn, &first_variant.param_id)?
        .ok_or_else(|| anyhow::anyhow!("mirror variant unavailable for {query}"))?;
    profile.chara_id.clone_from(&base.id);
    profile.name_fr.clone_from(&base.name_fr);
    profile.name_en.clone_from(&base.name_en);
    profile.name_ja.clone_from(&base.name_ja);
    profile.skills = variants
        .iter()
        .map(|variant| compare_playable_skills(&variant.skills, aura_ids))
        .find(|skills| !skills.is_empty())
        .unwrap_or_default();
    Ok(profile)
}

fn compare_base_name(base: &RawCompareBase) -> &str {
    base.name_fr
        .as_deref()
        .or(base.name_en.as_deref())
        .or(base.name_ja.as_deref())
        .unwrap_or(&base.id)
}

#[derive(Debug)]
struct RawCompareVariant {
    base_id: String,
    param_id: String,
    skills: Vec<SkillSlot>,
}

#[derive(Debug)]
struct RawCompareBase {
    id: String,
    internal_code: String,
    name_fr: Option<String>,
    name_en: Option<String>,
    name_ja: Option<String>,
    slug: String,
}

fn find_compare_base<'a>(
    variants: &[RawCompareVariant],
    bases: &'a [RawCompareBase],
    query: &str,
) -> Option<&'a RawCompareBase> {
    let query = query.trim().to_lowercase();
    let mut ordered = variants.iter().filter_map(|variant| {
        bases
            .iter()
            .find(|base| base.id.eq_ignore_ascii_case(&variant.base_id))
    });
    let exact = ordered.clone().find(|base| {
        base.id.to_lowercase() == query
            || base.internal_code.to_lowercase() == query
            || base.slug.to_lowercase() == query
            || [&base.name_fr, &base.name_en]
                .into_iter()
                .flatten()
                .any(|name| name.to_lowercase() == query)
    });
    exact.or_else(|| {
        ordered.find(|base| {
            [&base.name_fr, &base.name_en, &base.name_ja]
                .into_iter()
                .flatten()
                .any(|name| name.to_lowercase().contains(&query))
                || base.slug.to_lowercase().contains(&query)
        })
    })
}

fn load_compare_bases(data_root: &Path) -> anyhow::Result<Vec<RawCompareBase>> {
    let character_dir = data_root.join("common/gamedata/character");
    let path = versioned_config(&character_dir, "chara_base_")?;
    let root: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    let names_fr = load_compare_names(data_root, "fr")?;
    let names_en = load_compare_names(data_root, "en")?;
    let names_ja = load_compare_names(data_root, "ja")?;
    let mut raw = Vec::new();
    collect_compare_bases(&root, &mut raw);
    Ok(raw
        .into_iter()
        .map(|(id, internal_code, name_hash)| {
            let name_fr = names_fr.get(&name_hash).cloned();
            let name_en = names_en.get(&name_hash).cloned();
            let name_ja = names_ja.get(&name_hash).cloned();
            let slug = compare_slug(
                name_en
                    .as_deref()
                    .or(name_fr.as_deref())
                    .or(name_ja.as_deref())
                    .unwrap_or("unknown"),
            );
            RawCompareBase {
                id,
                internal_code,
                name_fr,
                name_en,
                name_ja,
                slug,
            }
        })
        .collect())
}

fn collect_compare_bases(value: &Value, bases: &mut Vec<(String, String, String)>) {
    if let Some(object) = value.as_object() {
        let is_base = object
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| {
                (name.starts_with("CHARA_BASE_INFO_") || name.starts_with("CHARA_BASE_BATTLE_"))
                    && name.rsplit('_').next().is_some_and(|index| {
                        index.chars().all(|character| character.is_ascii_digit())
                    })
            });
        if is_base && let Some(variables) = object.get("variables").and_then(Value::as_array) {
            let integer = |index: usize| {
                variables
                    .get(index)?
                    .get("value")?
                    .as_str()?
                    .parse::<i64>()
                    .ok()
            };
            let string = |index: usize| {
                variables
                    .get(index)?
                    .get("value")?
                    .as_str()
                    .map(str::to_string)
            };
            if let (Some(id), Some(internal_code), Some(name_hash)) =
                (integer(0), string(1), integer(3))
            {
                bases.push((compare_hex(id), internal_code, compare_hex(name_hash)));
            }
        }
        for field in ["children", "entries"] {
            if let Some(children) = object.get(field).and_then(Value::as_array) {
                for child in children {
                    collect_compare_bases(child, bases);
                }
            }
        }
    }
}

fn load_compare_names(
    data_root: &Path,
    locale: &str,
) -> anyhow::Result<std::collections::HashMap<String, String>> {
    let path = data_root
        .join("common/text")
        .join(locale)
        .join("chara_text.cfg.bin.json");
    let root: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    let mut names = std::collections::HashMap::new();
    collect_compare_names(&root, &mut names);
    Ok(names)
}

fn collect_compare_names(value: &Value, names: &mut std::collections::HashMap<String, String>) {
    if let Some(object) = value.as_object() {
        let is_name = object
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| name.starts_with("NOUN_INFO_") && !name.contains("BEGIN"));
        if is_name && let Some(variables) = object.get("variables").and_then(Value::as_array) {
            let hash = variables
                .first()
                .and_then(|variable| variable.get("value"))
                .and_then(Value::as_str)
                .and_then(|value| value.parse::<i64>().ok());
            let name = variables.iter().skip(2).find_map(|variable| {
                (variable.get("type").and_then(Value::as_str) == Some("String"))
                    .then(|| variable.get("value").and_then(Value::as_str))
                    .flatten()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            });
            if let (Some(hash), Some(name)) = (hash, name) {
                names.insert(compare_hex(hash), name);
            }
        }
        for field in ["children", "entries"] {
            if let Some(children) = object.get(field).and_then(Value::as_array) {
                for child in children {
                    collect_compare_names(child, names);
                }
            }
        }
    }
}

fn compare_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in name.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !slug.is_empty() {
                slug.push('_');
            }
            separator = false;
            slug.push(character);
        } else {
            separator = true;
        }
    }
    slug
}

fn versioned_config(directory: &Path, prefix: &str) -> anyhow::Result<std::path::PathBuf> {
    std::fs::read_dir(directory)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.strip_prefix(prefix)
                        .and_then(|version| version.chars().next())
                        .is_some_and(|first| first.is_ascii_digit())
                        && name.ends_with(".cfg.bin.json")
                })
        })
        .max()
        .ok_or_else(|| anyhow::anyhow!("{prefix} corpus not found in {}", directory.display()))
}

fn load_compare_variants(data_root: &Path) -> anyhow::Result<Vec<RawCompareVariant>> {
    let directory = data_root.join("common/gamedata/character");
    let path = versioned_config(&directory, "chara_param_")?;
    let root: Value = serde_json::from_slice(&std::fs::read(&path)?)?;
    let mut variants = Vec::new();
    collect_compare_variants(&root, &mut variants);
    Ok(variants)
}

fn collect_compare_variants(value: &Value, variants: &mut Vec<RawCompareVariant>) {
    if let Some(object) = value.as_object() {
        let is_param = object
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| {
                name.starts_with("CHARA_PARAM_INFO_")
                    && !name.contains("LIST")
                    && !name.contains("BEG")
            });
        if is_param
            && let Some(values) =
                object
                    .get("variables")
                    .and_then(Value::as_array)
                    .map(|variables| {
                        variables
                            .iter()
                            .filter_map(|variable| {
                                variable.get("value")?.as_str()?.parse::<i64>().ok()
                            })
                            .collect::<Vec<_>>()
                    })
            && values.len() >= 8
        {
            let mut skills = Vec::new();
            for slot in 0..9 {
                let level_index = 10 + slot * 2;
                let hash_index = 11 + slot * 2;
                if hash_index >= values.len() {
                    break;
                }
                let level = values[level_index];
                let skill = values[hash_index];
                if skill != 0 && (0..=99).contains(&level) {
                    skills.push(SkillSlot {
                        skill_id: compare_hex(skill),
                        learn_level: level as u32,
                    });
                }
            }
            variants.push(RawCompareVariant {
                param_id: compare_hex(values[0]),
                base_id: compare_hex(if values.len() == 8 && values[6] == values[0] {
                    values[0]
                } else {
                    values[1]
                }),
                skills,
            });
        }
        if let Some(children) = object.get("children").and_then(Value::as_array) {
            for child in children {
                collect_compare_variants(child, variants);
            }
        }
        if let Some(entries) = object.get("entries").and_then(Value::as_array) {
            for entry in entries {
                collect_compare_variants(entry, variants);
            }
        }
    }
}

fn compare_hex(value: i64) -> String {
    format!("0x{:08X}", value as u32)
}

fn compare_playable_skills(
    skills: &[SkillSlot],
    aura_ids: &std::collections::HashSet<String>,
) -> Vec<SkillSlot> {
    skills
        .iter()
        .filter(|skill| skill.skill_id != "0xDBEDB6B8" && !aura_ids.contains(&skill.skill_id))
        .cloned()
        .collect()
}

fn load_compare_skills(data_root: &Path) -> anyhow::Result<Vec<Value>> {
    Ok(serde_json::from_slice(&std::fs::read(
        data_root.join("all-gamedata/skills.json"),
    )?)?)
}

fn load_compare_aura_ids(data_root: &Path) -> anyhow::Result<std::collections::HashSet<String>> {
    let values: Vec<Value> =
        serde_json::from_slice(&std::fs::read(data_root.join("all-gamedata/auras.json"))?)?;
    Ok(values
        .iter()
        .filter_map(|value| {
            value
                .get("auraId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect())
}

fn compare_skill_name(value: &Value) -> Option<String> {
    ["displayName", "name_FR", "name_EN", "name_JA"]
        .into_iter()
        .find_map(|field| value.get(field).and_then(Value::as_str).map(str::to_string))
}

fn compare_localized_name(value: &Value, field: &str) -> Option<String> {
    let names = value.get(field)?;
    names
        .get("fr")
        .or_else(|| names.get("en"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn compare_position_code(position: &str) -> String {
    match position {
        "Gardien" => "GK",
        "Défenseur" => "DF",
        "Milieu" => "MF",
        "Attaquant" => "FW",
        other => other,
    }
    .to_string()
}

fn compare_element_name(element: &str) -> String {
    match element {
        "Feu" => "Fire",
        "Vent" => "Wind",
        "Forêt" => "Forest",
        "Montagne" => "Mountain",
        "Néant" => "Void",
        other => other,
    }
    .to_string()
}

// ─── Search multi-tables ──────────────────────────────────────────────────────

/// Recherche multi-tables (characters/skills/items/teams/auras/keshins/souls).
///
/// Identique à `search` TS : cherche dans chaque table et agrège les résultats.
pub fn search_all(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> anyhow::Result<Vec<SearchResult>> {
    let q = sanitize_filter(query);
    let like_pat = format!("%{}%", q);
    let mut results = Vec::new();

    // Characters
    let chars = query_rows(
        conn,
        "SELECT id, name_fr, name_en, position FROM inagle_characters
         WHERE id = ?1 OR chara_id = ?1 OR internal_code = ?1 OR slug = ?1
            OR name_fr LIKE ?2 OR name_en LIKE ?2 OR name_ja LIKE ?2
         ORDER BY name_fr ASC LIMIT 10",
        &[&q as &dyn rusqlite::ToSql, &like_pat],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        },
    )?;
    for (id, name_fr, name_en, position) in chars {
        let name = name_fr.or(name_en).unwrap_or_else(|| id.clone());
        results.push(SearchResult {
            entity_type: "chara".to_string(),
            id,
            name,
            extra: position,
        });
    }

    // Skills
    let skills = query_rows(
        conn,
        "SELECT id, name_fr, name_en, category FROM inagle_skills
         WHERE id = ?1 OR internal_code = ?1
            OR name_fr LIKE ?2 OR name_en LIKE ?2 OR name_ja LIKE ?2
         ORDER BY name_fr ASC LIMIT 10",
        &[&q as &dyn rusqlite::ToSql, &like_pat],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        },
    )?;
    for (id, name_fr, name_en, cat) in skills {
        let name = name_fr.or(name_en).unwrap_or_else(|| id.clone());
        results.push(SearchResult {
            entity_type: "skill".to_string(),
            id,
            name,
            extra: cat,
        });
    }

    // Items
    let items = query_rows(
        conn,
        "SELECT id, name_fr, name_en, category FROM inagle_items
         WHERE id = ?1 OR internal_code = ?1
            OR name_fr LIKE ?2 OR name_en LIKE ?2 OR name_ja LIKE ?2
         ORDER BY name_fr ASC LIMIT 10",
        &[&q as &dyn rusqlite::ToSql, &like_pat],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        },
    )?;
    for (id, name_fr, name_en, cat) in items {
        let name = name_fr.or(name_en).unwrap_or_else(|| id.clone());
        results.push(SearchResult {
            entity_type: "item".to_string(),
            id,
            name,
            extra: cat,
        });
    }

    // Teams
    let teams = query_rows(
        conn,
        "SELECT id, name_fr, name_en, series FROM inagle_teams
         WHERE id = ?1 OR internal_code = ?1
            OR name_fr LIKE ?2 OR name_en LIKE ?2 OR name_ja LIKE ?2
         ORDER BY name_fr ASC LIMIT 5",
        &[&q as &dyn rusqlite::ToSql, &like_pat],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        },
    )?;
    for (id, name_fr, name_en, series) in teams {
        let name = name_fr.or(name_en).unwrap_or_else(|| id.clone());
        results.push(SearchResult {
            entity_type: "team".to_string(),
            id,
            name,
            extra: series,
        });
    }

    // Auras / Keshins / Souls
    for (table, entity_type) in &[
        ("inagle_auras", "aura"),
        ("inagle_keshins", "keshin"),
        ("inagle_souls", "soul"),
    ] {
        let sql = format!(
            "SELECT id, name_fr, name_en FROM {table}
             WHERE id = ?1 OR name_fr LIKE ?2 OR name_en LIKE ?2
             ORDER BY name_fr ASC LIMIT 5"
        );
        let rows = query_rows(
            conn,
            &sql,
            &[&q as &dyn rusqlite::ToSql, &like_pat],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )?;
        for (id, name_fr, name_en) in rows {
            let name = name_fr.or(name_en).unwrap_or_else(|| id.clone());
            results.push(SearchResult {
                entity_type: entity_type.to_string(),
                id,
                name,
                extra: None,
            });
        }
    }

    results.truncate(limit);
    Ok(results)
}

// ─── DB SQL ───────────────────────────────────────────────────────────────────

/// Vérifie que la requête SQL est en lecture seule (SELECT ou PRAGMA uniquement).
///
/// Refuse les writes pour la sécurité des données du miroir.
pub fn check_readonly_sql(sql: &str) -> anyhow::Result<()> {
    let trimmed = sql.trim().to_uppercase();
    let allowed = trimmed.starts_with("SELECT")
        || trimmed.starts_with("PRAGMA")
        || trimmed.starts_with("EXPLAIN")
        || trimmed.starts_with("WITH"); // CTE SELECT
    anyhow::ensure!(
        allowed,
        "requête non autorisée : seuls SELECT, PRAGMA, EXPLAIN et WITH … SELECT sont acceptés.\n\
         Requête reçue : {}",
        &sql[..sql.len().min(80)]
    );
    Ok(())
}

/// Exécute une requête SELECT sur le miroir et retourne les lignes sous forme JSON.
pub fn exec_readonly_sql(conn: &Connection, sql: &str) -> anyhow::Result<Vec<serde_json::Value>> {
    check_readonly_sql(sql)?;

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| anyhow::anyhow!("préparation SQL : {e}"))?;
    anyhow::ensure!(
        stmt.readonly(),
        "requête non autorisée : SQLite indique que cette instruction peut modifier la base"
    );
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("col").to_string())
        .collect();

    let rows = stmt
        .query_map([], |row| {
            let mut obj = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let val: rusqlite::types::Value = row.get(i)?;
                let jval = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(n) => serde_json::Value::Number(n.into()),
                    rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null),
                    rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
                    rusqlite::types::Value::Blob(b) => {
                        serde_json::Value::String(format!("<blob {} bytes>", b.len()))
                    }
                };
                obj.insert(name.clone(), jval);
            }
            Ok(serde_json::Value::Object(obj))
        })
        .map_err(|e| anyhow::anyhow!("exécution SQL : {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| anyhow::anyhow!("lecture ligne : {e}"))?);
    }
    Ok(result)
}

// ─── Random Team ─────────────────────────────────────────────────────────────

/// Génère une équipe aléatoire depuis le miroir, avec un PRNG seédé explicite.
///
/// Utilise `rand::rngs::SmallRng` seédé depuis `seed` pour être déterministe.
/// Reproduit la logique `random-team` TS : GK/DF/MF/FW depuis les positions,
/// avec fallback si le filtre élément/style est trop restrictif.
pub fn random_team(
    conn: &Connection,
    formation: &str,
    element_filter: Option<&str>,
    playstyle_filter: Option<&str>,
    seed: u64,
) -> anyhow::Result<RandomTeam> {
    use rand::rngs::SmallRng;
    use rand::{Rng, SeedableRng};

    // Formations identiques au TS
    let formations: &[(&str, usize, usize, usize)] = &[
        // (layout, df, mf, fw)
        ("4-4-2", 4, 4, 2),
        ("4-3-3", 4, 3, 3),
        ("3-4-3", 3, 4, 3),
        ("3-5-2", 3, 5, 2),
        ("4-5-1", 4, 5, 1),
        ("3-6-1", 3, 6, 1),
        ("5-4-1", 5, 4, 1),
        ("2-4-4", 2, 4, 4),
        ("2-5-3", 2, 5, 3),
        ("5-1-4", 5, 1, 4),
        ("3-3-4", 3, 3, 4),
        ("5-3-2", 5, 3, 2),
    ];
    let (canonical_formation, f_df, f_mf, f_fw) = formations
        .iter()
        .find(|(name, _, _, _)| *name == formation)
        .map(|(name, df, mf, fw)| (*name, *df, *mf, *fw))
        .unwrap_or(("4-4-2", 4, 4, 2));

    let mut rng = SmallRng::seed_from_u64(seed);

    // Map élément FR/EN (fidèle au TS)
    let element_db = element_filter.and_then(|element| match element.to_lowercase().as_str() {
        "feu" | "fire" => Some("Feu"),
        "vent" | "wind" => Some("Vent"),
        "forêt" | "foret" | "forest" => Some("Forêt"),
        "montagne" | "mountain" => Some("Montagne"),
        "néant" | "neant" | "void" => Some("Néant"),
        _ => None,
    });
    let playstyle_db =
        playstyle_filter.and_then(|playstyle| match playstyle.to_lowercase().as_str() {
            "bond" | "lien" => Some("Bond"),
            "justice" => Some("Justice"),
            "breach" | "percée" | "percee" => Some("Breach"),
            "tension" => Some("Tension"),
            "rough play" | "roughplay" | "jeu violent" => Some("Rough Play"),
            "counter" | "contre" => Some("Counter"),
            _ => None,
        });

    // Récupère un pool de joueurs pour une position donnée
    let fetch_pool = |position: &str,
                      required: usize|
     -> anyhow::Result<Vec<(String, String, Option<String>)>> {
        // Base query : id, name_fr/name_en, element
        let base_sql = "SELECT id, COALESCE(name_fr, name_en, id), element \
                        FROM inagle_characters \
                        WHERE position = ?1 AND stat_frappe IS NOT NULL AND zukan_hash IS NOT NULL";

        if element_db.is_some() || playstyle_db.is_some() {
            let filtered_sql = format!(
                "{base_sql}{}{}",
                if element_db.is_some() {
                    " AND element = ?2"
                } else {
                    ""
                },
                match (element_db, playstyle_db) {
                    (Some(_), Some(_)) => " AND json_extract(sheet_data, '$.playstyle') = ?3",
                    (None, Some(_)) => " AND json_extract(sheet_data, '$.playstyle') = ?2",
                    _ => "",
                }
            );
            let mut values = vec![position.to_string()];
            if let Some(element) = element_db {
                values.push(element.to_string());
            }
            if let Some(playstyle) = playstyle_db {
                values.push(playstyle.to_string());
            }
            let params: Vec<&dyn rusqlite::ToSql> = values
                .iter()
                .map(|value| value as &dyn rusqlite::ToSql)
                .collect();
            let filtered = query_rows(conn, &filtered_sql, &params, |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?;
            if filtered.len() >= required {
                return Ok(filtered);
            }
        }

        if playstyle_db.is_some()
            && let Some(element) = element_db
        {
            let element_only = query_rows(
                conn,
                &format!("{base_sql} AND element = ?2"),
                &[&position as &dyn rusqlite::ToSql, &element],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )?;
            if element_only.len() >= required {
                return Ok(element_only);
            }
        }

        // Fallback sans filtre
        query_rows(
            conn,
            base_sql,
            &[&position as &dyn rusqlite::ToSql],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
    };

    // Sélection aléatoire de n éléments depuis un pool (sans remise)
    let pick_random = |pool: &mut Vec<(String, String, Option<String>)>,
                       n: usize,
                       rng: &mut SmallRng|
     -> Vec<RandomTeamPlayer> {
        let mut result = Vec::new();
        for _ in 0..n {
            if pool.is_empty() {
                break;
            }
            let idx = rng.gen_range(0..pool.len());
            let (id, name, element) = pool.swap_remove(idx);
            result.push(RandomTeamPlayer {
                id,
                name,
                element,
                position: String::new(), // sera rempli ci-dessous
            });
        }
        result
    };

    let mut gk_pool = fetch_pool("Gardien", 1)?;
    let mut df_pool = fetch_pool("Défenseur", f_df)?;
    let mut mf_pool = fetch_pool("Milieu", f_mf)?;
    let mut fw_pool = fetch_pool("Attaquant", f_fw)?;

    let mut gk = pick_random(&mut gk_pool, 1, &mut rng);
    let mut df = pick_random(&mut df_pool, f_df, &mut rng);
    let mut mf = pick_random(&mut mf_pool, f_mf, &mut rng);
    let mut fw = pick_random(&mut fw_pool, f_fw, &mut rng);

    // Assigner les codes de position
    for p in &mut gk {
        p.position = "GK".to_string();
    }
    for p in &mut df {
        p.position = "DF".to_string();
    }
    for p in &mut mf {
        p.position = "MF".to_string();
    }
    for p in &mut fw {
        p.position = "FW".to_string();
    }

    // Sélection coach/managers depuis inagle_coordinators
    let all_coords = query_rows(
        conn,
        "SELECT id, COALESCE(name_localised, name_romaji, CAST(id AS TEXT)), element, playstyle, role, buff \
         FROM inagle_coordinators",
        &[],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        },
    )?;

    // Ligne SQL d'un coordinateur : (game_id, name_ja, role, ?, ?).
    type CoordRow = (
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let mut coaches: Vec<_> = all_coords
        .iter()
        .filter(|(_, _, _, _, role, _)| {
            role.as_deref() == Some("Coach") || role.as_deref() == Some("Manager")
        })
        .collect();
    let mut mgrs: Vec<_> = all_coords
        .iter()
        .filter(|(_, _, _, _, role, _)| role.as_deref() == Some("Coordinator"))
        .collect();

    let pick_coord = |pool: &mut Vec<&CoordRow>, rng: &mut SmallRng| -> Option<RandomTeamCoord> {
        if pool.is_empty() {
            return None;
        }
        let idx = rng.gen_range(0..pool.len());
        let (id, name, element, playstyle, role, buff) = pool.swap_remove(idx);
        Some(RandomTeamCoord {
            id: *id,
            name: name.clone(),
            element: element.clone(),
            playstyle: playstyle.clone(),
            role: role.clone().unwrap_or_default(),
            buff: buff.clone(),
        })
    };

    let coach = pick_coord(&mut coaches, &mut rng);
    let managers: Vec<RandomTeamCoord> = (0..3)
        .filter_map(|_| pick_coord(&mut mgrs, &mut rng))
        .collect();

    Ok(RandomTeam {
        seed,
        formation: canonical_formation.to_string(),
        gk,
        df,
        mf,
        fw,
        coach,
        managers,
    })
}

// ─── Team Builder ─────────────────────────────────────────────────────────────

/// Liste les équipes sauvegardées dans `inagle_team_build` du miroir.
///
/// Note : le TS team-builder list/add/delete opère sur PostgreSQL (`user_teams`).
/// On porte ici uniquement la partie miroir SQLite (`inagle_team_build`).
pub fn team_build_list(conn: &Connection) -> anyhow::Result<Vec<TeamBuildEntry>> {
    let rows = query_rows(
        conn,
        "SELECT id, name_fr, name_en, position, element, data \
         FROM inagle_team_build \
         ORDER BY name_fr ASC NULLS LAST \
         LIMIT 100",
        &[],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        },
    );
    match rows {
        Err(_) => {
            // La table inagle_team_build peut ne pas exister dans certains miroirs
            Ok(Vec::new())
        }
        Ok(rows) => {
            let entries = rows
                .into_iter()
                .map(|(id, name_fr, name_en, position, element, data_str)| {
                    let id = id.unwrap_or_default();
                    let name = name_fr.or(name_en).unwrap_or_else(|| id.clone());
                    let data = data_str
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or(serde_json::Value::Object(Default::default()));
                    TeamBuildEntry {
                        id,
                        name,
                        slot: None,
                        position,
                        element,
                        data,
                    }
                })
                .collect();
            Ok(entries)
        }
    }
}

/// Calcule un résumé de stats pour un joueur inagle_team_build via son ID.
pub fn team_build_calc(conn: &Connection, id: &str) -> anyhow::Result<Option<TeamBuildEntry>> {
    let q = sanitize_filter(id);
    let row = query_one(
        conn,
        "SELECT id, name_fr, name_en, position, element, data \
         FROM inagle_team_build WHERE id = ?1 OR name_fr = ?1 OR name_en = ?1 LIMIT 1",
        &[&q as &dyn rusqlite::ToSql],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        },
    );
    match row {
        Err(_) => Ok(None),
        Ok(None) => Ok(None),
        Ok(Some((id_opt, name_fr, name_en, position, element, data_str))) => {
            let id_val = id_opt.unwrap_or_default();
            let name = name_fr.or(name_en).unwrap_or_else(|| id_val.clone());
            let data = data_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::Value::Object(Default::default()));
            Ok(Some(TeamBuildEntry {
                id: id_val,
                name,
                slot: None,
                position,
                element,
                data,
            }))
        }
    }
}

// ─── Status ───────────────────────────────────────────────────────────────────

/// Produce the legacy `status` report without mutating Redis.
pub fn status_report(
    conn: &Connection,
    db_path: &Path,
    redis_url: &str,
) -> anyhow::Result<StatusReport> {
    let started = Instant::now();
    let path = std::fs::canonicalize(db_path).unwrap_or_else(|_| db_path.to_path_buf());
    let file_size = std::fs::metadata(&path)
        .map(|meta| format_megabytes(meta.len()))
        .unwrap_or_else(|_| "0.00 MB".to_string());
    let tables = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
        [],
        |row| row.get::<_, u64>(0),
    )?;
    let character_count = conn.query_row("SELECT COUNT(*) FROM inagle_characters", [], |row| {
        row.get::<_, u64>(0)
    })?;

    let redis = redis_status(redis_url);
    let git = GitStatus {
        branch: git_output(&["rev-parse", "--abbrev-ref", "HEAD"])
            .unwrap_or_else(|| "unknown".to_string()),
        commit: git_output(&["rev-parse", "--short", "HEAD"])
            .unwrap_or_else(|| "unknown".to_string()),
        clean: git_output(&["status", "--porcelain"]).is_some_and(|output| output.is_empty()),
    };
    let proc_memory = proc_memory_kib();
    let system_memory = system_memory_kib();

    Ok(StatusReport {
        sqlite: SqliteStatus {
            healthy: true,
            path: path.display().to_string(),
            file_size,
            tables,
            character_count,
            error: None,
        },
        redis,
        git,
        process: ProcessStatus {
            uptime: format!("{:.1}s", started.elapsed().as_secs_f64()),
            memory: ProcessMemoryStatus {
                heap_used: format_megabytes(proc_memory.0.saturating_mul(1024)),
                rss: format_megabytes(proc_memory.1.saturating_mul(1024)),
            },
        },
        system: SystemStatus {
            total_memory: format_gigabytes(system_memory.0.saturating_mul(1024)),
            free_memory: format_gigabytes(system_memory.1.saturating_mul(1024)),
            platform: std::env::consts::OS.to_string(),
            arch: legacy_arch().to_string(),
        },
    })
}

fn redis_status(url: &str) -> RedisStatus {
    let started = Instant::now();
    let result = redis::Client::open(url)
        .and_then(|client| client.get_connection())
        .and_then(|mut connection| {
            use redis::Commands;
            connection.get::<_, Option<String>>("status:ping")
        });
    let latency = format!("{:.2}ms", started.elapsed().as_secs_f64() * 1000.0);
    match result {
        Ok(_) => RedisStatus {
            healthy: true,
            latency,
            error: None,
        },
        Err(error) => RedisStatus {
            healthy: false,
            latency,
            error: Some(error.to_string()),
        },
    }
}

fn git_output(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string()
    })
}

fn proc_memory_kib() -> (u64, u64) {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    (
        proc_status_kib(&status, "VmData:"),
        proc_status_kib(&status, "VmRSS:"),
    )
}

fn proc_status_kib(status: &str, field: &str) -> u64 {
    status
        .lines()
        .find_map(|line| line.strip_prefix(field))
        .and_then(|value| value.split_whitespace().next())
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn system_memory_kib() -> (u64, u64) {
    let meminfo = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    (
        proc_status_kib(&meminfo, "MemTotal:"),
        proc_status_kib(&meminfo, "MemFree:"),
    )
}

fn format_megabytes(bytes: u64) -> String {
    format!("{:.2} MB", bytes as f64 / (1024.0 * 1024.0))
}

fn format_gigabytes(bytes: u64) -> String {
    format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

fn legacy_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

// ─── Audit ────────────────────────────────────────────────────────────────────

/// Audit the normalized character mirror and canonical enriched skill corpus.
///
/// These are the two data sources used by the legacy `audit` command. The mirror stores derived
/// character image/stat fields as columns, while `skills.json` contains the full skill collection
/// rather than the smaller publication subset in `inagle_skills`.
pub fn audit_mirror(
    conn: &Connection,
    skills_path: &std::path::Path,
) -> anyhow::Result<AuditReport> {
    let characters = conn.query_row(
        "SELECT COUNT(*),
                SUM(CASE WHEN COALESCE(name_fr, '') = '' AND COALESCE(name_en, '') = '' THEN 1 ELSE 0 END),
                SUM(CASE WHEN COALESCE(image_url, '') = ''
                          AND COALESCE(json_extract(data, '$.icons.face'), '') = ''
                          AND COALESCE(json_extract(data, '$.zukanHash'), '') = ''
                          AND COALESCE(json_extract(data, '$.image'), '') = '' THEN 1 ELSE 0 END),
                SUM(CASE WHEN stat_frappe IS NULL AND stat_controle IS NULL
                          AND stat_technique IS NULL AND stat_pression IS NULL
                          AND stat_physique IS NULL AND stat_agilite IS NULL THEN 1 ELSE 0 END)
         FROM inagle_characters",
        [],
        |row| {
            Ok(CharacterAudit {
                total: row.get::<_, i64>(0)? as u64,
                missing_name_fr_en: row.get::<_, i64>(1)? as u64,
                missing_image: row.get::<_, i64>(2)? as u64,
                missing_stats: row.get::<_, i64>(3)? as u64,
            })
        },
    )?;

    #[derive(serde::Deserialize)]
    struct SkillName {
        #[serde(rename = "name_FR")]
        name_fr: Option<String>,
        #[serde(rename = "name_EN")]
        name_en: Option<String>,
    }
    let bytes = std::fs::read(skills_path)
        .map_err(|e| anyhow::anyhow!("canonical skill corpus not found: {e}"))?;
    let skill_rows: Vec<SkillName> = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow::anyhow!("invalid canonical skill corpus: {e}"))?;
    let skills = SkillAudit {
        total: skill_rows.len() as u64,
        missing_name_fr_en: skill_rows
            .iter()
            .filter(|skill| skill.name_fr.is_none() && skill.name_en.is_none())
            .count() as u64,
    };

    Ok(AuditReport { characters, skills })
}

// ─── Dialogue ────────────────────────────────────────────────────────────────

/// Search `story_text_database.json` in canonical source order.
///
/// Matches the legacy `dialogue` command with case-insensitive multilingual text filtering and
/// optional speaker-name or exact speaker-identifier filtering.
pub fn search_dialogues(
    database_path: &std::path::Path,
    text_query: &str,
    speaker_query: Option<&str>,
    limit: usize,
) -> anyhow::Result<Vec<DialogueMatch>> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Database {
        #[serde(default)]
        events: Vec<Event>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Event {
        event_id: String,
        #[serde(default)]
        dialogues: Vec<Dialogue>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Dialogue {
        dialogue_id: String,
        speaker: Option<Speaker>,
        text: Option<DialogueText>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Speaker {
        chara_id: Option<String>,
        names: Option<DialogueText>,
    }

    let bytes = std::fs::read(database_path)
        .map_err(|e| anyhow::anyhow!("story text database not found: {e}"))?;
    let database: Database = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow::anyhow!("invalid story text database: {e}"))?;
    let text_query = text_query.trim().to_lowercase();
    let speaker_query = speaker_query.map(|query| query.trim().to_lowercase());
    let mut matches = Vec::new();

    for event in database.events {
        for dialogue in event.dialogues {
            let matches_text = text_query.is_empty()
                || dialogue.text.as_ref().is_some_and(|text| {
                    [&text.fr, &text.en, &text.ja].into_iter().any(|value| {
                        value
                            .as_deref()
                            .is_some_and(|value| value.to_lowercase().contains(&text_query))
                    })
                });
            let matches_speaker = speaker_query.as_ref().is_none_or(|query| {
                dialogue.speaker.as_ref().is_some_and(|speaker| {
                    speaker
                        .chara_id
                        .as_deref()
                        .is_some_and(|id| id.to_lowercase() == *query)
                        || speaker.names.as_ref().is_some_and(|names| {
                            [&names.fr, &names.en, &names.ja].into_iter().any(|value| {
                                value
                                    .as_deref()
                                    .is_some_and(|value| value.to_lowercase().contains(query))
                            })
                        })
                })
            });
            if matches_text && matches_speaker {
                let speaker = dialogue.speaker.and_then(|speaker| {
                    speaker
                        .names
                        .and_then(|names| names.fr.or(names.en).or(names.ja))
                        .or(speaker.chara_id)
                });
                matches.push(DialogueMatch {
                    event_id: event.event_id.clone(),
                    dialogue_id: dialogue.dialogue_id,
                    speaker,
                    text: dialogue.text,
                });
                if matches.len() >= limit {
                    return Ok(matches);
                }
            }
        }
    }
    Ok(matches)
}

// ─── Redis get/set/del ────────────────────────────────────────────────────────

/// Exécute une commande Redis simple : get / set / del.
///
/// Identique à `redis` TS : opère sur l'URL fournie (db0 ou db3 selon le contexte).
pub fn redis_cmd(
    url: &str,
    cmd: &str,
    key: &str,
    val: Option<&str>,
) -> anyhow::Result<Option<Value>> {
    use redis::Commands;
    let client = redis::Client::open(url).map_err(|e| anyhow::anyhow!("connexion Redis : {e}"))?;
    let mut conn = client
        .get_connection()
        .map_err(|e| anyhow::anyhow!("Redis get_connection : {e}"))?;

    match cmd.to_lowercase().as_str() {
        "get" => {
            let result: Option<String> = conn
                .get(key)
                .map_err(|e| anyhow::anyhow!("Redis GET : {e}"))?;
            Ok(result.map(|serialized| {
                serde_json::from_str(&serialized).unwrap_or(Value::String(serialized))
            }))
        }
        "set" => {
            let v = val.ok_or_else(|| anyhow::anyhow!("valeur requise pour set"))?;
            let parsed =
                serde_json::from_str::<Value>(v).unwrap_or_else(|_| Value::String(v.into()));
            let serialized = serde_json::to_string(&parsed)?;
            conn.set_ex::<_, _, ()>(key, serialized, 3_600)
                .map_err(|e| anyhow::anyhow!("Redis SET : {e}"))?;
            Ok(Some(Value::Bool(true)))
        }
        "del" => {
            conn.del::<_, ()>(key)
                .map_err(|e| anyhow::anyhow!("Redis DEL : {e}"))?;
            Ok(Some(Value::Bool(true)))
        }
        other => anyhow::bail!(
            "commande Redis inconnue : '{}'. Utiliser : get / set / del",
            other
        ),
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;

    use super::{
        check_readonly_sql, compare_element_name, compare_position_code, exec_readonly_sql,
        interpolate_stat_curve, interpolate_stats, lookup_item_legacy, lookup_skill_values,
        lookup_team_values, sanitize_filter,
    };
    use crate::model::{CompareSkillSlot, StatBlock};

    #[test]
    fn sanitize_filter_preserves_internal_identifier_underscores() {
        assert_eq!(sanitize_filter(r"a_b%,().*\\c"), "a_bc");
    }

    #[test]
    fn interpolation_uses_the_two_documented_segments() {
        let lv1 = StatBlock {
            kick: 1,
            ..StatBlock::default()
        };
        let lv50 = StatBlock {
            kick: 50,
            ..StatBlock::default()
        };
        let lv99 = StatBlock {
            kick: 99,
            ..StatBlock::default()
        };

        assert_eq!(interpolate_stats(lv1, lv50, lv99, 1).kick, 1);
        assert_eq!(interpolate_stats(lv1, lv50, lv99, 50).kick, 50);
        assert_eq!(interpolate_stats(lv1, lv50, lv99, 75).kick, 75);
        assert_eq!(interpolate_stats(lv1, lv50, lv99, 99).kick, 99);
    }

    #[test]
    fn partial_stat_curve_ignores_lv50_like_legacy_azalee() {
        let lv1 = StatBlock {
            kick: 1,
            ..StatBlock::default()
        };
        let misleading_lv50 = StatBlock {
            kick: 500,
            ..StatBlock::default()
        };
        let lv99 = StatBlock {
            kick: 99,
            ..StatBlock::default()
        };

        assert_eq!(
            interpolate_stat_curve(Some(lv1), None, Some(misleading_lv50), Some(lv99), 50).kick,
            50
        );
    }

    #[test]
    fn compare_contract_uses_legacy_codes_and_json_field_names() {
        assert_eq!(compare_position_code("Gardien"), "GK");
        assert_eq!(compare_element_name("Montagne"), "Mountain");

        let skill = CompareSkillSlot {
            learn_level: 7,
            skill_id: "skill-id".to_string(),
            name: "Skill".to_string(),
            power: Some(100),
            cost: None,
            element: Some("Fire".to_string()),
            category: Some("Shoot".to_string()),
        };
        let value = serde_json::to_value(skill).expect("serialize comparison skill");

        assert_eq!(value["learnLevel"], 7);
        assert_eq!(value["id"], "skill-id");
        assert!(value.get("learn_level").is_none());
        assert!(value.get("skill_id").is_none());
        assert!(value.get("cost").is_none());
    }

    #[test]
    fn readonly_sql_returns_typed_json_rows() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(
            "CREATE TABLE sample(id INTEGER, name TEXT); INSERT INTO sample VALUES (7, 'Mark');",
        )
        .expect("seed fixture");

        let rows = exec_readonly_sql(&conn, "SELECT id, name FROM sample")
            .expect("read-only query succeeds");

        assert_eq!(rows, vec![json!({ "id": 7, "name": "Mark" })]);
    }

    #[test]
    fn item_lookup_preserves_legacy_result_shapes() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(
            "CREATE TABLE inagle_items(
                id TEXT, name_en TEXT, name_ja TEXT, name_fr TEXT, data TEXT, sheet_data TEXT
             );
             INSERT INTO inagle_items VALUES
                ('item-1', 'Red Boots', NULL, 'Crampons rouges',
                 '{\"itemId\":\"item-1\",\"name\":\"Red Boots\",\"names\":{\"fr\":\"Crampons rouges\"}}', NULL),
                ('item-2', 'Blue Boots', NULL, 'Crampons bleus',
                 '{\"itemId\":\"item-2\",\"name\":\"Blue Boots\",\"names\":{\"fr\":\"Crampons bleus\"}}', NULL);",
        )
        .expect("seed item fixture");

        assert_eq!(
            lookup_item_legacy(&conn, "item-1").expect("exact item"),
            json!({"itemId": "item-1", "name": "Red Boots", "names": {"fr": "Crampons rouges"}})
        );
        assert_eq!(
            lookup_item_legacy(&conn, "rouges").expect("unique item"),
            json!({"itemId": "item-1", "name": "Red Boots", "names": {"fr": "Crampons rouges"}})
        );
        assert_eq!(
            lookup_item_legacy(&conn, "Boots").expect("ambiguous items"),
            json!([
                {"id": "item-1", "name": "Crampons rouges"},
                {"id": "item-2", "name": "Crampons bleus"}
            ])
        );
        assert_eq!(
            lookup_item_legacy(&conn, "missing").expect("missing item"),
            json!([])
        );
    }

    #[test]
    fn team_lookup_preserves_legacy_result_shapes() {
        let teams = json!([
            {"teamId": "team-1", "name": "Raimon", "displayName": "Raimon", "name_EN": "Raimon", "name_JA": "雷門中"},
            {"teamId": "team-2", "name": "Old Raimon", "displayName": "Old Raimon", "name_EN": "Old Raimon", "name_JA": "雷門OB"}
        ]);
        let teams = teams.as_array().expect("team fixture array");

        assert_eq!(lookup_team_values(teams, "team-1")["name"], "Raimon");
        assert_eq!(
            lookup_team_values(teams, "Raimon"),
            json!([
                {"id": "team-1", "name": "Raimon"},
                {"id": "team-2", "name": "Old Raimon"}
            ])
        );
        assert_eq!(lookup_team_values(teams, "missing"), json!([]));
    }

    #[test]
    fn skill_lookup_preserves_precedence_and_search_annotations() {
        let main = json!([
            {"skillID": "main-id", "skillIDStr": "main-code", "name_EN": "Fire Shot", "skillType": "main"},
            {"skillID": "main-id-2", "skillIDStr": "main-code-2", "name_EN": "Fire Storm", "skillType": "main"}
        ]);
        let passives = json!([{"passiveId": "passive-id", "name_FR": "Passif"}]);
        let auras = json!([{"auraId": "aura-id", "name_FR": "Fire Aura"}]);
        let main = main.as_array().expect("main fixture");
        let passives = passives.as_array().expect("passive fixture");
        let auras = auras.as_array().expect("aura fixture");

        assert_eq!(
            lookup_skill_values(main, passives, auras, "passive-id")["name_FR"],
            "Passif"
        );
        let matches = lookup_skill_values(main, passives, auras, "Fire");
        assert_eq!(matches.as_array().map(Vec::len), Some(3));
        assert_eq!(matches[0]["skillType"], "main");
        assert_eq!(matches[2]["skillType"], "aura");
        assert_eq!(
            lookup_skill_values(main, passives, auras, "missing"),
            json!([])
        );
    }

    #[test]
    fn sqlite_readonly_check_rejects_cte_and_pragma_mutations() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch("CREATE TABLE sample(id INTEGER); INSERT INTO sample VALUES (1);")
            .expect("seed fixture");

        assert!(check_readonly_sql("WITH selected AS (SELECT 1) SELECT * FROM selected").is_ok());
        assert!(
            exec_readonly_sql(
                &conn,
                "WITH selected AS (SELECT 1) DELETE FROM sample RETURNING id"
            )
            .is_err()
        );
        assert!(exec_readonly_sql(&conn, "PRAGMA user_version = 7").is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM sample", [], |row| row
                .get::<_, i64>(0))
                .expect("count rows"),
            1
        );
        assert_eq!(
            conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("read user_version"),
            0
        );
    }
}
