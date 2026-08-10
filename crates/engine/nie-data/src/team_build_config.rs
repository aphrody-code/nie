//! Famille `team_build_config` (système « Team Build » du DLC Orion) — port Rust du
//! `team_build_config_*.cfg.bin` d'IEVR.
//!
//! ## Vérité terrain
//!
//! - Fichier source (VFS) :
//!   `data/common/gamedata/skill/team_build_config_6.00.23.cfg.bin`
//!   (monté depuis `/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN
//!   Victory Road`, décodé en forme iecode `entries`/`children`/`variables`).
//! - Parseur TS de référence (port 1:1) :
//!   `packages/inagle/src/parsers/team-build-config.ts`.
//!
//! ## Structure (format `entries` à listes nommées)
//!
//! Un seul fichier (hors familles `character`/`event`). Cinq listes, chacune portée par un
//! noeud de premier niveau `TEAM_BUILD_*_LIST_BEG` dont les `children` sont les entrées :
//!
//! | Liste (noeud `*_LIST_BEG`)        | Contenu                                            |
//! |-----------------------------------|----------------------------------------------------|
//! | `TEAM_BUILD_EFFECT_DATA`          | Données d'effet de base (`effectId`, seuil, valeur, conditions) |
//! | `TEAM_BUILD_EFFECT_INFO`          | Regroupement d'effets (`count` + paire `[offset,count]` vers `EFFECT_DATA`) |
//! | `TEAM_BUILD_UP_DATA`              | Bonus de montée (type, seuil, multiplicateur, conditions, ref d'effet) |
//! | `TEAM_BUILD_DOWN_DATA`           | Malus de descente (mêmes champs que `UP_DATA`)     |
//! | `TEAM_BUILD_INFO`                 | Configuration de build (paires vers `UP`/`DOWN`/`EFFECT_INFO`) |
//!
//! ## Variables positionnelles (port 1:1 d'inagle)
//!
//! Comme inagle, les champs sont lus **par position** dans `variables[]` :
//! - `EFFECT_DATA` (9 vars) : `effectId`, `threshold`, `value`, puis 6 conditions.
//! - `UP_DATA`/`DOWN_DATA` (7 vars) : `type`, `threshold`, `multiplier`, `condValue1`,
//!   `condValue2`, `effectRefId`, `effectCount`.
//! - `EFFECT_INFO` / `INFO` : alternance d'un noeud en-tête indexé (`..._<n>`) et de
//!   noeuds de référence (`..._REF_..._<n>`) portant une paire `[offset, count]`.
//!
//! ## Quirks Level-5 préservés (fidélité inagle)
//!
//! - **Sentinelle null** : `-992181094` (= `0xC4DC849A`) marque l'absence de valeur. Les
//!   conditions valant la sentinelle sont **omises** (comme inagle). Les seuils/condValue
//!   valant la sentinelle sont **conservés tels quels** en `i64` (pas convertis).
//! - **Flottants tronqués** : certains `threshold`/`value` d'`EFFECT_DATA` sont stockés en
//!   `Float` dans le binaire (`12.5`, `0.5`, …). inagle les lit via `Number.parseInt`
//!   (troncature vers zéro → `12`, `0`). On reproduit **exactement** cette troncature
//!   (`Var::as_i64`), donc la précision fractionnaire est perdue, à l'identique d'inagle.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::Node;
use crate::hash::HashId;

/// Sentinelle « pas de valeur » du format binaire : `-992181094` = `0xC4DC849A`.
pub const NULL_SENTINEL: i64 = -992_181_094;

