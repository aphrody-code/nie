//! `change_aura_skill_config` — port du fichier `skill/change_aura_skill_config_*.cfg.bin` :
//! la table de **remplacement d'aura** (quelle aura/esprit guerrier un personnage donné
//! déclenche à la place de l'aura générique).
//!
//! ## Vérité terrain
//!
//! - Dump réel (VFS) : `data/common/gamedata/skill/change_aura_skill_config_1.01.73.00.cfg.bin`.
//! - Format **RDBN à listes** (`{ "lists": [ { "name", "typeName", "values" } ] }`), décodé en
//!   forme iecode par `nie-model-serve::cfgbin_to_iecode_root`.
//! - Référence de portage : `packages/inagle/src/parsers/change-aura-skill-config.ts`
//!   (`parseContent` l.45-66, `buildChangeAuraSkillDatabase` l.81-100).
//!
//! Ce fichier est **distinct** de `aura_skill_config` (noeuds `AURA_CMD_INFO_*`, porté par le
//! module [`crate::aura`]) : il ne décrit pas les auras elles-mêmes, mais leurs surcharges
//! par personnage.
//!
//! ## Les deux listes du fichier
//!
//! | Liste                           | Type                       | Lignes | Champs              |
//! |---------------------------------|----------------------------|--------|---------------------|
//! | `m_ChangeAuraSkillDataList`     | `CHANGE_AURA_SKILL_DATA`   | 227    | `id`, `charaParamId` (hex) |
//! | `m_ChangeAuraSkillInfoList`     | `CHANGE_AURA_SKILL_INFO`   | 96     | `id` (hex), `data` (2 ints) |
//!
//! - **`m_ChangeAuraSkillDataList`** : une règle de remplacement par ligne. `id` = identifiant de
//!   la *change-aura skill*, `charaParamId` = personnage lié (`0x00000000` = règle générique, sans
//!   personnage particulier — port fidèle de la sentinelle inagle `"0x00000000"`).
//! - **`m_ChangeAuraSkillInfoList`** : info par aura. `id` = identifiant de l'aura ; `data` est un
//!   couple `[offset, count]` qui **indexe** `m_ChangeAuraSkillDataList` (partition contiguë
//!   vérifiée sur le dump : `offset[0]=0`, `offset[i+1]=offset[i]+count[i]`, somme finale = 227).
//!   inagle conserve cette info **brute** (`info: ChangeAuraSkillInfo[]`, `[key]: any`) ; on
//!   l'expose typée + une résolution native du slice ([`ChangeAuraSkillDatabase::slice_for_info`]).

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, list_values};
use crate::hash::HashId;

/// Sentinelle inagle d'un `charaParamId` générique (aucun personnage lié) : `HashId::ZERO`
/// (= la chaîne `"0x00000000"` du dump).
pub const GENERIC_CHARA_PARAM: HashId = HashId::ZERO;

// ─── ChangeAuraSkillData ──────────────────────────────────────────────────────────

/// Une ligne `CHANGE_AURA_SKILL_DATA` : une règle « change-aura skill → personnage ».
///
/// Vérité terrain (1re ligne du dump) : `id="0xDD08BEB4", charaParamId="0x7AB4BBF3"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ChangeAuraSkillData {
    /// `id` — identifiant (hash) de la change-aura skill.
    pub id: HashId,
    /// `charaParamId` — personnage lié à cette aura ([`GENERIC_CHARA_PARAM`] si générique).
    pub chara_param_id: HashId,
}

impl ChangeAuraSkillData {
    /// Construit la règle depuis un objet `values[]` (forme iecode). Port 1:1 d'inagle
    /// `parseContent` (l.54-57) : recopie `id` et `charaParamId` tels quels.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            id: field_hash(v, "id"),
            chara_param_id: field_hash(v, "charaParamId"),
        }
    }

    /// `true` si la règle est générique (`charaParamId == 0x00000000`), c.-à-d. non liée à un
    /// personnage précis. Port de la comparaison inagle `charaParamId !== "0x00000000"`.
    #[must_use]
    pub fn is_generic(&self) -> bool {
        self.chara_param_id.is_zero()
    }
}

// ─── ChangeAuraSkillInfo ──────────────────────────────────────────────────────────

