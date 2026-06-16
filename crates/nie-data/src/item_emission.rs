//! Famille `item_emission` — taux d'émission de rareté par item (poids de loterie).
//!
//! Port 1:1 de la source `item_emission` du parseur inagle `drop-rates.ts`
//! (fonction `loadItemEmissionRates`, `packages/inagle/src/parsers/drop-rates.ts` l.85-116).
//! Seule cette source est portée ici ; les sources `spirit_drop` (soccer) et `win_treasure`
//! relèvent d'autres familles.
//!
//! ## Fichier source
//!
//! `data/common/gamedata/item/item_emission_rarity_table_config_0.00.00.cfg.bin`
//! (format RDBN `lists`, 746 octets — le plus petit cfg.bin du jeu).
//!
//! ## Structure (deux listes jointes)
//!
//! | Liste | Type (typo Level-5) | Champs |
//! |-------|---------------------|--------|
//! | `m_itemEmissionRarityTableConfigList` | `ITEM_EMISSION_RARITY_TABLE_CONFING` | `itemId` (hash), `tableInfo` `[offset, count]` |
//! | `m_itemEmissionRarityTableConfigInfoList` | `ITEM_EMISSION_RARITY_TABLE_CONFING_IFNO` | `tableId` (hash), `emitRarity` (1..5), `weight` (int) |
//!
//! Les typos `CONFING` (au lieu de `CONFIG`) et `IFNO` (au lieu de `INFO`) sont celles de
//! Level-5 : elles sont préservées telles quelles (vérité terrain).
//!
//! ## Jointure
//!
//! Chaque entrée `item` référence une tranche `[offset, count]` de la liste `info` via
//! `tableInfo`. Une **ligne de taux** = un couple `(item, emitRarity) -> weight`. L'ordinal
//! (`ordinal`) est l'index positionnel de la ligne dans le flux de jointure (clé stable,
//! identique au suffixe `item_emission:<ordinal>` d'inagle).
//!
//! ## Vérité terrain (anti-hallucination)
//!
//! Le dump réel contient 4 items et 10 entrées info, toutes consommées exactement une fois
//! (offsets 0..9), soit **10 lignes de taux**. Valeurs golden dans
//! `tests/item_emission_golden.rs`.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, list_values};
use crate::hash::HashId;

/// Une entrée de `m_itemEmissionRarityTableConfigInfoList`
/// (type `ITEM_EMISSION_RARITY_TABLE_CONFING_IFNO`, typo Level-5 préservée).
///
/// ## Vérité terrain
///
/// `item_emission_rarity_table_config_0.00.00.cfg.bin`, `info[0]` :
/// `{ emitRarity: 5, tableId: "0xF0940E72", weight: 1 }`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ItemEmissionRarityInfo {
    /// `tableId` — hash de la table de rareté d'émission (conteneur du tirage).
    pub table_id: HashId,
    /// `emitRarity` — rareté d'émission tirée (1..=5).
    pub emit_rarity: i64,
    /// `weight` — poids de loterie (entier).
    pub weight: i64,
}

impl ItemEmissionRarityInfo {
    /// Parse une entrée de `m_itemEmissionRarityTableConfigInfoList`.
    ///
    /// Renvoie toujours `Some` : les entrées sont référencées positionnellement par
    /// `tableInfo[offset, count]`, donc aucune n'est filtrée (port fidèle d'inagle).
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        Some(Self {
            table_id: field_hash(v, "tableId"),
            emit_rarity: field_i64(v, "emitRarity").unwrap_or(0),
            weight: field_i64(v, "weight").unwrap_or(0),
        })
    }
}

/// Une entrée de `m_itemEmissionRarityTableConfigList`
/// (type `ITEM_EMISSION_RARITY_TABLE_CONFING`, typo Level-5 préservée).
///
/// ## Vérité terrain
///
/// `item_emission_rarity_table_config_0.00.00.cfg.bin`, `item[1]` :
/// `{ itemId: "0x035D0718", tableInfo: [1, 3] }`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ItemEmissionRarityTable {
    /// `itemId` — hash de l'item émetteur.
    pub item_id: HashId,
    /// `tableInfo` — `[offset, count]` indexant [`ItemEmissionRarityInfo`] dans la liste info.
    pub table_info: [i64; 2],
}

impl ItemEmissionRarityTable {
    /// Parse une entrée de `m_itemEmissionRarityTableConfigList`.
    ///
    /// `None` si `tableInfo` n'est pas un tableau (port du `if (!Array.isArray) continue`
    /// d'inagle) : l'item est alors ignoré.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let arr = v.get("tableInfo").and_then(Value::as_array)?;
        let offset = arr.first().and_then(Value::as_i64).unwrap_or(0);
        let count = arr.get(1).and_then(Value::as_i64).unwrap_or(0);
        Some(Self {
            item_id: field_hash(v, "itemId"),
            table_info: [offset, count],
        })
    }
}

/// Une ligne de taux d'émission jointe : un couple `(item, emitRarity) -> weight`.
///
/// Sortie aplatie de [`parse_item_emission_rates`] (équivalent d'un `DropRateRow` inagle
/// de source `item_emission`, sans les dimensions `spirit_drop`/`win_treasure`).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ItemEmissionRate {
    /// Index positionnel dans le flux de jointure (clé stable, = suffixe inagle).
    pub ordinal: usize,
    /// Hash de l'item émetteur (`itemId` de l'item parent).
    pub item_id: HashId,
    /// Hash de la table de tirage (`tableId` de l'entrée info ; `sourceId` chez inagle).
    pub table_id: HashId,
    /// Rareté d'émission (1..=5).
    pub emit_rarity: i64,
    /// Poids de loterie (entier).
    pub weight: i64,
}

