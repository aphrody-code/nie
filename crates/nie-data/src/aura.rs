//! `AuraCmd` — port du noeud `AURA_CMD_INFO_*` de l'`aura_skill_config` + résolution hissatsu.
//!
//! ## Vérité terrain
//!
//! - Parser TS : `packages/inagle/src/skills/mapper-aura.ts` (`parseAuraCmdInfo` l.389-469,
//!   `determineSubType` l.232-293, `resolveAuraHissatsu` l.181-216, `getElement` l.320-329).
//! - Données : `/home/ubuntu/niers/data/common/gamedata/skill/aura_skill_config_1.04.09.00.cfg.bin.json`.
//!
//! Noeud vérifié `AURA_CMD_INFO_0` (19 vars) :
//! `[2037965306, "wks00020", 493403631, -1653680409, 30, 60, 260858381, -1368456794, 3, 8, 0,
//!   1, -1124324279, 0, 0, 0, 1, 0, 0]`
//! → auraId = `0x7978E1FA` (2037965306 >>> 0), assetCode = `wks00020`, skillId1 (var6) =
//!   `0x0F8C620D` (260858381), element (var8) = 3 (Feu), subType = Keshin (préfixe `wks`).
//!
//! Note : dans CE dump, `skillId1` ne résout vers aucune entrée de `skill_config_4/5` →
//! `resolve_aura_hissatsu` renvoie `None` (pas d'invention, comme le TS). La résolution
//! native `config.skillId1 → SkillInfo` (commit inagle « hissatsu auras 100% natif ») est
//! néanmoins implémentée et testée avec une carte de skills construite.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{owned, walk_named, Node};
use crate::hash::HashId;
use crate::skill::{SkillCategory, SkillElement, SkillInfo};

/// Sous-type d'aura, dérivé du préfixe d'`assetCode`. Source : `determineSubType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum AuraSubType {
    /// Esprit Guerrier (wks/wko/wkk/wkd/wkt/was).
    Keshin,
    /// Totem (nom contenant « totem »/« soul » sur asset wks).
    Soul,
    /// Éveil (asset `awakening`).
    Awakening,
    /// Mode (asset `mode_change`).
    ModeChange,
    /// Miximax (asset `wm*`/`wmm`).
    Miximax,
    /// Aura générique (défaut).
    Aura,
}

impl AuraSubType {
    /// Libellé FR. Source : `getSubTypeLabel` (mapper-aura.ts).
    #[must_use]
    pub fn label_fr(self) -> &'static str {
        match self {
            Self::Keshin => "Esprit Guerrier",
            Self::Soul => "Totem",
            Self::Awakening => "Éveil",
            Self::ModeChange => "Mode",
            Self::Miximax => "Miximax",
            Self::Aura => "Aura",
        }
    }
}

/// Détermine le sous-type depuis l'`assetCode` (et, optionnellement, le nom FR).
///
/// Port strict de la cascade de priorités de `determineSubType` (priorité 1 : codes asset) :
/// `wks` → Soul si le nom contient « totem »/« soul », sinon Keshin ; `awakening` → Awakening ;
/// `mode_change` → ModeChange ; `wm`/`mixi` → Miximax ; `wko`/`wkk`/`wkd`/`wkt`/`was` → Keshin ;
/// sinon Aura (les heuristiques texte priorité 2/3 sont volontairement minimales ici).
#[must_use]
pub fn determine_sub_type(asset_code: &str, name_fr: Option<&str>) -> AuraSubType {
    let a = ascii_lower(asset_code);
    let n = name_fr.map(ascii_lower).unwrap_or_default();

    if a.starts_with("wks") {
        if n.contains("totem") || n.contains("soul") {
            return AuraSubType::Soul;
        }
        return AuraSubType::Keshin;
    }
    if a.starts_with("awakening") {
        return AuraSubType::Awakening;
    }
    if a.starts_with("mode_change") {
        return AuraSubType::ModeChange;
    }
    if a.starts_with("wm") || a.contains("mixi") {
        return AuraSubType::Miximax;
    }
    if a.starts_with("wko")
        || a.starts_with("wkk")
        || a.starts_with("wkd")
        || a.starts_with("wkt")
        || a.starts_with("was")
    {
        return AuraSubType::Keshin;
    }
    AuraSubType::Aura
}

/// Sous-config extraite des variables de l'aura. Source : `parseAuraCmdInfo` (config{}).
/// Les `0`/`0x00000000` sont omis (`None`) comme côté TS.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AuraConfig {
    pub val4: Option<i64>,
    pub val5: Option<i64>,
    /// var6 — skill principal résolu par `resolve_aura_hissatsu`.
    pub skill_id1: Option<HashId>,
    /// var7 — skill de secours.
    pub skill_id2: Option<HashId>,
    pub val9: Option<i64>,
    pub val11: Option<i64>,
    /// var12 — buff associé.
    pub buff_id: Option<HashId>,
    /// var16 — rang.
    pub rank: Option<i64>,
}