/// Préfixe du noeud `*_LIST_BEG` portant les `TEAM_BUILD_EFFECT_DATA`.
const EFFECT_DATA_LIST: &str = "TEAM_BUILD_EFFECT_DATA_LIST_BEG";
/// Préfixe du noeud `*_LIST_BEG` portant les `TEAM_BUILD_EFFECT_INFO`.
const EFFECT_INFO_LIST: &str = "TEAM_BUILD_EFFECT_INFO_LIST_BEG";
/// Préfixe du noeud `*_LIST_BEG` portant les `TEAM_BUILD_UP_DATA`.
const UP_DATA_LIST: &str = "TEAM_BUILD_UP_DATA_LIST_BEG";
/// Préfixe du noeud `*_LIST_BEG` portant les `TEAM_BUILD_DOWN_DATA`.
const DOWN_DATA_LIST: &str = "TEAM_BUILD_DOWN_DATA_LIST_BEG";
/// Préfixe du noeud `*_LIST_BEG` portant les `TEAM_BUILD_INFO`.
const INFO_LIST: &str = "TEAM_BUILD_INFO_LIST_BEG";

// ─── Helpers ────────────────────────────────────────────────────────────────────

/// `true` si `name` commence par `prefix` et que le reste est **uniquement** des chiffres
/// non vides. Réplique le `^<prefix>\d+$` d'inagle qui distingue un noeud en-tête (ex.
/// `TEAM_BUILD_EFFECT_INFO_3`) d'un noeud de référence (`TEAM_BUILD_EFFECT_INFO_REF_...`).
fn is_indexed(name: &str, prefix: &str) -> bool {
    match name.strip_prefix(prefix) {
        Some(rest) => !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()),
        None => false,
    }
}

/// Lit une paire `[offset, count]` depuis les deux premières variables d'un noeud `_REF_`.
fn ref_pair(node: &Node<'_>) -> RefRange {
    RefRange {
        offset: node.int(0),
        count: node.int(1),
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════════════════════════════

/// Plage `[offset, count]` référençant une tranche d'une autre liste.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RefRange {
    /// Index de début dans la liste cible.
    pub offset: i64,
    /// Nombre d'entrées.
    pub count: i64,
}

/// Entrée `TEAM_BUILD_EFFECT_DATA` — donnée d'effet de base.
///
/// Port 1:1 de `TeamBuildEffectData` (`team-build-config.ts` l.26-35).
///
/// Vérité terrain : `TEAM_BUILD_EFFECT_DATA_0` : `effectId = 0xD6AA08A9`, `threshold = 0`,
/// `value = 5`, `conditions = []` (les 6 conditions valent toutes la sentinelle).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamBuildEffectData {
    /// `effectId` (CRC) — var0.
    pub effect_id: HashId,
    /// `threshold` — seuil d'activation (var1, flottant tronqué le cas échéant).
    pub threshold: i64,
    /// `value` — puissance/valeur de l'effet (var2, flottant tronqué le cas échéant).
    pub value: i64,
    /// `conditions` — jusqu'à 6 IDs de condition (var3..var8), sentinelle null **omise**.
    pub conditions: Vec<HashId>,
}

impl TeamBuildEffectData {
    /// Parse un noeud `TEAM_BUILD_EFFECT_DATA_*` (au moins 9 variables, sinon `None`).
    #[must_use]
    pub fn from_node(node: &Node<'_>) -> Option<Self> {
        if node.var_count() < 9 {
            return None;
        }
        let mut conditions = Vec::new();
        for i in 3..9 {
            let raw = node.int(i);
            if raw != NULL_SENTINEL {
                conditions.push(HashId::from_i64(raw));
            }
        }
        Some(Self {
            effect_id: node.hash(0),
            threshold: node.int(1),
            value: node.int(2),
            conditions,
        })
    }
}