impl ItemEmissionRate {
    /// Clé primaire stable façon inagle : `"item_emission:<ordinal>"`.
    #[must_use]
    pub fn id(&self) -> String {
        format!("item_emission:{}", self.ordinal)
    }
}

/// Parse `m_itemEmissionRarityTableConfigInfoList` (toutes les entrées, dans l'ordre).
#[must_use]
pub fn parse_item_emission_info_list(root: &Value) -> Vec<ItemEmissionRarityInfo> {
    let mut out = Vec::new();
    if let Some(values) = list_values(root, "m_itemEmissionRarityTableConfigInfoList") {
        for v in values {
            if let Some(item) = ItemEmissionRarityInfo::from_value(v) {
                out.push(item);
            }
        }
    }
    out
}

/// Parse `m_itemEmissionRarityTableConfigList` (items + `tableInfo`, dans l'ordre).
#[must_use]
pub fn parse_item_emission_table_list(root: &Value) -> Vec<ItemEmissionRarityTable> {
    let mut out = Vec::new();
    if let Some(values) = list_values(root, "m_itemEmissionRarityTableConfigList") {
        for v in values {
            if let Some(item) = ItemEmissionRarityTable::from_value(v) {
                out.push(item);
            }
        }
    }
    out
}

/// Joint les deux listes et aplatit en lignes de taux `(item, emitRarity) -> weight`.
///
/// Port 1:1 de `loadItemEmissionRates` (inagle `drop-rates.ts` l.85-116) : pour chaque item,
/// parcourt la tranche `info[offset .. offset + count]` (bornée par `info.len()`) et émet une
/// ligne par entrée, `ordinal` incrémenté à chaque ligne.
#[must_use]
pub fn parse_item_emission_rates(root: &Value) -> Vec<ItemEmissionRate> {
    let info = parse_item_emission_info_list(root);
    let items = parse_item_emission_table_list(root);

    let mut rows = Vec::new();
    let mut ordinal: usize = 0;
    for it in &items {
        let start = it.table_info[0].max(0) as usize;
        let count = it.table_info[1].max(0) as usize;
        // Borne `i < info.length` d'inagle : on plafonne la fin à la longueur réelle.
        let end = start.saturating_add(count).min(info.len());
        let slice = info.get(start..end).unwrap_or(&[]);
        for entry in slice {
            rows.push(ItemEmissionRate {
                ordinal,
                item_id: it.item_id,
                table_id: entry.table_id,
                emit_rarity: entry.emit_rarity,
                weight: entry.weight,
            });
            ordinal += 1;
        }
    }
    rows
}

// ─── Tests unitaires ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({
            "lists": [
                {
                    "name": "m_itemEmissionRarityTableConfigInfoList",
                    "typeName": "ITEM_EMISSION_RARITY_TABLE_CONFING_IFNO",
                    "values": [
                        { "emitRarity": 5, "tableId": "0xF0940E72", "weight": 1 },
                        { "emitRarity": 4, "tableId": "0x032D7F3A", "weight": 3 }
                    ]
                },
                {
                    "name": "m_itemEmissionRarityTableConfigList",
                    "typeName": "ITEM_EMISSION_RARITY_TABLE_CONFING",
                    "values": [
                        { "itemId": "0x745A378E", "tableInfo": [0, 2] }
                    ]
                }
            ]
        })
    }

    #[test]
    fn jointure_offset_count() {
        let rates = parse_item_emission_rates(&fixture());
        assert_eq!(rates.len(), 2);
        assert_eq!(rates[0].ordinal, 0);
        assert_eq!(rates[0].item_id, HashId(0x745A_378E));
        assert_eq!(rates[0].table_id, HashId(0xF094_0E72));
        assert_eq!(rates[0].emit_rarity, 5);
        assert_eq!(rates[0].weight, 1);
        assert_eq!(rates[1].ordinal, 1);
        assert_eq!(rates[1].table_id, HashId(0x032D_7F3A));
        assert_eq!(rates[1].emit_rarity, 4);
        assert_eq!(rates[1].weight, 3);
        assert_eq!(rates[1].id(), "item_emission:1");
    }

    #[test]
    fn count_borne_par_longueur_info() {
        // count=99 dépasse la liste info (2 entrées) → borné à 2 (port `i < info.length`).
        let root = json!({
            "lists": [
                {
                    "name": "m_itemEmissionRarityTableConfigInfoList",
                    "values": [
                        { "emitRarity": 5, "tableId": "0xF0940E72", "weight": 1 },
                        { "emitRarity": 4, "tableId": "0x032D7F3A", "weight": 3 }
                    ]
                },
                {
                    "name": "m_itemEmissionRarityTableConfigList",
                    "values": [ { "itemId": "0x745A378E", "tableInfo": [0, 99] } ]
                }
            ]
        });
        assert_eq!(parse_item_emission_rates(&root).len(), 2);
    }

    #[test]
    fn item_sans_table_info_ignore() {
        let root = json!({
            "lists": [
                { "name": "m_itemEmissionRarityTableConfigInfoList", "values": [] },
                {
                    "name": "m_itemEmissionRarityTableConfigList",
                    "values": [ { "itemId": "0x745A378E" } ]
                }
            ]
        });
        assert_eq!(parse_item_emission_table_list(&root).len(), 0);
        assert_eq!(parse_item_emission_rates(&root).len(), 0);
    }
}
