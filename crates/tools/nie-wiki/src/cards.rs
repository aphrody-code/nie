//! Typed joined wiki cards for all hosts. Existing query owners perform every database read.
use crate::model::{AuraSummary, CharaSummary, StatBlock};
use rusqlite::Connection;
use serde::Serialize;

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
    anyhow::ensure!(
        profile.skills.len() <= 128,
        "Character skill list exceeds its bounded join budget"
    );
    let mut learned_skills = Vec::with_capacity(profile.skills.len());
    for slot in profile.skills {
        let skill = crate::query::get_skill(conn, &slot.skill_id)?;
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
    Ok(Some(CharacterCard {
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
