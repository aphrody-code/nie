//! `win_treasure` — coffres de victoire (`item/win_treasure_lot_table_config_*.cfg.bin`).
//!
//! ## Vérité terrain
//!
//! - Parseur TS de référence : `packages/inagle/src/parsers/drop-rates.ts`
//!   (`loadWinTreasureRates`, l.162-217) — port 1:1.
//! - Données : `data/common/gamedata/item/win_treasure_lot_table_config_0.00.00.cfg.bin`
//!   (VFS IEVR). Format **T2B** (`entries`, noeuds nommés), pas RDBN.
//!
//! ## Structure du fichier
//!
//! Deux racines de premier niveau :
//!
//! 1. `ITBL_ITEMS_LIST_BEG` — 113 feuilles `ITBL_ITEMS_*`, chacune
//!    `[itemId, 1, poids, 0, 0]`. Aplaties dans une **liste plate** unique
//!    [`flatten_items`] (l'index positionnel sert de coordonnée de tranche).
//! 2. `ITBL_BASE_LIST_BEG` — 44 enfants en **paires** : un `ITBL_BASE_*`
//!    (`[coffre_crc]`) immédiatement suivi de son frère `ITBL_BASE_REF_ITEMS_*`
//!    (`[offset, count]`) qui découpe une tranche `flat[offset .. offset+count]`
//!    de la liste plate → les items du coffre. 22 coffres au total.
//!
//! `itemId`/`coffre` sont encodés en `Int` **signé** dans le dump ; on les
//! réinterprète en `u32` non signé (le `toHex(parseInt(...))` d'inagle = [`HashId`]).
//!
//! ## Anti-hallucination
//!
//! Aucune dimension « élément/attribut » n'existe dans ces octets : les seules
//! coordonnées sont (coffre, item, poids). Chaque poids est un octet réel du config.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::Node;
use crate::hash::HashId;

/// Une feuille `ITBL_ITEMS_*` aplatie. Dans le dump : `[itemId, 1, poids, 0, 0]` ;
/// seuls var\[0\] (item) et var\[2\] (poids) portent de l'information.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TreasureItem {
    /// var\[0\] — hash de l'item tiré (signé→non-signé).
    pub item_id: HashId,
    /// var\[2\] — poids de loterie (entier, ≥ 1).
    pub weight: i64,
}

/// Un coffre `ITBL_BASE_*` apparié à son frère `ITBL_BASE_REF_ITEMS_*`.
///
/// La tranche `[offset, offset + count)` indexe la liste plate de [`flatten_items`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TreasureChest {
    /// var\[0\] du `ITBL_BASE_*` — hash du coffre (crc, signé→non-signé).
    pub chest_id: HashId,
    /// var\[0\] du `ITBL_BASE_REF_ITEMS_*` — index de début (0-basé) dans la liste plate.
    pub offset: i64,
    /// var\[1\] du `ITBL_BASE_REF_ITEMS_*` — nombre d'items de la tranche.
    pub count: i64,
}

/// Une ligne de taux unitaire : (coffre, item, poids). Un poids = un octet réel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct WinTreasureRow {
    /// Index positionnel de la ligne dans la sortie (clé stable, comme l'`ordinal` inagle).
    pub ordinal: usize,
    /// Hash du coffre (conteneur du tirage).
    pub chest_id: HashId,
    /// Hash de l'item tiré.
    pub item_id: HashId,
    /// Poids de loterie de cet item dans ce coffre.
    pub weight: i64,
}

/// Itère les racines de premier niveau (`entries`) d'un `cfg.bin.json` T2B.
fn top_entries(root: &Value) -> Vec<Node<'_>> {
    root.get("entries")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(Node::new).collect())
        .unwrap_or_default()
}

/// Aplati les feuilles `ITBL_ITEMS_*` des racines `ITBL_ITEMS_LIST_BEG` en une liste
/// plate ordonnée (port de la 1re boucle d'`loadWinTreasureRates`, l.171-183).
///
/// Filtre : nom commençant par `ITBL_ITEMS_`, **hors** `LIST` (exclut le conteneur
/// `ITBL_ITEMS_LIST_BEG`), au moins 3 variables (comme `v.length >= 3` d'inagle).
#[must_use]
pub fn flatten_items(root: &Value) -> Vec<TreasureItem> {
    let mut flat = Vec::new();
    for r in top_entries(root) {
        if !r.name().starts_with("ITBL_ITEMS_LIST_BEG") {
            continue;
        }
        for leaf in r.children() {
            let name = leaf.name();
            if name.starts_with("ITBL_ITEMS_") && !name.contains("LIST") && leaf.var_count() >= 3 {
                flat.push(TreasureItem {
                    item_id: leaf.hash(0),
                    weight: leaf.int(2),
                });
            }
        }
    }
    flat
}

/// Apparie chaque coffre `ITBL_BASE_*` avec son frère immédiat `ITBL_BASE_REF_ITEMS_*`
/// (port de la 2e boucle d'`loadWinTreasureRates`, l.184-202).
///
/// Le frère de référence est strictement le voisin `i + 1` dans l'ordre du fichier
/// (l'appariement repose sur l'ordre des frères, préservé par le tableau JSON).
#[must_use]
pub fn collect_chests(root: &Value) -> Vec<TreasureChest> {
    let mut base_children: Vec<Node<'_>> = Vec::new();
    for r in top_entries(root) {
        if r.name().starts_with("ITBL_BASE_LIST_BEG") {
            base_children.extend(r.children());
        }
    }

    let mut chests = Vec::new();
    let mut i = 0;
    while i < base_children.len() {
        let node = base_children[i];
        let name = node.name();
        if name.starts_with("ITBL_BASE_")
            && !name.contains("REF")
            && !name.contains("LIST")
            && let Some(refn) = base_children.get(i + 1).copied()
            && refn.name().starts_with("ITBL_BASE_REF_ITEMS_")
        {
            chests.push(TreasureChest {
                chest_id: node.hash(0),
                offset: refn.int(0),
                count: refn.int(1),
            });
        }
        i += 1;
    }
    chests
}

/// Parse un `win_treasure_lot_table_config_*.cfg.bin.json` en lignes de taux à plat.
///
/// Port 1:1 d'`loadWinTreasureRates` (drop-rates.ts l.162-217) : aplatit les items,
/// puis pour chaque coffre découpe la tranche `flat[offset .. offset+count]` (bornée
/// par la taille de la liste plate) et émet une ligne par item.
#[must_use]
pub fn parse_win_treasure(root: &Value) -> Vec<WinTreasureRow> {
    let flat = flatten_items(root);
    let chests = collect_chests(root);

    let mut rows = Vec::new();
    let mut ordinal = 0;
    for chest in &chests {
        for j in chest.offset..chest.offset.saturating_add(chest.count) {
            if j < 0 {
                continue;
            }
            let idx = j as usize;
            if idx >= flat.len() {
                break;
            }
            let item = flat[idx];
            rows.push(WinTreasureRow {
                ordinal,
                chest_id: chest.chest_id,
                item_id: item.item_id,
                weight: item.weight,
            });
            ordinal += 1;
        }
    }
    rows
}
