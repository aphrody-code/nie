//! `FriendMapConfig` — port Rust de `friendmap_config_*.cfg.bin.json` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `/home/ubuntu/niers/data/common/gamedata/friendmap/friendmap_config_0.00.00.cfg.bin.json`
//! - 2 listes dans ce fichier :
//!   - `m_friendMapLineInfo` — 39 entrées décrivant les lignes des cartes d'amitié ;
//!     chaque entrée référence un rang (`lineNo`, local à la carte parente) et
//!     un masque d'éléments (`lineElemAry`, hash 32 bits, `0x00000000` = ligne vide).
//!   - `m_friendMapBaseInfo` — 4 cartes d'amitié, chacune référençant sa plage de lignes
//!     via `lineInfo = [offset, count]` dans `m_friendMapLineInfo`.
//!
//! - `lineInfo` suit la convention `[offset, count]` identique à `placementInfo` dans
//!   `formation_config` — utiliser [`FriendMapConfig::lines_of`] pour résoudre la tranche.
//!
//! ## Structure des cartes
//!
//! | carte | `friendMapID`  | `startY` | `startX` | lignes    |
//! |-------|---------------|----------|----------|-----------|
//! | 0     | `0x62975AF6`  | 8        | 7        | [0, 14)   |
//! | 1     | `0xFB9E0B4C`  | 2        | 7        | [14, 21)  |
//! | 2     | `0x8C993BDA`  | 4        | 4        | [21, 30)  |
//! | 3     | `0x12FDAE79`  | 4        | 5        | [30, 39)  |

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, list_values};
use crate::hash::HashId;

// ─── FRIENDMAP_LINE_INFO ───────────────────────────────────────────────────────

/// Une ligne de la carte d'amitié (`FRIENDMAP_LINE_INFO`).
///
/// Les `line_no` sont **locaux** à chaque carte parente (remis à zéro d'une carte à l'autre).
/// Utiliser [`FriendMapConfig::lines_of`] pour obtenir toutes les lignes d'une carte donnée.
///
/// # Exemple de valeurs réelles (dump `friendmap_config_0.00.00.cfg.bin.json`)
///
/// - `m_friendMapLineInfo[5]` : `line_no = 5`, `line_elem_ary = 0xE22BE2FA` (premier non-vide de la carte 0).
/// - `m_friendMapLineInfo[0]` : `line_no = 0`, `line_elem_ary = 0x00000000` (ligne vide).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FriendMapLineInfo {
    /// `lineNo` — numéro de la ligne dans la carte parente (local, remis à 0 par carte).
    pub line_no: i64,
    /// `lineElemAry` — masque d'éléments de la ligne (hash 32 bits, `0x00000000` = ligne vide).
    pub line_elem_ary: HashId,
}

impl FriendMapLineInfo {
    /// Parse une entrée de `m_friendMapLineInfo`.
    ///
    /// Renvoie `None` uniquement si le champ `lineNo` est absent ; les lignes vides
    /// (`lineElemAry = 0x00000000`) sont conservées car elles sont sémantiquement valides.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        Some(Self {
            line_no: field_i64(v, "lineNo")?,
            line_elem_ary: field_hash(v, "lineElemAry"),
        })
    }
}

// ─── FRIENDMAP_BASE_INFO ───────────────────────────────────────────────────────

/// Définition d'une carte d'amitié (`FRIENDMAP_BASE_INFO`).
///
/// `line_offset` et `line_count` permettent de résoudre la tranche correspondante dans
/// `m_friendMapLineInfo` via [`FriendMapConfig::lines_of`].
///
/// # Exemple de valeurs réelles (dump `friendmap_config_0.00.00.cfg.bin.json`)
///
/// - `m_friendMapBaseInfo[0]` : `friend_map_id = 0x62975AF6`, `start_y = 8`, `start_x = 7`,
///   `line_offset = 0`, `line_count = 14`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FriendMapBaseInfo {
    /// `friendMapID` — hash identifiant unique de la carte.
    pub friend_map_id: HashId,
    /// `startY` — ligne de départ sur la carte (coordonnée verticale).
    pub start_y: i64,
    /// `startX` — colonne de départ sur la carte (coordonnée horizontale).
    pub start_x: i64,
    /// `lineInfo[0]` — index de début dans `m_friendMapLineInfo`.
    pub line_offset: i64,
    /// `lineInfo[1]` — nombre de lignes pour cette carte.
    pub line_count: i64,
}

