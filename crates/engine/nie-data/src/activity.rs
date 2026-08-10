//! `ActivityConfig` — port Rust de `system/activity_config.cfg.bin.json` (Level-5 IEVR).
//!
//! ## Quoi
//!
//! L'**arbre des activités / tâches** du jeu : une activité racine `StoryMode` (kind 1, parent 0)
//! et ses sous-tâches `StoryMode_SubTask_01..04` (kind 5, parent = id de `StoryMode`). C'est le
//! système de suivi de progression (tâches en cours, complétion).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `data/common/gamedata/system/activity_config.cfg.bin.json` (13 entrées).
//! - Format **`entries`** (noeuds nommés, variables positionnelles). Une seule liste
//!   `ACTIVITY_CONFIG_LIST_BEG_0` → 13 noeuds `ACTIVITY_CONFIG_N` de **5 variables** :
//!
//! | Var | Type   | Exemple (entrée 0) | Sémantique                                            |
//! |-----|--------|--------------------|-------------------------------------------------------|
//! | 0   | Int    | `583576710`        | `id` — identifiant de l'activité                       |
//! | 1   | String | `"StoryMode"`      | `name` — nom interne (ex. `StoryMode_SubTask_01`)      |
//! | 2   | Int    | `1`                | `kind` — 1 = activité racine, 5 = sous-tâche           |
//! | 3   | Int    | `0`                | `parent_id` — id du parent (0 = racine)                |
//! | 4   | String | `"AAAA…"` (base64) | `data` — blob binaire encodé base64 (conditions ?)     |
//!
//! La sémantique de `data` (blob base64) n'est pas décodée (aucune source TS) ; conservé brut.

use alloc::{string::String, vec::Vec};
use serde_json::Value;

use crate::cfgbin::walk_named;
use crate::hash::HashId;

/// Entrée `ACTIVITY_CONFIG_N` — une activité ou sous-tâche de l'arbre de progression.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ActivityConfig {
    /// `id` (var[0]) — identifiant de l'activité (référencé par `parent_id` des sous-tâches).
    pub id: HashId,
    /// `name` (var[1]) — nom interne, ex. `StoryMode`, `StoryMode_SubTask_01`.
    pub name: String,
    /// `kind` (var[2]) — `1` = activité racine, `5` = sous-tâche (observé).
    pub kind: i64,
    /// `parent_id` (var[3]) — id de l'activité parente, `0` pour une racine.
    pub parent_id: HashId,
    /// `data` (var[4]) — blob binaire encodé base64, sémantique non décodée (conservé brut).
    pub data: String,
}

impl ActivityConfig {
    /// `true` si c'est une activité racine (`kind == 1`, `parent_id` nul).
    #[must_use]
    pub fn is_root(&self) -> bool {
        self.kind == 1 && self.parent_id.is_zero()
    }
}

/// Parse `activity_config.cfg.bin.json` → la liste des activités (ordre du fichier).
///
/// Filtre les noeuds `ACTIVITY_CONFIG_LIST_BEG_*` (1 variable) ; ne retient que les vraies
/// entrées à 5 variables.
#[must_use]
pub fn parse_activity_config(root: &Value) -> Vec<ActivityConfig> {
    let mut out = Vec::new();
    walk_named(root, "ACTIVITY_CONFIG_", |node| {
        if node.var_count() < 5 {
            return; // saute le LIST_BEG (1 var)
        }
        out.push(ActivityConfig {
            id: node.hash(0),
            name: String::from(node.string(1)),
            kind: node.int(2),
            parent_id: node.hash(3),
            data: String::from(node.string(4)),
        });
    });
    out
}
