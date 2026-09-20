//! Typed joined wiki cards for all hosts. Existing query owners perform every database read.
use crate::model::{AuraSummary, CharaSummary, StatBlock};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

type SkillCache = HashMap<String, Option<crate::model::SkillProfile>>;

fn cached_skill<'a>(
    conn: &Connection,
    cache: &'a mut SkillCache,
    id: &str,
) -> anyhow::Result<Option<&'a crate::model::SkillProfile>> {
    let count = cache.len();
    let value = match cache.entry(id.to_owned()) {
        std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
        std::collections::hash_map::Entry::Vacant(entry) => {
            anyhow::ensure!(
                count < 128,
                "Character movesets exceed the bounded skill join budget"
            );
            entry.insert(crate::query::get_skill(conn, id)?)
        }
    };
    Ok(value.as_ref())
}

/// Resolve display metadata without replacing source IDs, levels, order or variant fields.
fn enrich_moveset(
    conn: &Connection,
    value: &mut serde_json::Value,
    cache: &mut SkillCache,
    depth: usize,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        depth <= 16,
        "Character moveset nesting exceeds its bounded join budget"
    );
    match value {
        serde_json::Value::Array(values) => {
            for value in values {
                enrich_moveset(conn, value, cache, depth + 1)?;
            }
        }
        serde_json::Value::Object(fields) => {
            let id = ["skillId", "skill_id", "skillID"]
                .iter()
                .find_map(|key| fields.get(*key)?.as_str())
                .map(str::to_owned);
            if let Some(id) = id {
                let skill = cached_skill(conn, cache, &id)?;
                fields.insert("resolved".into(), serde_json::json!(skill.is_some()));
                if let Some(skill) = skill {
                    for (key, value) in [
                        ("nameFr", &skill.name_fr),
                        ("nameEn", &skill.name_en),
                        ("nameJa", &skill.name_ja),
                        ("category", &skill.category),
                        ("element", &skill.element),
                    ] {
                        if let Some(value) = value {
                            fields
                                .entry(key)
                                .or_insert_with(|| serde_json::json!(value));
                        }
                    }
                    for (key, value) in [
                        ("powerMin", skill.power_min),
                        ("powerMax", skill.power_max),
                        ("tpCost", skill.tp_cost),
                    ] {
                        fields
                            .entry(key)
                            .or_insert_with(|| serde_json::json!(value));
                    }
                }
            } else {
                for value in fields.values_mut() {
                    enrich_moveset(conn, value, cache, depth + 1)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnedSkill {
    pub skill_id: String,
    pub learn_level: u32,
    pub resolved: bool,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub category: Option<String>,
    pub element: Option<String>,
    pub power_min: Option<i64>,
    pub power_max: Option<i64>,
    pub tp_cost: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterCard {
    pub character: CharaSummary,
    pub variants: Vec<CharaSummary>,
    pub gender: Option<String>,
    /// Source-authored movesets, without substituting another variant's progression.
    pub movesets: serde_json::Value,
    /// Native identity and icon references present in the source projection.
    pub assets: serde_json::Value,
    pub description_fr: Option<String>,
    pub description_en: Option<String>,
    pub team_name: Option<String>,
    pub series: Option<String>,
    pub zukan_hash: Option<String>,
    pub stats_lv1: Option<StatBlock>,
    pub stats_lv30: Option<StatBlock>,
    pub stats_lv50: Option<StatBlock>,
    pub stats_lv99: Option<StatBlock>,
    pub learned_skills: Vec<LearnedSkill>,
    pub auras: Vec<AuraSummary>,
}

/// Join an exact character ID to its existing learned-skill queries. Missing skill records
/// remain explicit; missing native stat anchors are never synthesized from other levels.
pub fn character(conn: &Connection, id: &str) -> anyhow::Result<Option<CharacterCard>> {
    let Some(profile) = crate::query::get_character(conn, id)? else {
        return Ok(None);
    };
    let variants = crate::query::search_characters(conn, &profile.chara_id)?
        .into_iter()
        .filter(|variant| variant.chara_id == profile.chara_id)
        .collect();
    let mut movesets = ["skillsAlternate", "skillsBasara", "movesets"]
        .into_iter()
        .filter_map(|key| {
            profile
                .merged
                .get(key)
                .cloned()
                .map(|value| (key.to_owned(), value))
        })
        .collect::<serde_json::Map<_, _>>();
    movesets.insert("skills".into(), serde_json::Value::Array(profile.skills.iter().map(|slot|
        serde_json::json!({"skillId":slot.skill_id,"learnLevel":slot.learn_level})
    ).collect()));
    let assets = ["icons", "image", "internalCode", "modelId"]
        .into_iter()
        .filter_map(|key| {
            profile
                .merged
                .get(key)
                .cloned()
                .map(|value| (key.to_owned(), value))
        })
        .collect::<serde_json::Map<_, _>>();
    anyhow::ensure!(
        profile.skills.len() <= 128,
        "Character skill list exceeds its bounded join budget"
    );
    let mut learned_skills = Vec::with_capacity(profile.skills.len());
    let mut skill_cache = SkillCache::new();
    for slot in profile.skills {
        let skill = cached_skill(conn, &mut skill_cache, &slot.skill_id)?;
        learned_skills.push(LearnedSkill {
            skill_id: slot.skill_id,
            learn_level: slot.learn_level,
            resolved: skill.is_some(),
            name_fr: skill.as_ref().and_then(|skill| skill.name_fr.clone()),
            name_en: skill.as_ref().and_then(|skill| skill.name_en.clone()),
            name_ja: skill.as_ref().and_then(|skill| skill.name_ja.clone()),
            category: skill.as_ref().and_then(|skill| skill.category.clone()),
            element: skill.as_ref().and_then(|skill| skill.element.clone()),
            power_min: skill.as_ref().and_then(|skill| skill.power_min),
            power_max: skill.as_ref().and_then(|skill| skill.power_max),
            tp_cost: skill.as_ref().and_then(|skill| skill.tp_cost),
        });
    }
    for moveset in movesets.values_mut() {
        enrich_moveset(conn, moveset, &mut skill_cache, 0)?;
    }
    Ok(Some(CharacterCard {
        variants,
        gender: profile.gender,
        movesets: serde_json::Value::Object(movesets),
        assets: serde_json::Value::Object(assets),
        character: CharaSummary {
            id: profile.id,
            chara_id: profile.chara_id,
            name_fr: profile.name_fr,
            name_en: profile.name_en,
            name_ja: profile.name_ja,
            element: profile.element,
            position: profile.position,
            rarity_label: profile.rarity_label,
            internal_code: profile.internal_code,
            slug: profile.slug,
            base_slug: profile.base_slug,
        },
        description_fr: profile.description_fr,
        description_en: profile.description_en,
        team_name: profile.team_name,
        series: profile.series,
        zukan_hash: profile.zukan_hash,
        stats_lv1: profile.stats_lv1,
        stats_lv30: profile.stats_lv30,
        stats_lv50: profile.stats_lv50,
        stats_lv99: profile.stats_lv99,
        learned_skills,
        auras: profile.auras,
    }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn moveset_metadata_resolves_hashes_without_replacing_source_fields() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE inagle_skills(id TEXT,name_fr TEXT,name_en TEXT,name_ja TEXT,category TEXT,element TEXT,power_max TEXT,power_min TEXT,tp_cost TEXT,description_fr TEXT,description_en TEXT,internal_code TEXT,is_hyper TEXT,data TEXT,sheet_data TEXT);
            INSERT INTO inagle_skills(id,name_fr,name_en,power_max,data) VALUES('native_code','Native name','English name','85','{\"skillID\":\"0x12345678\"}');").unwrap();
        let mut value = serde_json::json!({"normal":[{"skillId":"0x12345678","learnLevel":13,"sourceField":true},{"skillId":"missing","learnLevel":20}],"alternate":[{"skill_id":"0x12345678","nameFr":"Source name","learnLevel":30}]});
        let mut cache = super::SkillCache::new();
        super::enrich_moveset(&connection, &mut value, &mut cache, 0).unwrap();
        assert_eq!(cache.len(), 2);
        assert_eq!(value["normal"][0]["skillId"], "0x12345678");
        assert_eq!(value["normal"][0]["learnLevel"], 13);
        assert_eq!(value["normal"][0]["sourceField"], true);
        assert_eq!(value["normal"][0]["nameFr"], "Native name");
        assert_eq!(value["normal"][0]["powerMax"], 85);
        assert_eq!(value["normal"][1]["resolved"], false);
        assert_eq!(value["alternate"][0]["nameFr"], "Source name");
        assert_eq!(value["alternate"][0]["nameEn"], "English name");
    }

    #[test]
    #[ignore = "requires licensed mirror for the captured Byron BASARA identity"]
    fn byron_movesets_and_learned_skills_share_native_resolution() {
        let mirror = std::env::var("NIE_LEGACY_PARITY_MIRROR").expect("mirror");
        let connection = rusqlite::Connection::open_with_flags(
            mirror,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let card = super::character(&connection, "0x12B74634")
            .unwrap()
            .unwrap();
        assert_eq!(card.learned_skills.len(), 6);
        let slots = card.movesets["skills"].as_array().unwrap();
        assert_eq!(slots.len(), 6);
        for (slot, learned) in slots.iter().zip(&card.learned_skills) {
            assert!(learned.resolved);
            assert_eq!(slot["resolved"], true);
            assert_eq!(slot["skillId"], learned.skill_id);
            assert_eq!(slot["learnLevel"], learned.learn_level);
            assert_eq!(slot["nameFr"], learned.name_fr.as_deref().unwrap());
            assert_ne!(slot["nameFr"], slot["skillId"]);
        }
    }

    #[test]
    fn character_aliases_keep_variant_identity_and_source_movesets() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE inagle_characters (
            id TEXT,chara_id TEXT,name_fr TEXT,name_en TEXT,name_ja TEXT,element TEXT,position TEXT,
            rarity_label TEXT,internal_code TEXT,slug TEXT,base_slug TEXT,description_fr TEXT,
            description_en TEXT,gender TEXT,team_id TEXT,series TEXT,zukan_hash TEXT,data TEXT,
            sheet_data TEXT,skills TEXT,zukan_order TEXT);
            INSERT INTO inagle_characters VALUES ('v1','h1','Byron','Byron',NULL,'Forêt','Milieu','Normal',
                'c01001900','byron-v1','byron','Profile',NULL,'M',NULL,'IE',NULL,
                '{\"skills\":[],\"icons\":{\"small\":\"native_icon\"}}','{}','[]','2'),
                ('v2','h1','Byron','Byron',NULL,'Forêt','Milieu','BASARA','c01001900',
                'byron-v2','byron','Profile',NULL,'M',NULL,'IE',NULL,'{\"skills\":[]}','{}','[]','10');").unwrap();
        for alias in ["v1", "byron", "byron-v1", "c01001900", "h1"] {
            let card = super::character(&connection, alias).unwrap().unwrap();
            assert_eq!(card.character.id, "v1");
            assert_eq!(card.variants.len(), 2);
            assert_eq!(card.movesets["skills"], serde_json::json!([]));
            assert_eq!(card.assets["icons"]["small"], "native_icon");
        }
        assert_eq!(
            super::character(&connection, "byron-v2")
                .unwrap()
                .unwrap()
                .character
                .id,
            "v2"
        );
        assert!(super::character(&connection, "missing").unwrap().is_none());
    }
}