impl FriendMapBaseInfo {
    /// Parse une entrée de `m_friendMapBaseInfo`.
    ///
    /// Renvoie `None` si `friendMapID` est nul (sentinelle inagle = entrée invalide).
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let friend_map_id = field_hash(v, "friendMapID");
        if friend_map_id.is_zero() {
            return None;
        }
        let li = v.get("lineInfo").and_then(Value::as_array);
        Some(Self {
            friend_map_id,
            start_y: field_i64(v, "startY").unwrap_or(0),
            start_x: field_i64(v, "startX").unwrap_or(0),
            line_offset: li
                .and_then(|a| a.first())
                .and_then(Value::as_i64)
                .unwrap_or(0),
            line_count: li
                .and_then(|a| a.get(1))
                .and_then(Value::as_i64)
                .unwrap_or(0),
        })
    }
}

// ─── FriendMapConfig ──────────────────────────────────────────────────────────

/// Contenu complet d'un `friendmap_config_*.cfg.bin.json`.
///
/// Utiliser [`parse_friendmap_config`] pour construire depuis un `serde_json::Value`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FriendMapConfig {
    /// 39 lignes de carte (`m_friendMapLineInfo`) dans le dump réel.
    pub lines: Vec<FriendMapLineInfo>,
    /// 4 cartes d'amitié (`m_friendMapBaseInfo`) dans le dump réel.
    pub maps: Vec<FriendMapBaseInfo>,
}

impl FriendMapConfig {
    /// Renvoie les lignes d'une carte (tranche dans `self.lines`).
    ///
    /// Retourne `&[]` si `line_offset + line_count` dépasse la taille de la liste.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_data::friendmap::parse_friendmap_config;
    /// use serde_json::json;
    ///
    /// let root = json!({
    ///     "version": 100,
    ///     "lists": [
    ///         {
    ///             "name": "m_friendMapLineInfo",
    ///             "typeName": "FRIENDMAP_LINE_INFO",
    ///             "values": [
    ///                 { "lineNo": 0, "lineElemAry": "0x00000000" },
    ///                 { "lineNo": 1, "lineElemAry": "0xE22BE2FA" }
    ///             ]
    ///         },
    ///         {
    ///             "name": "m_friendMapBaseInfo",
    ///             "typeName": "FRIENDMAP_BASE_INFO",
    ///             "values": [
    ///                 { "friendMapID": "0x62975AF6", "startY": 8, "startX": 7, "lineInfo": [0, 2] }
    ///             ]
    ///         }
    ///     ]
    /// });
    /// let cfg = parse_friendmap_config(&root);
    /// let lignes = cfg.lines_of(&cfg.maps[0]);
    /// assert_eq!(lignes.len(), 2);
    /// ```
    #[must_use]
    pub fn lines_of(&self, map: &FriendMapBaseInfo) -> &[FriendMapLineInfo] {
        let start = map.line_offset as usize;
        let end = start.saturating_add(map.line_count as usize);
        self.lines.get(start..end).unwrap_or(&[])
    }

    /// Recherche une carte par son `friendMapID`. Renvoie `None` si absente.
    #[must_use]
    pub fn find_by_id(&self, friend_map_id: HashId) -> Option<&FriendMapBaseInfo> {
        self.maps.iter().find(|m| m.friend_map_id == friend_map_id)
    }
}

// ─── Parseur principal ────────────────────────────────────────────────────────

/// Parse un `friendmap_config_*.cfg.bin.json` complet (2 listes).
///
/// Renvoie un [`FriendMapConfig`] avec les deux listes remplies. Les entrées invalides
/// (champ `lineNo` manquant, `friendMapID` nul) sont silencieusement ignorées.
#[must_use]
pub fn parse_friendmap_config(root: &Value) -> FriendMapConfig {
    FriendMapConfig {
        lines: extract_list(root, "m_friendMapLineInfo", FriendMapLineInfo::from_value),
        maps: extract_list(root, "m_friendMapBaseInfo", FriendMapBaseInfo::from_value),
    }
}

/// Parcourt une liste nommée du JSON et applique `f` à chaque entrée.
fn extract_list<T, F>(root: &Value, name: &str, f: F) -> Vec<T>
where
    F: Fn(&Value) -> Option<T>,
{
    let mut out = Vec::new();
    if let Some(values) = list_values(root, name) {
        for v in values {
            if let Some(item) = f(v) {
                out.push(item);
            }
        }
    }
    out
}