/// Entrée `TEAM_BUILD_EFFECT_INFO` — regroupe des `EFFECT_DATA`.
///
/// Port 1:1 de `TeamBuildEffectInfo` (`team-build-config.ts` l.38-43). Construite par paire :
/// un noeud en-tête `TEAM_BUILD_EFFECT_INFO_<n>` (var0 = `count`) suivi d'un noeud
/// `TEAM_BUILD_EFFECT_INFO_REF_EFFECT_DATA_<n>` (`[offset, count]`).
///
/// Vérité terrain : info 0 : `count = 1`, `effect_data_ref = [0, 1]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamBuildEffectInfo {
    /// `count` — nombre d'effets référencés (var0 de l'en-tête).
    pub count: i64,
    /// Paire `[offset, count]` vers `TEAM_BUILD_EFFECT_DATA` (absente si non rencontrée).
    pub effect_data_ref: Option<RefRange>,
}

/// Entrée `TEAM_BUILD_UP_DATA` / `TEAM_BUILD_DOWN_DATA` — modificateur de build.
///
/// Port 1:1 de `TeamBuildModifierData` (`team-build-config.ts` l.46-61). Les `UP` (bonus) et
/// `DOWN` (malus) partagent exactement la même structure à 7 variables.
///
/// Vérité terrain : `TEAM_BUILD_UP_DATA_0` : `type = 1`, `threshold = 25`, `multiplier = 1`,
/// `cond_value1 = -992181094`, `cond_value2 = -992181094`, `effect_ref_id = 0xC82BC21B`,
/// `effect_count = 1`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamBuildModifierData {
    /// `type` — catégorie de modificateur (var0). Renommé `modifier_type` (`type` réservé).
    pub modifier_type: i64,
    /// `threshold` — seuil d'activation (var1, sentinelle conservée).
    pub threshold: i64,
    /// `multiplier` — multiplicateur/niveau (var2, sentinelle conservée).
    pub multiplier: i64,
    /// `condValue1` — valeur de condition 1 (var3, sentinelle conservée).
    pub cond_value1: i64,
    /// `condValue2` — valeur de condition 2 (var4, sentinelle conservée).
    pub cond_value2: i64,
    /// `effectRefId` (CRC) — référence d'effet (var5, `0x00000000` si nul).
    pub effect_ref_id: HashId,
    /// `effectCount` — nombre d'effets (var6).
    pub effect_count: i64,
}

impl TeamBuildModifierData {
    /// Parse un noeud `TEAM_BUILD_UP_DATA_*` ou `TEAM_BUILD_DOWN_DATA_*` (≥ 7 vars, sinon `None`).
    #[must_use]
    pub fn from_node(node: &Node<'_>) -> Option<Self> {
        if node.var_count() < 7 {
            return None;
        }
        Some(Self {
            modifier_type: node.int(0),
            threshold: node.int(1),
            multiplier: node.int(2),
            cond_value1: node.int(3),
            cond_value2: node.int(4),
            effect_ref_id: node.hash(5),
            effect_count: node.int(6),
        })
    }
}

/// Entrée `TEAM_BUILD_INFO` — configuration de build de premier niveau.
///
/// Port 1:1 de `TeamBuildInfo` (`team-build-config.ts` l.64-75). Construite par groupe : un
/// noeud en-tête `TEAM_BUILD_INFO_<n>` (var0 = `buildType`, var1 = `buildLevel`) suivi de
/// noeuds de référence `..._REF_UP_DATA_`, `..._REF_DOWN_DATA_`, `..._REF_EFFECT_INFO_`.
///
/// Vérité terrain : build 0 : `build_type = 5`, `build_level = 1`, `up_data_ref = [0, 1]`,
/// `down_data_ref = [0, 1]`, `effect_info_ref = [0, 5]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamBuildInfo {
    /// `buildType` — index de type de build (var0 de l'en-tête).
    pub build_type: i64,
    /// `buildLevel` — niveau/palier de build (var1 de l'en-tête).
    pub build_level: i64,
    /// Paire `[offset, count]` vers `TEAM_BUILD_UP_DATA`.
    pub up_data_ref: Option<RefRange>,
    /// Paire `[offset, count]` vers `TEAM_BUILD_DOWN_DATA`.
    pub down_data_ref: Option<RefRange>,
    /// Paire `[offset, count]` vers `TEAM_BUILD_EFFECT_INFO`.
    pub effect_info_ref: Option<RefRange>,
}

