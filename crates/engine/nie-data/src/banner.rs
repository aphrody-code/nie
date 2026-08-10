//! `BannerConfig` — port Rust de `tutorial_banner_config_*.cfg.bin.json` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `/home/ubuntu/niers/data/common/gamedata/banner/tutorial_banner_config_0.00.00.cfg.bin.json`
//! - Une seule liste dans ce fichier :
//!   - `m_tutorialBannerInfoList` — 3 entrées de type `TUTORIAL_BANNER_INFO` décrivant
//!     les bannières tutoriel affichées en jeu (icône, texte titre, texte explication,
//!     compteur de complétion et numéro de flag de progression).
//!
//! ## Format
//!
//! Fichier au format **`lists`** (champs nommés), identique à `formation_config`.
//! Chaque entrée `TUTORIAL_BANNER_INFO` possède 6 champs :
//!
//! | Champ JSON        | Type  | Exemple (entrée 0)   | Sémantique                                |
//! |-------------------|-------|----------------------|-------------------------------------------|
//! | `id`              | hex   | `"0x74AD78BE"`       | Identifiant unique de la bannière          |
//! | `titleTextId`     | hex   | `"0x968619E7"`       | Hash du texte titre (jointure texte)       |
//! | `explainTextId`   | hex   | `"0x968619E7"`       | Hash du texte explication                  |
//! | `iconTextureName` | hex   | `"0xCF0200B5"`       | Hash du nom de texture d'icône             |
//! | `count`           | i64   | `1`                  | Nombre d'actions requises pour valider     |
//! | `flagNum`         | i64   | `1`                  | Numéro de flag de progression tutoriel     |

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, list_values};
use crate::hash::HashId;

// ─── TutorialBannerInfo ───────────────────────────────────────────────────────

/// Entrée `TUTORIAL_BANNER_INFO` — bannière tutoriel affichée pendant le jeu.
///
/// Extrait de `m_tutorialBannerInfoList` dans `tutorial_banner_config_*.cfg.bin.json`.
/// Les champs `titleTextId` et `explainTextId` sont des hashes de texte localisé ;
/// dans le dump réel les 3 entrées partagent la même valeur `0x968619E7` pour ces deux champs.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TutorialBannerInfo {
    /// `id` — identifiant unique de la bannière tutoriel.
    pub id: HashId,
    /// `titleTextId` — hash du texte titre affiché dans la bannière (jointure texte localisé).
    pub title_text_id: HashId,
    /// `explainTextId` — hash du texte d'explication (jointure texte localisé).
    pub explain_text_id: HashId,
    /// `iconTextureName` — hash du nom de texture de l'icône associée à la bannière.
    pub icon_texture_name: HashId,
    /// `count` — nombre d'actions requises pour valider la bannière (1 pour la première entrée).
    pub count: i64,
    /// `flagNum` — numéro du flag de progression tutoriel lié à cette bannière.
    pub flag_num: i64,
}

impl TutorialBannerInfo {
    /// Parse une entrée de `m_tutorialBannerInfoList`. `None` si `id` est absent ou nul.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let id = field_hash(v, "id");
        if id.is_zero() {
            return None;
        }
        Some(Self {
            id,
            title_text_id: field_hash(v, "titleTextId"),
            explain_text_id: field_hash(v, "explainTextId"),
            icon_texture_name: field_hash(v, "iconTextureName"),
            count: field_i64(v, "count").unwrap_or(0),
            flag_num: field_i64(v, "flagNum").unwrap_or(0),
        })
    }
}

// ─── BannerConfig ─────────────────────────────────────────────────────────────

/// Contenu complet d'un `tutorial_banner_config_*.cfg.bin.json`.
///
/// Utiliser [`parse_banner_config`] pour construire depuis un JSON déjà désérialisé.
///
/// # Exemple
///
/// ```
/// use nie_data::banner::parse_banner_config;
/// use nie_data::hash::HashId;
/// use serde_json::json;
///
/// let json = json!({
///     "version": 100,
///     "lists": [{
///         "name": "m_tutorialBannerInfoList",
///         "typeName": "TUTORIAL_BANNER_INFO",
///         "values": [{
///             "id": "0x74AD78BE",
///             "titleTextId": "0x968619E7",
///             "explainTextId": "0x968619E7",
///             "iconTextureName": "0xCF0200B5",
///             "count": 1,
///             "flagNum": 1
///         }]
///     }]
/// });
/// let cfg = parse_banner_config(&json);
/// assert_eq!(cfg.banners.len(), 1);
/// assert_eq!(cfg.banners[0].id, HashId(0x74AD78BE));
/// assert_eq!(cfg.banners[0].count, 1);
/// ```
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BannerConfig {
    /// Bannières tutoriel (`m_tutorialBannerInfoList`) — 3 entrées dans le dump réel.
    pub banners: Vec<TutorialBannerInfo>,
}

impl BannerConfig {
    /// Recherche une bannière par son `id`. `None` si absente.
    #[must_use]
    pub fn find_by_id(&self, id: HashId) -> Option<&TutorialBannerInfo> {
        self.banners.iter().find(|b| b.id == id)
    }
}

// ─── Parseur principal ────────────────────────────────────────────────────────

/// Parse un `tutorial_banner_config_*.cfg.bin.json` complet.
///
/// Renvoie un [`BannerConfig`] avec la liste des bannières remplie. Les entrées sans `id`
/// valide sont silencieusement ignorées.
#[must_use]
pub fn parse_banner_config(root: &Value) -> BannerConfig {
    let mut banners = Vec::new();
    if let Some(values) = list_values(root, "m_tutorialBannerInfoList") {
        for v in values {
            if let Some(item) = TutorialBannerInfo::from_value(v) {
                banners.push(item);
            }
        }
    }
    BannerConfig { banners }
}
