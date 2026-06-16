//! `BasaraCharaConfig` — port Rust de `basara_chara_config_*.cfg.bin` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! - Parser de référence : `packages/inagle/src/parsers/basara-config.ts` (`parseContent`).
//! - Dump réel (VFS) : `data/common/gamedata/character/basara_chara_config_0.00.00.00.cfg.bin`
//!   (RDBN à listes, 4491 octets).
//!
//! Le fichier contient deux listes :
//!
//! | Liste                   | typeName            | Entrées réelles | Champs                    |
//! |-------------------------|---------------------|-----------------|---------------------------|
//! | `m_basaraBuildInfoList` | `BASARA_BUILD_INFO` | 71              | `charaParamId`, `typeInfo`|
//! | `m_basaraBuildTypeList` | `BASARA_BUILD_TYPE` | 426             | `type`, `boardId`         |
//!
//! ## Sémantique
//!
//! Chaque `BASARA_BUILD_INFO` associe une variante de personnage (`charaParamId`, le même
//! hash que `CHARA_PARAM_INFO_*.charaParamId`) à une plage de builds dans
//! `m_basaraBuildTypeList`. Le champ `typeInfo` suit la convention `[offset, count]`
//! (identique à `lineInfo` de `friendmap_config` ou `placementInfo` de `formation_config`) :
//! dans le dump réel chaque perso a `count = 6` builds, et `offset = index * 6`. Utiliser
//! [`BasaraCharaConfig::types_of`] pour résoudre la tranche.
//!
//! Chaque `BASARA_BUILD_TYPE` est un couple `(type, boardId)` : `type` est l'identifiant
//! de catégorie de build (valeurs 0..=5 observées, cycle `5, 3, 1, 4, 2, 0`) et `boardId`
//! le hash du plateau de compétences (« board ») associé.
//!
//! ## Valeurs réelles observées
//!
//! `m_basaraBuildInfoList[0]` : `charaParamId = 0xA41870E9`, `typeInfo = [0, 6]`
//! → résout `m_basaraBuildTypeList[0..6]`.
//!
//! `m_basaraBuildTypeList[0..6]` :
//! `(5, 0x8F8C55E6), (3, 0x1685045C), (1, 0x618234CA), (4, 0xFFE6A169),`
//! `(2, 0x88E191FF), (0, 0x11E8C045)`.
//!
//! ## Note de portage
//!
//! Port 1:1 de `basara-config.ts` : `BasaraBuildInfo.buildTypeIndices` (TS) est le tableau
//! brut `typeInfo` — conservé tel quel dans [`BasaraBuildInfo::type_info`]. Aucune entrée
//! n'est filtrée (inagle pousse toutes les valeurs), afin de préserver l'alignement des
//! indices nécessaire à la résolution `[offset, count]`.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, list_values};
use crate::hash::HashId;

// ─── BASARA_BUILD_INFO ─────────────────────────────────────────────────────────

/// Une entrée de `m_basaraBuildInfoList` (`BASARA_BUILD_INFO`).
///
/// Associe une variante de personnage à sa plage de builds dans `m_basaraBuildTypeList`.
///
/// Port 1:1 d'inagle (`BasaraBuildInfo`) : `charaId` ← `charaParamId`,
/// `buildTypeIndices` ← `typeInfo`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BasaraBuildInfo {
    /// `charaParamId` — hash de la variante de personnage (= `CHARA_PARAM_INFO_*.charaParamId`).
    pub chara_param_id: HashId,
    /// `typeInfo` — tableau brut `[offset, count]` dans `m_basaraBuildTypeList`
    /// (inagle : `buildTypeIndices`). Conservé tel quel ; voir [`BasaraBuildInfo::type_offset`]
    /// / [`BasaraBuildInfo::type_count`] pour l'interprétation slice.
    pub type_info: Vec<i64>,
}

impl BasaraBuildInfo {
    /// Parse une entrée de `m_basaraBuildInfoList`.
    ///
    /// Renvoie `None` uniquement si `v` n'est pas un objet JSON (entrée non structurée) ;
    /// toutes les entrées réelles sont conservées (port 1:1 d'inagle, sans filtrage).
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        if !v.is_object() {
            return None;
        }
        let type_info = v
            .get("typeInfo")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_i64).collect())
            .unwrap_or_default();
        Some(Self {
            chara_param_id: field_hash(v, "charaParamId"),
            type_info,
        })
    }

    /// Index de début (`typeInfo[0]`) dans `m_basaraBuildTypeList`, ou 0 si absent.
    #[must_use]
    pub fn type_offset(&self) -> i64 {
        self.type_info.first().copied().unwrap_or(0)
    }

    /// Nombre de builds (`typeInfo[1]`), ou 0 si absent.
    #[must_use]
    pub fn type_count(&self) -> i64 {
        self.type_info.get(1).copied().unwrap_or(0)
    }
}