/// Un noeud `AURA_CMD_INFO_*` porté.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AuraCmd {
    /// var0 — `auraId`.
    pub aura_id: HashId,
    /// var1 — `assetCode` (ex. `wks00020`).
    pub asset_code: String,
    /// var2 — `nameId`.
    pub name_id: HashId,
    /// var3 — `descId`.
    pub desc_id: HashId,
    /// var8 — élément ∈ [0,4] (0 si hors plage).
    pub element: i64,
    /// Sous-type dérivé de l'`assetCode`.
    pub sub_type: AuraSubType,
    /// Sous-config (skillId1/2, buff, rank, …).
    pub config: AuraConfig,
}

impl AuraCmd {
    /// Élément typé.
    #[must_use]
    pub fn element(&self) -> SkillElement {
        SkillElement::from_id(self.element)
    }

    /// Parse un noeud `AURA_CMD_INFO_*`. `None` si moins de 4 variables (comme le TS).
    #[must_use]
    pub fn from_node(node: Node<'_>) -> Option<Self> {
        if node.var_count() < 4 {
            return None;
        }
        let aura_id = node.hash(0);
        let asset_code = owned(node.string(1));
        let name_id = node.hash(2);
        let desc_id = node.hash(3);
        let element = get_element(node);
        let sub_type = determine_sub_type(&asset_code, None);

        // Sous-config : Int non nuls, hash non nuls.
        let int_opt = |i: usize| -> Option<i64> {
            let v = node.int(i);
            if v != 0 {
                Some(v)
            } else {
                None
            }
        };
        let hash_opt = |i: usize| -> Option<HashId> {
            let h = node.hash(i);
            if h.is_zero() {
                None
            } else {
                Some(h)
            }
        };

        let config = AuraConfig {
            val4: int_opt(4),
            val5: int_opt(5),
            skill_id1: hash_opt(6),
            skill_id2: hash_opt(7),
            val9: int_opt(9),
            val11: int_opt(11),
            buff_id: hash_opt(12),
            rank: int_opt(16),
        };

        Some(AuraCmd {
            aura_id,
            asset_code,
            name_id,
            desc_id,
            element,
            sub_type,
            config,
        })
    }
}

/// Extrait l'élément depuis var8 si ∈ [0,4], sinon 0. Source : `getElement` (mapper-aura.ts l.320-329).
fn get_element(node: Node<'_>) -> i64 {
    if node.var_count() > 8
        && let Some(v) = node.var(8)
        && v.ty == "Int"
    {
        let val = v.as_i64();
        if (0..=4).contains(&val) {
            return val;
        }
    }
    0
}

/// Hissatsu (technique spéciale) résolu nativement depuis l'aura. Source : `AuraHissatsu` (TS).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AuraHissatsu {
    /// Hash de la technique résolue.
    pub skill_id: HashId,
    /// Code interne (`whs00010`).
    pub skill_id_str: Option<String>,
    /// Catégorie typée.
    pub category: SkillCategory,
    /// Élément typé.
    pub element: SkillElement,
    /// Puissance (min, max).
    pub power: (i64, i64),
}

/// Résout le hissatsu d'une aura : suit `config.skillId1` (fallback `skillId2`) vers la carte
/// de `SkillInfo` (= `skill_config`). Renvoie `None` si aucun skillId résoluble (pas d'invention).
///
/// Port de `resolveAuraHissatsu` (mapper-aura.ts l.181-216). C'est la résolution native
/// `config.skillId1 → skill_config` du commit inagle « hissatsu auras 100% natif ».
#[must_use]
pub fn resolve_aura_hissatsu(
    config: &AuraConfig,
    skill_map: &BTreeMap<HashId, SkillInfo>,
) -> Option<AuraHissatsu> {
    for candidate in [config.skill_id1, config.skill_id2].into_iter().flatten() {
        if candidate.is_zero() {
            continue;
        }
        if let Some(skill) = skill_map.get(&candidate) {
            return Some(AuraHissatsu {
                skill_id: candidate,
                skill_id_str: if skill.skill_id_str.is_empty() {
                    None
                } else {
                    Some(skill.skill_id_str.clone())
                },
                category: skill.category(),
                element: skill.element(),
                power: (skill.power_min, skill.power_max),
            });
        }
    }
    None
}

/// Parse tous les noeuds `AURA_CMD_INFO_*` d'un `aura_skill_config_*.cfg.bin.json` désérialisé.
#[must_use]
pub fn parse_all_aura_cmds(root: &Value) -> Vec<AuraCmd> {
    let mut out = Vec::new();
    walk_named(root, "AURA_CMD_INFO_", |node| {
        if node.name().contains("_LIST_") {
            return;
        }
        if let Some(a) = AuraCmd::from_node(node) {
            out.push(a);
        }
    });
    out
}

/// Construit une carte `skillID → SkillInfo` (clé de résolution hissatsu) depuis une liste de skills.
#[must_use]
pub fn build_skill_map(skills: Vec<SkillInfo>) -> BTreeMap<HashId, SkillInfo> {
    let mut map = BTreeMap::new();
    for s in skills {
        map.entry(s.skill_id).or_insert(s);
    }
    map
}

/// Minuscule ASCII (les `assetCode`/préfixes sont ASCII). Évite la dépendance à `to_lowercase` Unicode.
fn ascii_lower(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        out.push(c.to_ascii_lowercase());
    }
    out
}
