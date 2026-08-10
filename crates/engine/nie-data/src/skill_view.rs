//! `SkillViewPresetConfig` — port Rust de la famille
//! `skill_view/skill_view_preset_config*.cfg.bin.json` (Level-5 IEVR).
//!
//! Presets d'affichage de compétence : le visualiseur de compétences (« skill view »)
//! met en scène un ou plusieurs personnages équipés (uniforme, chaussures, gants) pour
//! prévisualiser le rendu d'une compétence. Un *preset* nomme une plage de personnages
//! à afficher.
//!
//! ## Vérité terrain
//!
//! Deux fichiers dans `data/common/gamedata/skill_view/`, tous deux en format `lists`
//! (`version = 100`) avec deux listes :
//!
//! - `skill_view_preset_config.cfg.bin.json` (version de base) ;
//! - `skill_view_preset_config_0.00.28.cfg.bin.json` (golden principal, plus récente).
//!
//! Les deux fichiers ne diffèrent QUE par quelques `uniformId`/`shoesId` dans
//! `m_SkillViewPresetDataList` ; la liste des presets (`m_SkillViewPresetInfoList`)
//! est identique. La 0.00.28 met à jour les identifiants d'uniformes/chaussures
//! (ex. entrée 0 : `uniformId 0x26E5E3F1 → 0x47A6D3D3`, `shoesId 0x00000000 → 0xD233B8D6`).
//!
//! ### `m_SkillViewPresetDataList` (typeName `SKILL_VIEW_PRESET_DATA`)
//!
//! 17 entrées (champs nommés), CONSERVÉES POSITIONNELLEMENT — les presets les
//! référencent par plage `[offset, count]`, donc on ne filtre PAS les entrées à
//! `charaId = 0x00000000` (il y en a : indices 8, 14, 15 dans le dump réel).
//!
//! | Champ           | Type JSON  | Sémantique observée                              |
//! |-----------------|------------|--------------------------------------------------|
//! | `charaId`       | hex string | Hash du personnage affiché (0 = emplacement vide)|
//! | `skillType`     | integer    | Type de compétence (0 ou 1 ; sémantique inconnue)|
//! | `uniformId`     | hex string | Hash de l'uniforme équipé (0 = défaut)           |
//! | `shoesId`       | hex string | Hash des chaussures équipées (0 = aucune)        |
//! | `gloveId`       | hex string | Hash des gants équipés (0 = aucun ; gardien)     |
//! | `bAway`         | bool       | `true` si tenue extérieure (toujours `false`)    |
//! | `bKeeper`       | bool       | `true` si le personnage est gardien              |
//! | `uniformNumber` | integer    | Numéro de maillot affiché (0 si non défini)      |
//!
//! ### `m_SkillViewPresetInfoList` (typeName `SKILL_VIEW_PRESET_INFO`)
//!
//! 5 presets (champs nommés) :
//!
//! | Champ        | Type JSON      | Sémantique observée                               |
//! |--------------|----------------|---------------------------------------------------|
//! | `presetId`   | hex string     | Hash identifiant du preset                        |
//! | `presetName` | string (UTF-8) | Nom affiché (japonais, ex. `プリセット【base01】`)|
//! | `presetData` | `[offset, cnt]`| Plage dans `m_SkillViewPresetDataList`            |
//! | `bDefault`   | bool           | `true` pour le preset par défaut (un seul)        |
//!
//! ## Accesseurs
//!
//! - [`SkillViewPresetConfig::preset_data_of`] — résout la plage de
//!   [`SkillViewPresetData`] d'un preset (comme `folder_items_of` de `search_word`).
//! - [`SkillViewPresetConfig::find_preset`] — recherche un preset par `presetId`.
//! - [`SkillViewPresetConfig::default_preset`] — renvoie le preset marqué `bDefault`.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_bool, field_hash, field_i64, field_str, list_values, owned};
use crate::hash::HashId;

