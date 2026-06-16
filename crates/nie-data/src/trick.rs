//! `TrickInfo` — port d'une valeur `m_trickInfoList` du `trick_config`
//! (`data/common/gamedata/skill/trick_config.cfg.bin`).
//!
//! Une « trick » est une feinte / mini-hissatsu de match (tir, dribble, bloc, arrêt) qui
//! déclenche un `eventID` de cut-in et, pour les blocs/arrêts contestés, un `failEventID`
//! d'échec. Chaque ligne associe l'ID de la trick à son code interne, à ses événements et
//! à une catégorie.
//!
//! ## Vérité terrain
//!
//! - Parser TS : `packages/inagle/src/parsers/trick-config.ts` (`parseContent` l.55-85,
//!   `TRICK_CATEGORY_MAP` l.25-30).
//! - Données : `data/common/gamedata/skill/trick_config.cfg.bin` (monté via le VFS),
//!   liste `m_trickInfoList` (type `TRICK_INFO`) = **9 valeurs**, **8 champs** chacune.
//!
//! Première valeur vérifiée (dump réel du VFS) : `trickID = 0xDAB20CDC`,
//! `trickIDName = "whs0010"`, `eventID = 0xDB8CADA2`, `eventIDName = "ev60_0010"`,
//! `failEventID = 0x00000000`, `failEventIDName = "0xFFFFFFFF"`, `trickName = "ファイアトルネード"`,
//! `trickCategory = 1` (Tir).
//!
//! ## Champ `failEventIDName` (sentinelle)
//!
//! `failEventIDName` est un champ `Condition` (chaîne). Quand la trick **n'a pas** d'événement
//! d'échec, sa valeur brute est la sentinelle `0xFFFFFFFF` : l'offset ne résout aucune chaîne,
//! et le décodage iecode la rend telle quelle en `"0xFFFFFFFF"` (cf. `read_condition_value` de
//! `nie-formats`). Quand la trick **a** un échec (blocs/arrêts contestés, ex. `ev62_0010_2`), la
//! chaîne réelle est résolue. On porte **1:1** inagle qui conserve cette valeur sans la
//! réécrire ; [`TrickInfo::has_fail_event`] teste la sentinelle via `failEventID`.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, field_str, list_values, owned};
use crate::hash::HashId;

/// Catégorie d'une trick. Source : `TRICK_CATEGORY_MAP` (trick-config.ts l.25-30).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum TrickCategory {
    /// 1 = Tir (préfixe de code `whs`).
    Shoot,
    /// 2 = Dribble (préfixe `who`).
    Dribble,
    /// 3 = Bloc (préfixe `whd`).
    Block,
    /// 4 = Arrêt / gardien (préfixe `whk`).
    Catch,
    /// Hors table : inagle retombe sur `Cat{n}` (le `n` brut est conservé).
    Other(i64),
}

impl TrickCategory {
    /// Mappe l'ID brut. Source : `TRICK_CATEGORY_MAP` (trick-config.ts l.25-30).
    #[must_use]
    pub fn from_id(id: i64) -> Self {
        match id {
            1 => Self::Shoot,
            2 => Self::Dribble,
            3 => Self::Block,
            4 => Self::Catch,
            other => Self::Other(other),
        }
    }

    /// Nom français — **strictement** `TRICK_CATEGORY_MAP` d'inagle (sans accent, comme la
    /// table TS : `"Tir"`, `"Dribble"`, `"Bloc"`, `"Arret"`), fallback `"Cat{n}"` pour les
    /// catégories inconnues (port 1:1 de `TRICK_CATEGORY_MAP[..] || \`Cat${..}\``).
    #[must_use]
    pub fn name_fr(self) -> String {
        match self {
            Self::Shoot => owned("Tir"),
            Self::Dribble => owned("Dribble"),
            Self::Block => owned("Bloc"),
            Self::Catch => owned("Arret"),
            Self::Other(n) => format!("Cat{n}"),
        }
    }
}

/// Une entrée `TRICK_INFO` du `trick_config` (8 champs, comme le dump réel du VFS).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TrickInfo {
    /// `trickID` — hash de la trick (`0xDAB20CDC`).
    pub trick_id: HashId,
    /// `trickIDName` — code interne (`whs0010`).
    pub trick_id_name: String,
    /// `eventID` — hash de l'événement de cut-in en match.
    pub event_id: HashId,
    /// `eventIDName` — nom de l'événement (`ev60_0010`).
    pub event_id_name: String,
    /// `failEventID` — hash de l'événement d'échec (`0` si la trick n'échoue jamais).
    pub fail_event_id: HashId,
    /// `failEventIDName` — nom de l'événement d'échec, ou la sentinelle `"0xFFFFFFFF"`
    /// quand il n'y en a pas (valeur brute conservée, cf. doc du module).
    pub fail_event_id_name: String,
    /// `trickName` — nom japonais (`ファイアトルネード`).
    pub trick_name: String,
    /// `trickCategory` (ID brut) → voir [`TrickInfo::category`].
    pub trick_category: i64,
}

impl TrickInfo {
    /// Catégorie typée.
    #[must_use]
    pub fn category(&self) -> TrickCategory {
        TrickCategory::from_id(self.trick_category)
    }

    /// Nom français de la catégorie (`TRICK_CATEGORY_MAP`, fallback `Cat{n}`).
    #[must_use]
    pub fn category_name(&self) -> String {
        self.category().name_fr()
    }

    /// `true` si la trick possède un événement d'échec réel (`failEventID != 0`).
    /// Les blocs/arrêts contestés (catégories Bloc/Arrêt) en ont un.
    #[must_use]
    pub fn has_fail_event(&self) -> bool {
        !self.fail_event_id.is_zero()
    }

    /// Parse une valeur `values[]` de `m_trickInfoList` (objet JSON à 8 clés). Mapping
    /// list→struct 1:1, sans filtrage (inagle pousse toutes les valeurs).
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        TrickInfo {
            trick_id: field_hash(v, "trickID"),
            trick_id_name: owned(field_str(v, "trickIDName").unwrap_or("")),
            event_id: field_hash(v, "eventID"),
            event_id_name: owned(field_str(v, "eventIDName").unwrap_or("")),
            fail_event_id: field_hash(v, "failEventID"),
            fail_event_id_name: owned(field_str(v, "failEventIDName").unwrap_or("")),
            trick_name: owned(field_str(v, "trickName").unwrap_or("")),
            trick_category: field_i64(v, "trickCategory").unwrap_or(0),
        }
    }
}

/// Parse toute la liste `m_trickInfoList` d'un `trick_config.cfg.bin.json` désérialisé.
/// Conserve l'ordre et le nombre des valeurs (port 1:1 de `parseContent`, aucun filtrage).
#[must_use]
pub fn parse_trick_config(root: &Value) -> Vec<TrickInfo> {
    let mut out = Vec::new();
    if let Some(values) = list_values(root, "m_trickInfoList") {
        for v in values {
            out.push(TrickInfo::from_value(v));
        }
    }
    out
}

/// Cherche une trick par son `trickID` (commodité, équivalent du `byId` d'inagle).
#[must_use]
pub fn find_trick(tricks: &[TrickInfo], id: HashId) -> Option<&TrickInfo> {
    tricks.iter().find(|t| t.trick_id == id)
}