/// Base de données complète d'un `team_build_config_*.cfg.bin` (5 listes).
///
/// Port 1:1 de `TeamBuildDatabase` (`team-build-config.ts` l.78-84).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamBuildDatabase {
    /// `TEAM_BUILD_EFFECT_DATA` — données d'effet de base.
    pub effect_data: Vec<TeamBuildEffectData>,
    /// `TEAM_BUILD_EFFECT_INFO` — regroupements d'effets.
    pub effect_infos: Vec<TeamBuildEffectInfo>,
    /// `TEAM_BUILD_UP_DATA` — bonus de montée.
    pub up_data: Vec<TeamBuildModifierData>,
    /// `TEAM_BUILD_DOWN_DATA` — malus de descente.
    pub down_data: Vec<TeamBuildModifierData>,
    /// `TEAM_BUILD_INFO` — configurations de build.
    pub build_infos: Vec<TeamBuildInfo>,
}

/// Résout une tranche `[offset, count]` dans une liste cible (`&[]` si hors bornes ou absente).
fn slice_of<T>(items: &[T], r: Option<RefRange>) -> &[T] {
    let Some(r) = r else { return &[] };
    let start = r.offset.max(0) as usize;
    let end = start.saturating_add(r.count.max(0) as usize);
    items.get(start..end).unwrap_or(&[])
}

impl TeamBuildDatabase {
    /// Tranche des [`TeamBuildEffectData`] référencés par une `EFFECT_INFO`.
    #[must_use]
    pub fn effect_data_of(&self, info: &TeamBuildEffectInfo) -> &[TeamBuildEffectData] {
        slice_of(&self.effect_data, info.effect_data_ref)
    }

    /// Tranche des [`TeamBuildModifierData`] de montée référencés par une `INFO`.
    #[must_use]
    pub fn up_data_of(&self, info: &TeamBuildInfo) -> &[TeamBuildModifierData] {
        slice_of(&self.up_data, info.up_data_ref)
    }

    /// Tranche des [`TeamBuildModifierData`] de descente référencés par une `INFO`.
    #[must_use]
    pub fn down_data_of(&self, info: &TeamBuildInfo) -> &[TeamBuildModifierData] {
        slice_of(&self.down_data, info.down_data_ref)
    }

