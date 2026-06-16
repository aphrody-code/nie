//! `override_skill.rs` — port de `override_skill_config_*.cfg.bin` (DLC Orion : surcharge
//! de compétences / « Skill Override »).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `data/common/gamedata/skill/override_skill_config_3.00.21.00.cfg.bin`
//!   (monté depuis le VFS Steam d'IEVR ; 1809 octets, format **RDBN à listes**).
//! - Port 1:1 d'inagle `packages/inagle/src/parsers/override-skill-config.ts`.
//!
//! ## Système Orion
//!
//! Une compétence de surcharge (« override ») s'active en combat lorsqu'un ensemble de
//! conditions de compétences équipées est satisfait : posséder certaines compétences peut
//! transformer/améliorer une compétence en une version plus puissante.
//!
//! ## Structure (3 listes RDBN reliées par des refs `[startIndex, count]`)
//!
//! | Liste | Type | Entrées (dump réel) | Champs |
//! |-------|------|---------------------|--------|
//! | `m_OverrideConditionSkillInfoList` | `OverrideConditionSkillInfo` | 61 | `skillId` (hash), `num` |
//! | `m_OverrideConditionInfoList` | `OverrideConditionInfo` | 33 | `conditionType`, `refConditionSkillData` `[start, count]` |
//! | `m_OverrideSkillInfoList` | `OverrideSkillInfo` | 33 | `overrideSkillId` (hash), `refConditionData` `[start, count]` |
//!
//! Chaîne de résolution : `override` → tranche de `conditions` → tranche de `conditionSkills`.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, list_values};
use crate::hash::HashId;

// ─── OverrideConditionSkillInfo ───────────────────────────────────────────────

/// Compétence requise pour qu'une surcharge se déclenche (`m_OverrideConditionSkillInfoList`).
///
/// Vérité terrain : `[0]` = `{ num: 1, skillId: 0x2CFC3E63 }` ;
/// `[23]` = `{ num: 3, skillId: 0x518BCA26 }` (le `num` peut valoir 1 à 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct OverrideConditionSkillInfo {
    /// `skillId` — identifiant de la compétence (hash CRC, hex non signé).
    pub skill_id: HashId,
    /// `num` — nombre requis de cette compétence (généralement 1, parfois 2 à 4).
    pub num: i64,
}

// ─── OverrideConditionInfo ────────────────────────────────────────────────────

/// Groupe de conditions référençant une tranche de [`OverrideConditionSkillInfo`]
/// (`m_OverrideConditionInfoList`).
///
/// Vérité terrain : `[0]` = `{ conditionType: 2, refConditionSkillData: [0, 2] }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct OverrideConditionInfo {
    /// `conditionType` — type de condition (0 = vérif. compétence individuelle, 2 = combo/équipe).
    pub condition_type: i64,
    /// `refConditionSkillData` — référence `[startIndex, count]` dans `condition_skills`.
    pub ref_condition_skill_data: [i64; 2],
}

// ─── OverrideSkillInfo ────────────────────────────────────────────────────────

/// Compétence de surcharge produite quand les conditions sont satisfaites
/// (`m_OverrideSkillInfoList`).
///
/// Vérité terrain : `[0]` = `{ overrideSkillId: 0xBAA40F86, refConditionData: [0, 1] }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct OverrideSkillInfo {
    /// `overrideSkillId` — identifiant de la compétence de surcharge (hash CRC).
    pub override_skill_id: HashId,
    /// `refConditionData` — référence `[startIndex, count]` dans `conditions`.
    pub ref_condition_data: [i64; 2],
}

// ─── Résolution ───────────────────────────────────────────────────────────────

/// Une condition résolue : son type + toutes les compétences requises (déréférencées).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ResolvedCondition {
    /// Type de condition (cf. [`OverrideConditionInfo::condition_type`]).
    pub condition_type: i64,
    /// Compétences requises pour satisfaire cette condition.
    pub required_skills: Vec<OverrideConditionSkillInfo>,
}

/// Une surcharge entièrement résolue : la compétence + ses conditions d'activation.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ResolvedOverride {
    /// Identifiant de la compétence de surcharge.
    pub override_skill_id: HashId,
    /// Conditions nécessaires à l'activation de cette surcharge.
    pub conditions: Vec<ResolvedCondition>,
}

// ─── Base de données complète ─────────────────────────────────────────────────

