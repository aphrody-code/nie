//! `GalleryConfig` — port Rust de `gallery_config_*.cfg.bin.json` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `/home/ubuntu/niers/data/common/gamedata/gallery/gallery_config_1.03.71.00.cfg.bin.json`
//! - 1 liste dans ce fichier :
//!   - `m_GalleryInfoList` — 360 entrées `GALLERY_INFO`, chacune décrivant une illustration
//!     débloquable dans la galerie du jeu.
//!
//! ## Champs observés sur le dump réel
//!
//! | Champ        | Type JSON   | Sémantique observée                                           |
//! |--------------|-------------|---------------------------------------------------------------|
//! | `galleryId`  | hex string  | Identifiant hash de l'entrée galerie (ex. `"0x33AF67B0"`)    |
//! | `imgPath`    | string      | Nom du fichier image pleine résolution (sans extension)       |
//! | `thumbPath`  | string      | Nom du fichier miniature (sans extension)                     |
//! | `needTokenNum` | integer   | Nombre de tokens requis pour le déblocage (= 1 dans le dump) |
//! | `flgNo`      | integer     | Numéro de flag de progression (0..367 ; quelques gaps)        |
//! | `openCond`   | string      | Condition d'ouverture : base64 opaque ou marqueur textuel     |
//!
//! Note : les dernières entrées (à partir de l'index ~344) ont `openCond = "\x01GALLERY_INFO"`
//! au lieu du base64 habituel — il s'agit d'un marqueur de type interne du format cfg.bin.
//!
//! ## Accesseurs
//!
//! - [`GalleryConfig::find_by_id`] — recherche par `galleryId`.
//! - [`GalleryConfig::find_by_flg_no`] — recherche par `flgNo`.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, field_str, list_values};
use crate::hash::HashId;

// ─── GalleryInfo ──────────────────────────────────────────────────────────────

/// Entrée `GALLERY_INFO` — illustration débloquable dans la galerie IEVR.
///
/// Vérité terrain : `gallery_config_1.03.71.00.cfg.bin.json`, liste `m_GalleryInfoList`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct GalleryInfo {
    /// `galleryId` — identifiant hash de l'entrée (ex. `0x33AF67B0`).
    ///
    /// Vérité terrain : `m_GalleryInfoList[0].galleryId = "0x33AF67B0"`.
    pub gallery_id: HashId,
    /// `imgPath` — chemin de l'image pleine résolution (sans extension ni préfixe de pack).
    ///
    /// Vérité terrain : `m_GalleryInfoList[0].imgPath = "img_story_ev01_main_0010"`.
    pub img_path: String,
    /// `thumbPath` — chemin de la miniature (sans extension).
    ///
    /// Vérité terrain : `m_GalleryInfoList[0].thumbPath = "thumb_story_ev01_main_0010"`.
    pub thumb_path: String,
    /// `needTokenNum` — nombre de tokens requis pour débloquer l'entrée (= 1 dans tout le dump).
    pub need_token_num: i64,
    /// `flgNo` — numéro de flag de progression associé à cette entrée (0-basé, non séquentiel).
    ///
    /// Quelques numéros sont absents (gaps observés : 48, 233–236, 253, 255, 256).
    pub flg_no: i64,
    /// `openCond` — condition d'ouverture : chaîne base64 opaque (données binaires),
    /// ou `"\x01GALLERY_INFO"` pour les entrées de type marqueur interne (dernières ~16 entrées).
    pub open_cond: String,
}

impl GalleryInfo {
    /// Parse une entrée de `m_GalleryInfoList`. `None` si `galleryId` est nul ou absent.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let gallery_id = field_hash(v, "galleryId");
        if gallery_id.is_zero() {
            return None;
        }
        Some(Self {
            gallery_id,
            img_path: field_str(v, "imgPath").unwrap_or("").into(),
            thumb_path: field_str(v, "thumbPath").unwrap_or("").into(),
            need_token_num: field_i64(v, "needTokenNum").unwrap_or(0),
            flg_no: field_i64(v, "flgNo").unwrap_or(0),
            open_cond: field_str(v, "openCond").unwrap_or("").into(),
        })
    }
}

// ─── GalleryConfig ────────────────────────────────────────────────────────────

/// Contenu complet d'un `gallery_config_*.cfg.bin.json`.
///
/// Utiliser [`parse_gallery_config`] pour construire depuis un `serde_json::Value`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct GalleryConfig {
    /// 360 entrées galerie (`m_GalleryInfoList`).
    pub entries: Vec<GalleryInfo>,
}

impl GalleryConfig {
    /// Recherche une entrée par son `galleryId`. `None` si absente.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_data::gallery::{GalleryInfo, GalleryConfig};
    /// use nie_data::hash::HashId;
    ///
    /// let config = GalleryConfig {
    ///     entries: vec![GalleryInfo {
    ///         gallery_id: HashId(0x33AF67B0),
    ///         img_path: "img_story_ev01_main_0010".into(),
    ///         thumb_path: "thumb_story_ev01_main_0010".into(),
    ///         need_token_num: 1,
    ///         flg_no: 0,
    ///         open_cond: "AAAAAA8FNbkZNtoAAQAyAABOKnE=".into(),
    ///     }],
    /// };
    /// assert!(config.find_by_id(HashId(0x33AF67B0)).is_some());
    /// assert!(config.find_by_id(HashId(0xDEADBEEF)).is_none());
    /// ```
    #[must_use]
    pub fn find_by_id(&self, gallery_id: HashId) -> Option<&GalleryInfo> {
        self.entries.iter().find(|e| e.gallery_id == gallery_id)
    }

    /// Recherche une entrée par son `flgNo`. `None` si absente.
    #[must_use]
    pub fn find_by_flg_no(&self, flg_no: i64) -> Option<&GalleryInfo> {
        self.entries.iter().find(|e| e.flg_no == flg_no)
    }
}

// ─── Parseur principal ────────────────────────────────────────────────────────

/// Parse un `gallery_config_*.cfg.bin.json` complet (liste `m_GalleryInfoList`).
///
/// Renvoie un [`GalleryConfig`] avec toutes les entrées valides (galleryId non-nul).
/// Les entrées invalides sont silencieusement ignorées.
///
/// Compte réel : `gallery_config_1.03.71.00.cfg.bin.json` → 360 entrées.
#[must_use]
pub fn parse_gallery_config(root: &Value) -> GalleryConfig {
    let entries = if let Some(values) = list_values(root, "m_GalleryInfoList") {
        let mut out = Vec::new();
        for v in values {
            if let Some(info) = GalleryInfo::from_value(v) {
                out.push(info);
            }
        }
        out
    } else {
        Vec::new()
    };
    GalleryConfig { entries }
}
