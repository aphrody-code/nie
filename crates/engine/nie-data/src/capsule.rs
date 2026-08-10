//! `capsule` — port du `capsule_config_*.cfg.bin` (gacha : tables de gain de capsules).
//!
//! ## Vérité terrain
//!
//! - Parser TS de référence : `packages/inagle/src/parsers/capsule-config.ts`
//!   (`parseEntries` l.68-136, `parseIntVar` l.64).
//! - Données : `data/common/gamedata/capsule/capsule_config_0.00.00.cfg.bin` (VFS Steam),
//!   le plus gros des cfg.bin gamedata (>5 MB). Format **T2B** (`entries`).
//!
//! Cinq listes au sommet (toutes des conteneurs `*_LIST_BEG`) :
//! - `CPSL_LOT_WEAPON_COLOR_TABLE_INFO_LIST_BEG` — tables de couleur d'arme
//!   (`tableId` + sous-liste `DATA` de `{colorType, weight}`).
//! - `CPSL_PRIZE_INFO_LIST_BEG` — 740 prix (vars Int plates, `id = toHex(vars[0])`).
//! - `CPSL_PRIZE_TABLE_INFO_LIST_BEG` — 20 tables de prix (`id` + sous-liste `DATA` de 10 vars).
//! - `CPSL_LOT_RANK_RATE_INFO_LIST_BEG` — 4 tables de taux par rang (`id` + sous-liste `{rank, rate}`).
//! - `CPSL_CONFIG_INFO_LIST_BEG` — 4 configs (vars plates + 1 sous-liste `DATA` de 6 vars).
//!
//! ## Réconciliation de structure inagle ↔ nie-formats (important)
//!
//! Le parseur TS suppose un arbre iecode où chaque noeud d'en-tête `*_INFO` **contient** sa
//! sous-liste `*_DATA_LIST_BEG` comme enfant imbriqué (cf. son commentaire « INFO entries with
//! nested DATA lists »). Le décodeur T2B de `nie-formats` (`cfgbin_to_t2b_iecode_root`) rend au
//! contraire l'en-tête `*_INFO` et son `*_DATA_LIST_BEG` comme **frères** sous le `*_LIST_BEG` :
//!
//! ```text
//! CPSL_LOT_RANK_RATE_INFO_LIST_BEG
//!   CPSL_LOT_RANK_RATE_INFO            [id]        (en-tête, frère)
//!   CPSL_LOT_RANK_RATE_INFO_DATA_LIST_BEG [n]      (sous-liste, frère suivant)
//!     CPSL_LOT_RANK_RATE_INFO_DATA    [rank, rate]
//! ```
//!
//! Ce module **apparie** donc chaque en-tête avec le `*_DATA_LIST_BEG` frère qui le suit (et
//! accepte aussi la forme imbriquée d'inagle), ce qui restitue exactement l'intention sémantique
//! du parseur TS (`colorType`/`weight`, lignes de table de prix, taux par rang) sur la donnée
//! réelle. Les champs (`id` via `toHex`, vars plates) sont identiques à inagle.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::Node;
use crate::hash::HashId;

/// Préfixe de la liste des tables de couleur d'arme.
const WEAPON_COLOR_LIST: &str = "CPSL_LOT_WEAPON_COLOR_TABLE_INFO_LIST_BEG";
/// Préfixe de la liste des prix.
const PRIZE_LIST: &str = "CPSL_PRIZE_INFO_LIST_BEG";
/// Préfixe de la liste des tables de prix.
const PRIZE_TABLE_LIST: &str = "CPSL_PRIZE_TABLE_INFO_LIST_BEG";
/// Préfixe de la liste des taux par rang.
const LOT_RANK_RATE_LIST: &str = "CPSL_LOT_RANK_RATE_INFO_LIST_BEG";
/// Préfixe de la liste des configs.
const CONFIG_LIST: &str = "CPSL_CONFIG_INFO_LIST_BEG";

/// Une ligne de table de couleur d'arme (`{colorType, weight}` côté inagle).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct WeaponColorRate {
    /// var0 — `colorType` (type de couleur).
    pub color_type: i64,
    /// var1 — `weight` (poids de tirage).
    pub weight: i64,
}