    /// Tranche des [`TeamBuildEffectInfo`] référencés par une `INFO`.
    #[must_use]
    pub fn effect_infos_of(&self, info: &TeamBuildInfo) -> &[TeamBuildEffectInfo] {
        slice_of(&self.effect_infos, info.effect_info_ref)
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Parseur
// ══════════════════════════════════════════════════════════════════════════════

/// Parse les `children` d'un `*_LIST_BEG` en `EFFECT_DATA`.
fn parse_effect_data(children: &[Node<'_>], out: &mut Vec<TeamBuildEffectData>) {
    for child in children {
        if !child.name().starts_with("TEAM_BUILD_EFFECT_DATA_") {
            continue;
        }
        if let Some(e) = TeamBuildEffectData::from_node(child) {
            out.push(e);
        }
    }
}

/// Parse les `children` d'un `*_LIST_BEG` en `EFFECT_INFO` (en-tête + ref alternés).
fn parse_effect_infos(children: &[Node<'_>], out: &mut Vec<TeamBuildEffectInfo>) {
    let mut current: Option<TeamBuildEffectInfo> = None;
    for child in children {
        let name = child.name();
        if is_indexed(name, "TEAM_BUILD_EFFECT_INFO_") {
            if let Some(info) = current.take() {
                out.push(info);
            }
            current = Some(TeamBuildEffectInfo {
                count: child.int(0),
                effect_data_ref: None,
            });
        } else if name.starts_with("TEAM_BUILD_EFFECT_INFO_REF_EFFECT_DATA_")
            && let Some(info) = current.as_mut()
            && child.var_count() >= 2
        {
            info.effect_data_ref = Some(ref_pair(child));
        }
    }
    if let Some(info) = current {
        out.push(info);
    }
}

/// Parse les `children` d'un `*_LIST_BEG` en modificateurs (UP ou DOWN), filtrés par préfixe.
fn parse_modifiers(children: &[Node<'_>], prefix: &str, out: &mut Vec<TeamBuildModifierData>) {
    for child in children {
        if !child.name().starts_with(prefix) {
            continue;
        }
        if let Some(m) = TeamBuildModifierData::from_node(child) {
            out.push(m);
        }
    }
}

/// Parse les `children` d'un `*_LIST_BEG` en `INFO` (en-tête + 3 types de refs).
fn parse_build_infos(children: &[Node<'_>], out: &mut Vec<TeamBuildInfo>) {
    let mut current: Option<TeamBuildInfo> = None;
    for child in children {
        let name = child.name();
        if is_indexed(name, "TEAM_BUILD_INFO_") {
            if let Some(info) = current.take() {
                out.push(info);
            }
            current = Some(TeamBuildInfo {
                build_type: child.int(0),
                build_level: child.int(1),
                up_data_ref: None,
                down_data_ref: None,
                effect_info_ref: None,
            });
        } else if name.starts_with("TEAM_BUILD_INFO_REF_UP_DATA_")
            && let Some(info) = current.as_mut()
            && child.var_count() >= 2
        {
            info.up_data_ref = Some(ref_pair(child));
        } else if name.starts_with("TEAM_BUILD_INFO_REF_DOWN_DATA_")
            && let Some(info) = current.as_mut()
            && child.var_count() >= 2
        {
            info.down_data_ref = Some(ref_pair(child));
        } else if name.starts_with("TEAM_BUILD_INFO_REF_EFFECT_INFO_")
            && let Some(info) = current.as_mut()
            && child.var_count() >= 2
        {
            info.effect_info_ref = Some(ref_pair(child));
        }
    }
    if let Some(info) = current {
        out.push(info);
    }
}

/// Parse un `team_build_config_*.cfg.bin` (forme iecode `{ "entries": [...] }`).
///
/// Port 1:1 de `parseContent` (`team-build-config.ts` l.99-217). Les noeuds de premier
/// niveau sont les `TEAM_BUILD_*_LIST_BEG` ; chacun est aiguillé vers le parseur de sa liste
/// selon son préfixe (ordre indifférent, comme inagle).
///
/// Vérité terrain (`team_build_config_6.00.23.cfg.bin`) : 35 `effect_data`, 30 `effect_infos`,
/// 9 `up_data`, 6 `down_data`, 6 `build_infos`.
#[must_use]
pub fn parse_team_build_config(root: &Value) -> TeamBuildDatabase {
    let mut db = TeamBuildDatabase::default();
    let Some(entries) = root.get("entries").and_then(Value::as_array) else {
        return db;
    };
    for e in entries {
        let entry = Node::new(e);
        let name = entry.name();
        let children = entry.children();
        if name.starts_with(EFFECT_DATA_LIST) {
            parse_effect_data(&children, &mut db.effect_data);
        } else if name.starts_with(EFFECT_INFO_LIST) {
            parse_effect_infos(&children, &mut db.effect_infos);
        } else if name.starts_with(UP_DATA_LIST) {
            parse_modifiers(&children, "TEAM_BUILD_UP_DATA_", &mut db.up_data);
        } else if name.starts_with(DOWN_DATA_LIST) {
            parse_modifiers(&children, "TEAM_BUILD_DOWN_DATA_", &mut db.down_data);
        } else if name.starts_with(INFO_LIST) {
            parse_build_infos(&children, &mut db.build_infos);
        }
    }
    db
}
