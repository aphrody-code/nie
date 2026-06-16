//! `ability_learning_config` — port Rust du plateau d'apprentissage d'aptitudes (Ability Board).
//!
//! ## Vérité terrain
//!
//! - Parseur TS de référence : `packages/inagle/src/parsers/ability-learning.ts`
//!   (`loadAbilityLearningConfig`, interfaces `AbilityBoardEffect` / `AbilityBoardNode`).
//! - Données : VFS IEVR, `data/common/gamedata/skill/ability_learning_config_1.03.63.00.cfg.bin`
//!   (format T2B `entries`). Dump réel : 23790 effets, 877 plateaux.
//!
//! Le fichier porte **deux** sections utiles (les autres — plateaux de formes, tables de build,
//! passifs… — ne sont pas couvertes par le parseur inagle de référence, donc pas portées ici) :
//!
//! 1. `ABILITY_LEARNING_BOARD_EFFECT_LIST_BEG_0` → enfants `ABILITY_LEARNING_BOARD_EFFECT_N`.
//!    Chaque effet : `hash = toHex(var0)`, `type = var2`, `value = var3` (l'index `N` est l'`id`).
//! 2. `ABILITY_LEARNING_BOARD_INFO_LIST_BEG_0` → liens plateau→effet. Pour chaque enfant
//!    `ABILITY_LEARNING_BOARD_INFO_REF_EFFECT_N`, on retrouve le frère `ABILITY_LEARNING_BOARD_INFO_N`
//!    de **même index** : la clé plateau est `toHex(BOARD_INFO_N.var0)`, et on empile la valeur
//!    `REF_EFFECT_N.var0` (offset dans la liste d'effets). Les nœuds `__SORT_INDEX_*` de cette
//!    section sont ignorés (ils ne commencent pas par le préfixe `..._REF_EFFECT_`).
//!
//! Port **1:1** d'inagle, typos Level-5 préservées. Aucune valeur inventée :
//! cf. `tests/ability_learning_golden.rs` (fixture = vrai dump VFS).

use alloc::collections::BTreeMap;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::Node;
use crate::hash::HashId;

/// Nom exact de la section listant les effets du plateau.
const EFFECT_LIST: &str = "ABILITY_LEARNING_BOARD_EFFECT_LIST_BEG_0";
/// Préfixe des nœuds effet (l'index `N` suit immédiatement).
const EFFECT_PREFIX: &str = "ABILITY_LEARNING_BOARD_EFFECT_";
/// Nom exact de la section liant plateaux et effets.
const INFO_LIST: &str = "ABILITY_LEARNING_BOARD_INFO_LIST_BEG_0";
/// Préfixe des nœuds de référence effet (l'index `N` suit immédiatement).
const INFO_REF_EFFECT_PREFIX: &str = "ABILITY_LEARNING_BOARD_INFO_REF_EFFECT_";
/// Préfixe des nœuds plateau (l'index `N` suit immédiatement).
const INFO_PREFIX: &str = "ABILITY_LEARNING_BOARD_INFO_";

/// Un effet du plateau d'apprentissage (`AbilityBoardEffect` côté inagle).
///
/// `skillId` / `passiveId` du type TS ne sont **pas** résolus par ce parseur (ils le sont
/// dans un étage de jointure ultérieur), donc absents de cette structure — port 1:1.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AbilityBoardEffect {
    /// `id` — index `N` du nœud `ABILITY_LEARNING_BOARD_EFFECT_N`.
    pub id: u32,
    /// `hash` — `toHex(var0)` (hash signé→non-signé de l'effet ciblé).
    pub hash: HashId,
    /// `type` — `var2` (catégorie d'effet, brute ; nom Rust `effect_type`, `type` étant réservé).
    pub effect_type: i64,
    /// `value` — `var3` (magnitude de l'effet, brute).
    pub value: i64,
}

/// Sortie du parseur : effets indexés par `id`, et plateaux (`boardId` hex) → offsets d'effet.
///
/// Reproduit le `{ effects, boards }` d'inagle. `boards` est un `BTreeMap` (ordre déterministe
/// par hash) ; inagle utilise une `Map` à ordre d'insertion — l'accès par clé est identique.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AbilityLearningConfig {
    /// `effects` — `id` (index `N`) → effet.
    pub effects: BTreeMap<u32, AbilityBoardEffect>,
    /// `boards` — `boardId` (`toHex(BOARD_INFO_N.var0)`) → liste des `REF_EFFECT_N.var0` empilés.
    pub boards: BTreeMap<HashId, Vec<i64>>,
}

/// Itère les nœuds de premier niveau (`root["entries"]`) comme [`Node`].
fn top_entries(root: &Value) -> Vec<Node<'_>> {
    root.get("entries")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(Node::new).collect())
        .unwrap_or_default()
}

/// Parse un `ability_learning_config.cfg.bin` (forme iecode `entries`) déjà désérialisé.
///
/// Port 1:1 de `loadAbilityLearningConfig` (`ability-learning.ts`). Seules les deux sections
/// `..._BOARD_EFFECT_LIST_BEG_0` et `..._BOARD_INFO_LIST_BEG_0` sont exploitées.
#[must_use]
pub fn parse_ability_learning_config(root: &Value) -> AbilityLearningConfig {
    let mut out = AbilityLearningConfig::default();

    for entry in top_entries(root) {
        match entry.name() {
            // Section 1 : les effets. inagle lit chaque enfant, `id` = index, `hash/type/value`.
            EFFECT_LIST => {
                for child in entry.children() {
                    let Some(idx) = child
                        .name()
                        .strip_prefix(EFFECT_PREFIX)
                        .and_then(|n| n.parse::<u32>().ok())
                    else {
                        continue;
                    };
                    out.effects.insert(
                        idx,
                        AbilityBoardEffect {
                            id: idx,
                            hash: child.hash(0),
                            effect_type: child.int(2),
                            value: child.int(3),
                        },
                    );
                }
            }
            // Section 2 : liens plateau→effet. Pour chaque REF_EFFECT_N, on cherche BOARD_INFO_N
            // (même index), clé = toHex(BOARD_INFO_N.var0), on empile REF_EFFECT_N.var0.
            INFO_LIST => {
                let children = entry.children();
                // Index nom→nœud pour reproduire le `entry.children.find(...)` d'inagle en O(1).
                let mut by_name: BTreeMap<&str, Node<'_>> = BTreeMap::new();
                for c in &children {
                    by_name.insert(c.name(), *c);
                }
                for child in &children {
                    let Some(idx) = child.name().strip_prefix(INFO_REF_EFFECT_PREFIX) else {
                        continue;
                    };
                    // Nom du frère plateau de même index : `ABILITY_LEARNING_BOARD_INFO_<idx>`.
                    let mut board_name = alloc::string::String::from(INFO_PREFIX);
                    board_name.push_str(idx);
                    let Some(board_node) = by_name.get(board_name.as_str()) else {
                        continue;
                    };
                    let board_id = board_node.hash(0);
                    out.boards.entry(board_id).or_default().push(child.int(0));
                }
            }
            _ => {}
        }
    }

    out
}