// ─── SkillViewPresetData ─────────────────────────────────────────────────────────

/// Entrée `SKILL_VIEW_PRESET_DATA` — un personnage équipé affiché dans le visualiseur.
///
/// Vérité terrain : `skill_view_preset_config_0.00.28.cfg.bin.json`,
/// liste `m_SkillViewPresetDataList` (17 entrées). Les entrées à `charaId = 0`
/// sont conservées (emplacements vides référencés par plage).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SkillViewPresetData {
    /// `charaId` — hash du personnage affiché (`0x00000000` = emplacement vide).
    ///
    /// Vérité terrain (0.00.28) : `m_SkillViewPresetDataList[0].charaId = "0xB7127F3A"`.
    pub chara_id: HashId,
    /// `skillType` — type de compétence (valeurs observées : 0 ou 1 ; sémantique inconnue
    /// sans source TS inagle).
    pub skill_type: i64,
    /// `uniformId` — hash de l'uniforme équipé (`0x00000000` = uniforme par défaut).
    ///
    /// Vérité terrain (0.00.28) : `m_SkillViewPresetDataList[0].uniformId = "0x47A6D3D3"`
    /// (valait `"0x26E5E3F1"` dans la version de base).
    pub uniform_id: HashId,
    /// `shoesId` — hash des chaussures équipées (`0x00000000` = aucune).
    ///
    /// Vérité terrain (0.00.28) : `m_SkillViewPresetDataList[0].shoesId = "0xD233B8D6"`
    /// (valait `"0x00000000"` dans la version de base).
    pub shoes_id: HashId,
    /// `gloveId` — hash des gants équipés (`0x00000000` = aucun ; non nul pour les gardiens).
    pub glove_id: HashId,
    /// `bAway` — `true` si tenue extérieure (toujours `false` dans les dumps réels).
    pub b_away: bool,
    /// `bKeeper` — `true` si le personnage affiché est gardien.
    pub b_keeper: bool,
    /// `uniformNumber` — numéro de maillot affiché (0 si non défini).
    pub uniform_number: i64,
}

impl SkillViewPresetData {
    /// Parse une entrée de `m_SkillViewPresetDataList`.
    ///
    /// Renvoie toujours `Some` : les entrées sont positionnelles (référencées par plage),
    /// y compris celles à `charaId = 0`, donc on n'en filtre aucune.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            chara_id: field_hash(v, "charaId"),
            skill_type: field_i64(v, "skillType").unwrap_or(0),
            uniform_id: field_hash(v, "uniformId"),
            shoes_id: field_hash(v, "shoesId"),
            glove_id: field_hash(v, "gloveId"),
            b_away: field_bool(v, "bAway").unwrap_or(false),
            b_keeper: field_bool(v, "bKeeper").unwrap_or(false),
            uniform_number: field_i64(v, "uniformNumber").unwrap_or(0),
        }
    }
}

// ─── SkillViewPresetInfo ─────────────────────────────────────────────────────────

/// Entrée `SKILL_VIEW_PRESET_INFO` — un preset nommé pointant une plage de personnages.
///
/// `data_offset` + `data_count` (issus de `presetData = [offset, count]`) référencent une
/// tranche de `m_SkillViewPresetDataList` — utiliser
/// [`SkillViewPresetConfig::preset_data_of`] pour la résoudre.
///
/// Vérité terrain : `skill_view_preset_config_0.00.28.cfg.bin.json`
/// `m_SkillViewPresetInfoList[0]` :
/// - `presetId = 0x6744A776`, `presetName = "プリセット【base01】"`,
///   `presetData = [0, 6]` → offset=0, count=6, `bDefault = true`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SkillViewPresetInfo {
    /// `presetId` — hash identifiant du preset.
    pub preset_id: HashId,
    /// `presetName` — nom affiché du preset (UTF-8 japonais ; typos Level-5 préservées).
    pub preset_name: String,
    /// `presetData[0]` — index de début dans `m_SkillViewPresetDataList`.
    pub data_offset: i64,
    /// `presetData[1]` — nombre d'entrées de ce preset.
    pub data_count: i64,
    /// `bDefault` — `true` pour le preset par défaut (un seul dans le dump réel).
    pub b_default: bool,
}