/// Contenu complet d'un `override_skill_config_*.cfg.bin`.
///
/// Utiliser [`parse_override_skill_config`] pour construire depuis un JSON désérialisé.
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct OverrideSkillDatabase {
    /// 61 compétences-conditions (`m_OverrideConditionSkillInfoList`).
    pub condition_skills: Vec<OverrideConditionSkillInfo>,
    /// 33 groupes de conditions (`m_OverrideConditionInfoList`).
    pub conditions: Vec<OverrideConditionInfo>,
    /// 33 compétences de surcharge (`m_OverrideSkillInfoList`).
    pub overrides: Vec<OverrideSkillInfo>,
    /// Surcharges résolues, refs entièrement déréférencées (override → conditions → compétences).
    pub resolved: Vec<ResolvedOverride>,
}

/// Lit un champ « tuple » `[startIndex, count]` (encodé `ShortTuple` → tableau JSON `[a, b]`).
/// Renvoie `[0, 0]` si absent ou mal formé — sémantique tolérante identique aux autres helpers.
fn field_pair(v: &Value, key: &str) -> [i64; 2] {
    if let Some(arr) = v.get(key).and_then(Value::as_array) {
        let a = arr.first().and_then(Value::as_i64).unwrap_or(0);
        let b = arr.get(1).and_then(Value::as_i64).unwrap_or(0);
        [a, b]
    } else {
        [0, 0]
    }
}

/// Parse un `override_skill_config_*.cfg.bin` (forme iecode RDBN `{ "lists": [...] }`).
///
/// Port 1:1 d'inagle `override-skill-config.ts` (`parseContent`) : remplit les trois listes
/// puis résout les références `override → conditions → conditionSkills`, en préservant les
/// gardes de bornes exactes (`i < conditions.len()`, `j < condition_skills.len()`).
///
/// Comptes réels (`override_skill_config_3.00.21.00.cfg.bin`) :
/// 61 `condition_skills`, 33 `conditions`, 33 `overrides`, 33 `resolved`.
#[must_use]
pub fn parse_override_skill_config(root: &Value) -> OverrideSkillDatabase {
    let mut condition_skills = Vec::new();
    if let Some(values) = list_values(root, "m_OverrideConditionSkillInfoList") {
        for val in values {
            condition_skills.push(OverrideConditionSkillInfo {
                skill_id: field_hash(val, "skillId"),
                num: field_i64(val, "num").unwrap_or(0),
            });
        }
    }

    let mut conditions = Vec::new();
    if let Some(values) = list_values(root, "m_OverrideConditionInfoList") {
        for val in values {
            conditions.push(OverrideConditionInfo {
                condition_type: field_i64(val, "conditionType").unwrap_or(0),
                ref_condition_skill_data: field_pair(val, "refConditionSkillData"),
            });
        }
    }

    let mut overrides = Vec::new();
    if let Some(values) = list_values(root, "m_OverrideSkillInfoList") {
        for val in values {
            overrides.push(OverrideSkillInfo {
                override_skill_id: field_hash(val, "overrideSkillId"),
                ref_condition_data: field_pair(val, "refConditionData"),
            });
        }
    }

    // Résolution des références : override → conditions → compétences (port 1:1 inagle l.107-131).
    let mut resolved = Vec::with_capacity(overrides.len());
    for ov in &overrides {
        let [cond_start, cond_count] = ov.ref_condition_data;
        let mut resolved_conditions = Vec::new();

        let cond_start = cond_start.max(0) as usize;
        let cond_end = cond_start.saturating_add(cond_count.max(0) as usize);
        for cond in conditions.iter().take(cond_end).skip(cond_start) {
            let [skill_start, skill_count] = cond.ref_condition_skill_data;
            let skill_start = skill_start.max(0) as usize;
            let skill_end = skill_start.saturating_add(skill_count.max(0) as usize);
            let required_skills: Vec<OverrideConditionSkillInfo> = condition_skills
                .iter()
                .take(skill_end)
                .skip(skill_start)
                .copied()
                .collect();
            resolved_conditions.push(ResolvedCondition {
                condition_type: cond.condition_type,
                required_skills,
            });
        }

        resolved.push(ResolvedOverride {
            override_skill_id: ov.override_skill_id,
            conditions: resolved_conditions,
        });
    }

    OverrideSkillDatabase {
        condition_skills,
        conditions,
        overrides,
        resolved,
    }
}