// ─── BASARA_BUILD_TYPE ─────────────────────────────────────────────────────────

/// Une entrée de `m_basaraBuildTypeList` (`BASARA_BUILD_TYPE`).
///
/// Couple `(type, boardId)` : catégorie de build et hash du plateau associé.
///
/// Port 1:1 d'inagle (`BasaraBuildType`) : `type` ← `type` (renommé `build_type`,
/// `type` étant un mot-clé Rust), `boardId` ← `boardId`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BasaraBuildType {
    /// `type` — identifiant de catégorie de build (0..=5 dans le dump réel).
    pub build_type: i64,
    /// `boardId` — hash du plateau de compétences (« board ») associé à ce build.
    pub board_id: HashId,
}

impl BasaraBuildType {
    /// Parse une entrée de `m_basaraBuildTypeList`.
    ///
    /// Renvoie `None` uniquement si `v` n'est pas un objet JSON. Aucune entrée valide
    /// n'est filtrée : l'alignement des indices doit être préservé pour la résolution
    /// `[offset, count]` de [`BasaraCharaConfig::types_of`].
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        if !v.is_object() {
            return None;
        }
        Some(Self {
            build_type: field_i64(v, "type").unwrap_or(0),
            board_id: field_hash(v, "boardId"),
        })
    }
}

// ─── BasaraCharaConfig ──────────────────────────────────────────────────────────

/// Contenu complet d'un `basara_chara_config_*.cfg.bin` (2 listes).
///
/// Utiliser [`parse_basara_chara_config`] pour construire depuis un `serde_json::Value`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BasaraCharaConfig {
    /// `m_basaraBuildInfoList` — 71 entrées dans le dump réel.
    pub build_infos: Vec<BasaraBuildInfo>,
    /// `m_basaraBuildTypeList` — 426 entrées dans le dump réel.
    pub build_types: Vec<BasaraBuildType>,
}

impl BasaraCharaConfig {
    /// Résout les builds d'un personnage (tranche `[offset, count)` dans `self.build_types`).
    ///
    /// Retourne `&[]` si la plage dépasse la taille de la liste.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_data::basara::parse_basara_chara_config;
    /// use nie_data::hash::HashId;
    /// use serde_json::json;
    ///
    /// let root = json!({
    ///     "lists": [
    ///         {
    ///             "name": "m_basaraBuildInfoList",
    ///             "typeName": "BASARA_BUILD_INFO",
    ///             "values": [
    ///                 { "charaParamId": "0xA41870E9", "typeInfo": [0, 2] }
    ///             ]
    ///         },
    ///         {
    ///             "name": "m_basaraBuildTypeList",
    ///             "typeName": "BASARA_BUILD_TYPE",
    ///             "values": [
    ///                 { "type": 5, "boardId": "0x8F8C55E6" },
    ///                 { "type": 3, "boardId": "0x1685045C" }
    ///             ]
    ///         }
    ///     ]
    /// });
    /// let cfg = parse_basara_chara_config(&root);
    /// let builds = cfg.types_of(&cfg.build_infos[0]);
    /// assert_eq!(builds.len(), 2);
    /// assert_eq!(builds[0].board_id, HashId(0x8F8C_55E6));
    /// ```
    #[must_use]
    pub fn types_of(&self, info: &BasaraBuildInfo) -> &[BasaraBuildType] {
        let start = info.type_offset().max(0) as usize;
        let end = start.saturating_add(info.type_count().max(0) as usize);
        self.build_types.get(start..end).unwrap_or(&[])
    }

    /// Recherche une variante de personnage par son `charaParamId`. `None` si absente.
    #[must_use]
    pub fn find_build(&self, chara_param_id: HashId) -> Option<&BasaraBuildInfo> {
        self.build_infos
            .iter()
            .find(|b| b.chara_param_id == chara_param_id)
    }
}

// ─── Parseur principal ──────────────────────────────────────────────────────────

/// Parse un `basara_chara_config_*.cfg.bin` complet (2 listes).
///
/// Port 1:1 d'inagle `loadBasaraConfig`/`parseContent` : lit `m_basaraBuildInfoList`
/// et `m_basaraBuildTypeList` par leur nom de liste, sans dépendre de leur ordre.
#[must_use]
pub fn parse_basara_chara_config(root: &Value) -> BasaraCharaConfig {
    BasaraCharaConfig {
        build_infos: extract_list(root, "m_basaraBuildInfoList", BasaraBuildInfo::from_value),
        build_types: extract_list(root, "m_basaraBuildTypeList", BasaraBuildType::from_value),
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