/// Une table de couleur d'arme : `tableId` + ses lignes `{colorType, weight}`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct WeaponColorTable {
    /// `toHex(vars[0])` de l'en-tête — identifiant de la table.
    pub table_id: HashId,
    /// Lignes de la sous-liste `DATA`.
    pub colors: Vec<WeaponColorRate>,
}

/// Un prix (`CPSL_PRIZE_INFO_*`) : `id = toHex(vars[0])` + toutes les vars Int brutes.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct PrizeInfo {
    /// `toHex(vars[0])` — identifiant du prix.
    pub id: HashId,
    /// Toutes les variables Int (6 dans le dump réel).
    pub vars: Vec<i64>,
}

/// Une ligne d'une table de prix (10 vars Int dans le dump réel).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct PrizeTableData {
    /// Toutes les variables Int de la ligne (`vars[0]` = id du prix référencé).
    pub vars: Vec<i64>,
}

/// Une table de prix (`CPSL_PRIZE_TABLE_INFO_*`) : `id` + ses lignes `DATA`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct PrizeTable {
    /// `toHex(vars[0])` de l'en-tête — identifiant de la table de prix.
    pub id: HashId,
    /// Variables Int de l'en-tête.
    pub vars: Vec<i64>,
    /// Lignes de la sous-liste `DATA`.
    pub data: Vec<PrizeTableData>,
}

/// Une ligne de taux par rang (`{rank, rate}`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RankRate {
    /// var0 — `rank` (5 → 1 dans le dump réel).
    pub rank: i64,
    /// var1 — `rate` (poids/probabilité du rang).
    pub rate: i64,
}

/// Une table de taux par rang (`CPSL_LOT_RANK_RATE_INFO_*`) : `id` + ses lignes `{rank, rate}`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct LotRankRate {
    /// `toHex(vars[0])` de l'en-tête — identifiant de la table de taux.
    pub id: HashId,
    /// Variables Int de l'en-tête.
    pub vars: Vec<i64>,
    /// Lignes `{rank, rate}` de la sous-liste `DATA`.
    pub rates: Vec<RankRate>,
}

/// Une ligne `DATA` d'une config (6 vars Int dans le dump réel).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ConfigData {
    /// Toutes les variables Int (`vars[0]` = id de table de prix référencée).
    pub vars: Vec<i64>,
}

/// Une config (`CPSL_CONFIG_INFO_*`) : vars plates + sa sous-liste `DATA`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ConfigInfo {
    /// Variables Int de l'en-tête (`vars[2]` = id de table de taux par rang référencée).
    pub vars: Vec<i64>,
    /// Lignes de la sous-liste `DATA`.
    pub data: Vec<ConfigData>,
}

/// Base de données capsule complète (port de `CapsuleDatabase` d'inagle).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CapsuleDatabase {
    /// Tables de couleur d'arme.
    pub weapon_color_tables: Vec<WeaponColorTable>,
    /// Prix.
    pub prizes: Vec<PrizeInfo>,
    /// Tables de prix.
    pub prize_tables: Vec<PrizeTable>,
    /// Tables de taux par rang.
    pub lot_rank_rates: Vec<LotRankRate>,
    /// Configs.
    pub configs: Vec<ConfigInfo>,
}

/// `true` si le nom est une sous-liste de données (`*_DATA_LIST_BEG`).
fn is_data_list(name: &str) -> bool {
    name.contains("_DATA_LIST_BEG")
}

/// Toutes les variables d'un noeud lues comme entiers signés (`parseIntVar` d'inagle).
fn int_vars(node: Node<'_>) -> Vec<i64> {
    (0..node.var_count()).map(|i| node.int(i)).collect()
}

/// `id = toHex(vars[0])` (ou `0x00000000` si aucune var), comme inagle.
fn id_from_vars(vars: &[i64]) -> HashId {
    vars.first().map_or(HashId::ZERO, |v| HashId::from_i64(*v))
}

/// Noeuds de premier niveau (`root.entries`), comme `content.entries` côté inagle.
fn top_entries(root: &Value) -> Vec<Node<'_>> {
    root.get("entries")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(Node::new).collect())
        .unwrap_or_default()
}