/// Une ligne `CHANGE_AURA_SKILL_INFO` : info par aura, conservée **brute** (comme inagle).
///
/// Vérité terrain (1re ligne du dump) : `id="0x7978E1FA", data=[0, 5]`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ChangeAuraSkillInfo {
    /// `id` — identifiant (hash) de l'aura (correspond à un `auraId` d'`aura_skill_config`).
    pub id: HashId,
    /// `data` — données brutes ; sur le dump réel un couple `[offset, count]` indexant
    /// `m_ChangeAuraSkillDataList` (cf. [`ChangeAuraSkillDatabase::slice_for_info`]).
    pub data: Vec<i64>,
}

impl ChangeAuraSkillInfo {
    /// Construit l'info depuis un objet `values[]`. Port 1:1 d'inagle `parseContent` (l.60-61),
    /// qui pousse l'objet brut ; ici on isole `id` + le tableau `data`.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        let data = v
            .get("data")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|x| x.as_i64().unwrap_or(0)).collect())
            .unwrap_or_default();
        Self {
            id: field_hash(v, "id"),
            data,
        }
    }

    /// Offset observé dans `m_ChangeAuraSkillDataList` (`data[0]`, négatif ⇒ 0). Interprétation
    /// vérifiée sur le dump (partition contiguë), pas dans inagle qui garde `data` brut.
    #[must_use]
    pub fn data_offset(&self) -> usize {
        self.data.first().copied().filter(|&n| n >= 0).unwrap_or(0) as usize
    }

    /// Nombre d'entrées du slice (`data[1]`, négatif ⇒ 0). Même remarque que [`Self::data_offset`].
    #[must_use]
    pub fn data_count(&self) -> usize {
        self.data.get(1).copied().filter(|&n| n >= 0).unwrap_or(0) as usize
    }
}

// ─── ChangeAuraSkillDatabase ──────────────────────────────────────────────────────

/// Contenu complet d'un `change_aura_skill_config_*.cfg.bin` : la liste des règles + la liste
/// des infos d'aura. Construire via [`parse_change_aura_skill_config`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ChangeAuraSkillDatabase {
    /// Toutes les règles `m_ChangeAuraSkillDataList` (227 sur le dump réel).
    pub data: Vec<ChangeAuraSkillData>,
    /// Toutes les infos `m_ChangeAuraSkillInfoList` (96 sur le dump réel).
    pub info: Vec<ChangeAuraSkillInfo>,
}

impl ChangeAuraSkillDatabase {
    /// Personnage lié à une change-aura skill, ou `None` si générique/inconnu.
    ///
    /// Port 1:1 d'inagle `getCharaForSkill` (l.95-98) : `bySkillId` est construit par
    /// `Map.set` (l.89) donc la **dernière** ligne d'un même `id` l'emporte ; on reproduit ce
    /// « last-write-wins » via `.rev().find(...)`. Renvoie le `charaParamId` seulement s'il est
    /// non générique (`!= 0x00000000`).
    #[must_use]
    pub fn get_chara_for_skill(&self, skill_id: HashId) -> Option<HashId> {
        let entry = self.data.iter().rev().find(|d| d.id == skill_id)?;
        if entry.chara_param_id.is_zero() {
            None
        } else {
            Some(entry.chara_param_id)
        }
    }

    /// Slice de `m_ChangeAuraSkillDataList` désigné par une info (`[offset, count]`).
    ///
    /// Renvoie un slice vide si l'intervalle déborde `data`. Résolution native (hors inagle),
    /// validée sur le dump : la partition `[offset, count]` couvre exactement les 227 lignes.
    #[must_use]
    pub fn slice_for_info(&self, info: &ChangeAuraSkillInfo) -> &[ChangeAuraSkillData] {
        let start = info.data_offset();
        let end = start.saturating_add(info.data_count());
        self.data.get(start..end).unwrap_or(&[])
    }
}

// ─── Parseur principal ─────────────────────────────────────────────────────────────

/// Parse un `change_aura_skill_config_*.cfg.bin` complet (forme iecode `{ "lists": [...] }`).
///
/// Port 1:1 d'inagle `parseContent` (`change-aura-skill-config.ts` l.45-66) : itère les deux
/// listes nommées ; les listes absentes donnent des `Vec` vides (comme `if (!content?.lists)`).
#[must_use]
pub fn parse_change_aura_skill_config(root: &Value) -> ChangeAuraSkillDatabase {
    let data = list_values(root, "m_ChangeAuraSkillDataList")
        .map(|vals| vals.iter().map(ChangeAuraSkillData::from_value).collect())
        .unwrap_or_default();
    let info = list_values(root, "m_ChangeAuraSkillInfoList")
        .map(|vals| vals.iter().map(ChangeAuraSkillInfo::from_value).collect())
        .unwrap_or_default();
    ChangeAuraSkillDatabase { data, info }
}