impl SkillViewPresetInfo {
    /// Parse une entrée de `m_SkillViewPresetInfoList`. `None` si `presetId` est nul.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let preset_id = field_hash(v, "presetId");
        if preset_id.is_zero() {
            return None;
        }
        let pd = v.get("presetData").and_then(Value::as_array);
        Some(Self {
            preset_id,
            preset_name: owned(field_str(v, "presetName").unwrap_or("")),
            data_offset: pd
                .and_then(|a| a.first())
                .and_then(Value::as_i64)
                .unwrap_or(0),
            data_count: pd
                .and_then(|a| a.get(1))
                .and_then(Value::as_i64)
                .unwrap_or(0),
            b_default: field_bool(v, "bDefault").unwrap_or(false),
        })
    }
}

// ─── SkillViewPresetConfig ───────────────────────────────────────────────────────

/// Contenu complet d'un `skill_view_preset_config*.cfg.bin.json` (2 listes).
///
/// Utiliser [`parse_skill_view_preset_config`] pour construire depuis un JSON désérialisé.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SkillViewPresetConfig {
    /// `m_SkillViewPresetDataList` — 17 personnages équipés (conservés positionnellement).
    pub preset_data: Vec<SkillViewPresetData>,
    /// `m_SkillViewPresetInfoList` — 5 presets nommés.
    pub presets: Vec<SkillViewPresetInfo>,
}

impl SkillViewPresetConfig {
    /// Renvoie la tranche de [`SkillViewPresetData`] appartenant à un preset.
    ///
    /// Retourne `&[]` si la plage dépasse la taille de la liste.
    #[must_use]
    pub fn preset_data_of(&self, info: &SkillViewPresetInfo) -> &[SkillViewPresetData] {
        let start = info.data_offset as usize;
        let end = start.saturating_add(info.data_count as usize);
        self.preset_data.get(start..end).unwrap_or(&[])
    }

    /// Recherche un [`SkillViewPresetInfo`] par `preset_id`. `None` si absent.
    #[must_use]
    pub fn find_preset(&self, preset_id: HashId) -> Option<&SkillViewPresetInfo> {
        self.presets.iter().find(|p| p.preset_id == preset_id)
    }

    /// Renvoie le preset marqué `bDefault`, ou `None` s'il n'y en a aucun.
    #[must_use]
    pub fn default_preset(&self) -> Option<&SkillViewPresetInfo> {
        self.presets.iter().find(|p| p.b_default)
    }
}

// ─── Parseur principal ───────────────────────────────────────────────────────────

/// Parse un `skill_view_preset_config*.cfg.bin.json` complet (2 listes).
///
/// Renvoie un [`SkillViewPresetConfig`]. Les entrées de `m_SkillViewPresetDataList`
/// sont TOUTES conservées (positionnelles) ; les presets à `presetId` nul sont ignorés.
///
/// Compte réel : `skill_view_preset_config_0.00.28.cfg.bin.json` →
/// 17 `SkillViewPresetData`, 5 `SkillViewPresetInfo`.
#[must_use]
pub fn parse_skill_view_preset_config(root: &Value) -> SkillViewPresetConfig {
    let preset_data = list_values(root, "m_SkillViewPresetDataList")
        .map(|values| values.iter().map(SkillViewPresetData::from_value).collect())
        .unwrap_or_default();

    let mut presets = Vec::new();
    if let Some(values) = list_values(root, "m_SkillViewPresetInfoList") {
        for v in values {
            if let Some(info) = SkillViewPresetInfo::from_value(v) {
                presets.push(info);
            }
        }
    }

    SkillViewPresetConfig {
        preset_data,
        presets,
    }
}