/// Apparie chaque en-tête `*_INFO` d'un noeud `*_LIST_BEG` avec ses lignes `DATA`.
///
/// Gère les deux formes (cf. doc du module) : sous-liste `*_DATA_LIST_BEG` imbriquée **dans**
/// l'en-tête (forme iecode d'inagle) **ou** frère suivant l'en-tête (forme T2B de nie-formats).
/// Renvoie `(en-tête, lignes_data)`.
fn paired_children<'a>(list: Node<'a>) -> Vec<(Node<'a>, Vec<Node<'a>>)> {
    let kids = list.children();
    let mut out = Vec::new();
    let mut i = 0;
    while i < kids.len() {
        let header = kids[i];
        if is_data_list(header.name()) {
            // Sous-liste orpheline (pas d'en-tête la précédant) : on l'ignore.
            i += 1;
            continue;
        }
        let mut rows: Vec<Node<'a>> = Vec::new();
        // Forme imbriquée (inagle) : la sous-liste est un enfant de l'en-tête.
        for c in header.children() {
            if is_data_list(c.name()) {
                rows.extend(c.children());
            }
        }
        // Forme frère (nie-formats) : la sous-liste suit immédiatement l'en-tête.
        if i + 1 < kids.len() && is_data_list(kids[i + 1].name()) {
            rows.extend(kids[i + 1].children());
            i += 1;
        }
        out.push((header, rows));
        i += 1;
    }
    out
}

/// Parse un `capsule_config_*.cfg.bin.json` désérialisé (forme iecode `{entries: [...]}`).
///
/// Port 1:1 de `parseEntries` (`capsule-config.ts` l.68-136), adapté à la structure frère/imbriquée.
#[must_use]
pub fn parse_capsule_database(root: &Value) -> CapsuleDatabase {
    let mut db = CapsuleDatabase::default();

    for entry in top_entries(root) {
        let name = entry.name();
        if name.starts_with(WEAPON_COLOR_LIST) {
            for (header, rows) in paired_children(entry) {
                let vars = int_vars(header);
                let colors = rows
                    .iter()
                    .filter_map(|r| {
                        let rv = int_vars(*r);
                        // inagle : `if (vars.length >= 2)`.
                        (rv.len() >= 2).then_some(WeaponColorRate {
                            color_type: rv[0],
                            weight: rv[1],
                        })
                    })
                    .collect();
                db.weapon_color_tables.push(WeaponColorTable {
                    table_id: id_from_vars(&vars),
                    colors,
                });
            }
        } else if name.starts_with(PRIZE_TABLE_LIST) {
            // NB : tester PRIZE_TABLE avant PRIZE pour éviter tout recouvrement de préfixe.
            for (header, rows) in paired_children(entry) {
                let vars = int_vars(header);
                let data = rows
                    .iter()
                    .map(|r| PrizeTableData { vars: int_vars(*r) })
                    .collect();
                db.prize_tables.push(PrizeTable {
                    id: id_from_vars(&vars),
                    vars,
                    data,
                });
            }
        } else if name.starts_with(PRIZE_LIST) {
            // Pas de sous-liste : chaque enfant est un prix à vars plates.
            for child in entry.children() {
                let vars = int_vars(child);
                db.prizes.push(PrizeInfo {
                    id: id_from_vars(&vars),
                    vars,
                });
            }
        } else if name.starts_with(LOT_RANK_RATE_LIST) {
            for (header, rows) in paired_children(entry) {
                let vars = int_vars(header);
                let rates = rows
                    .iter()
                    .filter_map(|r| {
                        let rv = int_vars(*r);
                        (rv.len() >= 2).then_some(RankRate {
                            rank: rv[0],
                            rate: rv[1],
                        })
                    })
                    .collect();
                db.lot_rank_rates.push(LotRankRate {
                    id: id_from_vars(&vars),
                    vars,
                    rates,
                });
            }
        } else if name.starts_with(CONFIG_LIST) {
            for (header, rows) in paired_children(entry) {
                let vars = int_vars(header);
                let data = rows
                    .iter()
                    .map(|r| ConfigData { vars: int_vars(*r) })
                    .collect();
                db.configs.push(ConfigInfo { vars, data });
            }
        }
    }

    db
}
