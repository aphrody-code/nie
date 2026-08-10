//! `SceneArchiveConfig` — port Rust de `scene_archive_config_*.cfg.bin.json` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `/home/ubuntu/niers/data/common/gamedata/scene_archive/scene_archive_config_4.00.18.00.cfg.bin.json`
//! - 2 listes dans ce fichier (format `lists`, comme `formation_config`) :
//!   - `m_sceneArchiveFlags` — 6 entrées `SCENE_ARCHIVE_FLAGS`, chacune portant
//!     un `activeTempBitFlagCrc` (hash CRC du flag de progression actif).
//!   - `m_sceneArchiveDataList` — 112 entrées `SCENE_ARCHIVE_LIST_DATA`, chacune
//!     décrivant une scène de l'archive théâtre (cutscenes débloquées au fil de la
//!     progression), référençant l'événement vidéo (`event_id_text`), sa position sur
//!     la carte (`map_id`, `map_jump_pos_*`) et sa condition de déblocage (`condition`).
//!
//! ## Champs observés sur le dump réel
//!
//! ### `SCENE_ARCHIVE_FLAGS`
//!
//! | Champ                  | Type JSON  | Sémantique observée                          |
//! |------------------------|------------|----------------------------------------------|
//! | `activeTempBitFlagCrc` | hex string | CRC hash du flag de progression (ex. `"0xADCDB833"`) |
//!
//! ### `SCENE_ARCHIVE_LIST_DATA`
//!
//! | Champ                    | Type JSON   | Sémantique observée                                  |
//! |--------------------------|-------------|------------------------------------------------------|
//! | `id`                     | hex string  | Identifiant unique de la scène (ex. `"0xF86C637D"`) |
//! | `category`               | integer     | Catégorie (0 = histoire principale, 2 = side)        |
//! | `flag_num`               | integer     | Numéro de flag de progression (= 1 dans tout le dump)|
//! | `text_id_title`          | hex string  | Hash du texte de titre de la scène                   |
//! | `text_id_explain`        | hex string  | Hash du texte explicatif (souvent `0x00000000`)      |
//! | `event_type`             | integer     | Type d'événement (0 = cutscene, 1 = autre)           |
//! | `event_id_text`          | string      | Identifiant textuel de l'événement (ex. `"ev01_00050"`) |
//! | `map_id`                 | hex string  | Hash de la carte associée (souvent `0x00000000`)     |
//! | `map_tag_id`             | hex string  | Hash du tag de position carte                        |
//! | `map_jump_pos_x/y/z`     | integer     | Coordonnées de téléportation carte (souvent 0)       |
//! | `chapter_no`             | integer     | Numéro de chapitre (0-8 dans le dump)                |
//! | `is_full_screen_view`    | bool        | Affichage plein écran (toujours `false` dans le dump)|
//! | `thumbnail_texture_name` | hex string  | Hash du nom de texture miniature                     |
//! | `thumbnail_texture_path` | string      | Chemin de la texture miniature (`.g4tx`)             |
//! | `condition`              | string      | Condition de déblocage (base64 opaque)               |
//! | `activeFlags`            | int array   | Deux indices de flags actifs (ex. `[0, 0]`)          |
//!
//! ## Accesseurs
//!
//! - [`SceneArchiveConfig::find_by_id`] — recherche une scène par `id`.
//! - [`SceneArchiveConfig::filter_by_chapter`] — filtre les scènes d'un chapitre.
//! - [`SceneArchiveConfig::filter_by_category`] — filtre les scènes d'une catégorie.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_bool, field_hash, field_i64, field_str, list_values};
use crate::hash::HashId;

// ─── SceneArchiveFlag ─────────────────────────────────────────────────────────

/// Entrée `SCENE_ARCHIVE_FLAGS` — flag de progression actif de l'archive théâtre.
///
/// Vérité terrain : `scene_archive_config_4.00.18.00.cfg.bin.json`,
/// liste `m_sceneArchiveFlags`, 6 entrées.
///
/// Exemple : `m_sceneArchiveFlags[0].activeTempBitFlagCrc = "0xADCDB833"`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SceneArchiveFlag {
    /// `activeTempBitFlagCrc` — hash CRC du flag de progression actif.
    ///
    /// Vérité terrain : `m_sceneArchiveFlags[0] = "0xADCDB833"`.
    pub active_temp_bit_flag_crc: HashId,
}

impl SceneArchiveFlag {
    /// Parse une entrée de `m_sceneArchiveFlags`.
    /// Renvoie `None` si le hash est absent.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let h = field_hash(v, "activeTempBitFlagCrc");
        // On accepte aussi les hash nuls (entrée valide même si CRC = 0).
        let _ = v.get("activeTempBitFlagCrc")?; // garantit que le champ existe
        Some(Self {
            active_temp_bit_flag_crc: h,
        })
    }
}

// ─── SceneArchiveData ─────────────────────────────────────────────────────────

/// Entrée `SCENE_ARCHIVE_LIST_DATA` — scène débloquable dans l'archive théâtre IEVR.
///
/// Vérité terrain : `scene_archive_config_4.00.18.00.cfg.bin.json`,
/// liste `m_sceneArchiveDataList`, 112 entrées.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SceneArchiveData {
    /// `id` — identifiant hash unique de la scène (ex. `0xF86C637D`).
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[0].id = "0xF86C637D"`.
    pub id: HashId,

    /// `category` — catégorie de la scène (0 = histoire principale, 2 = side story).
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[0].category = 0` ;
    /// `m_sceneArchiveDataList[111].category = 2`.
    pub category: i64,

    /// `flag_num` — numéro de flag de progression associé (= 1 pour toutes les 112 entrées).
    pub flag_num: i64,

    /// `text_id_title` — hash du texte de titre de la scène.
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[0].text_id_title = "0x35B80566"`.
    pub text_id_title: HashId,

    /// `text_id_explain` — hash du texte explicatif (souvent `0x00000000` dans le dump).
    pub text_id_explain: HashId,

    /// `event_type` — type d'événement (0 = cutscene standard, 1 = autre).
    pub event_type: i64,

    /// `event_id_text` — identifiant textuel de l'événement vidéo (ex. `"ev01_00050"`).
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[0].event_id_text = "ev01_00050"`.
    pub event_id_text: String,

    /// `map_id` — hash de la carte associée pour la téléportation (souvent `0x00000000`).
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[4].map_id = "0x4E7B90D9"`.
    pub map_id: HashId,

    /// `map_tag_id` — hash du tag de position sur la carte.
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[20].map_tag_id = "0x11F87078"`.
    pub map_tag_id: HashId,

    /// `map_jump_pos_x` — coordonnée X de téléportation (0 dans la majorité des entrées).
    pub map_jump_pos_x: i64,

    /// `map_jump_pos_y` — coordonnée Y de téléportation.
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[17].map_jump_pos_y = 30`.
    pub map_jump_pos_y: i64,

    /// `map_jump_pos_z` — coordonnée Z de téléportation.
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[17].map_jump_pos_z = -187`.
    pub map_jump_pos_z: i64,

    /// `chapter_no` — numéro de chapitre de la scène (0-8 dans le dump).
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[20].chapter_no = 1` ;
    /// `m_sceneArchiveDataList[83].chapter_no = 8`.
    pub chapter_no: i64,

    /// `is_full_screen_view` — affichage plein écran (toujours `false` dans le dump réel).
    pub is_full_screen_view: bool,

    /// `thumbnail_texture_name` — hash du nom de texture miniature.
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[0].thumbnail_texture_name = "0x412B0428"`.
    pub thumbnail_texture_name: HashId,

    /// `thumbnail_texture_path` — chemin de la texture miniature (format `.g4tx`, préfixe `#/`).
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[0].thumbnail_texture_path =
    /// "#/menu/220_img/theater_img/theater_img01_02.g4tx"`.
    pub thumbnail_texture_path: String,

    /// `condition` — condition de déblocage, encodée en base64 (données binaires opaques).
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[0].condition =
    /// "AAAAABgFNSo9RUMACgEoAAYCNNG3Zz4yAAAAAXg="`.
    pub condition: String,

    /// `activeFlags` — deux indices de flags actifs pour cette scène (ex. `[0, 0]`).
    ///
    /// Toujours un tableau de 2 entiers dans le dump. Vérité terrain :
    /// `m_sceneArchiveDataList[4].activeFlags = [0, 1]`.
    pub active_flags: Vec<i64>,
}

impl SceneArchiveData {
    /// Parse une entrée de `m_sceneArchiveDataList`. `None` si `id` est absent ou nul.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let id = field_hash(v, "id");
        if id.is_zero() {
            return None;
        }
        let active_flags = v
            .get("activeFlags")
            .and_then(Value::as_array)
            .map(|arr| arr.iter().map(|x| x.as_i64().unwrap_or(0)).collect())
            .unwrap_or_default();

        Some(Self {
            id,
            category: field_i64(v, "category").unwrap_or(0),
            flag_num: field_i64(v, "flag_num").unwrap_or(0),
            text_id_title: field_hash(v, "text_id_title"),
            text_id_explain: field_hash(v, "text_id_explain"),
            event_type: field_i64(v, "event_type").unwrap_or(0),
            event_id_text: field_str(v, "event_id_text").unwrap_or("").into(),
            map_id: field_hash(v, "map_id"),
            map_tag_id: field_hash(v, "map_tag_id"),
            map_jump_pos_x: field_i64(v, "map_jump_pos_x").unwrap_or(0),
            map_jump_pos_y: field_i64(v, "map_jump_pos_y").unwrap_or(0),
            map_jump_pos_z: field_i64(v, "map_jump_pos_z").unwrap_or(0),
            chapter_no: field_i64(v, "chapter_no").unwrap_or(0),
            is_full_screen_view: field_bool(v, "is_full_screen_view").unwrap_or(false),
            thumbnail_texture_name: field_hash(v, "thumbnail_texture_name"),
            thumbnail_texture_path: field_str(v, "thumbnail_texture_path").unwrap_or("").into(),
            condition: field_str(v, "condition").unwrap_or("").into(),
            active_flags,
        })
    }
}

// ─── SceneArchiveConfig ───────────────────────────────────────────────────────

/// Contenu complet d'un `scene_archive_config_*.cfg.bin.json`.
///
/// Utiliser [`parse_scene_archive_config`] pour construire depuis un `serde_json::Value`.
///
/// # Exemple
///
/// ```
/// use nie_data::scene_archive::{SceneArchiveData, SceneArchiveConfig};
/// use nie_data::hash::HashId;
///
/// let config = SceneArchiveConfig {
///     flags: vec![],
///     scenes: vec![SceneArchiveData {
///         id: HashId(0xF86C637D),
///         category: 0,
///         flag_num: 1,
///         text_id_title: HashId(0x35B80566),
///         text_id_explain: HashId(0),
///         event_type: 0,
///         event_id_text: "ev01_00050".into(),
///         map_id: HashId(0),
///         map_tag_id: HashId(0),
///         map_jump_pos_x: 0,
///         map_jump_pos_y: 0,
///         map_jump_pos_z: 0,
///         chapter_no: 0,
///         is_full_screen_view: false,
///         thumbnail_texture_name: HashId(0x412B0428),
///         thumbnail_texture_path: "#/menu/220_img/theater_img/theater_img01_02.g4tx".into(),
///         condition: "AAAAABgFNSo9RUMACgEoAAYCNNG3Zz4yAAAAAXg=".into(),
///         active_flags: vec![0, 0],
///     }],
/// };
/// assert!(config.find_by_id(HashId(0xF86C637D)).is_some());
/// assert!(config.find_by_id(HashId(0xDEADBEEF)).is_none());
/// ```
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SceneArchiveConfig {
    /// 6 flags de progression actifs (`m_sceneArchiveFlags`).
    pub flags: Vec<SceneArchiveFlag>,
    /// 112 scènes débloquables (`m_sceneArchiveDataList`).
    pub scenes: Vec<SceneArchiveData>,
}

impl SceneArchiveConfig {
    /// Recherche une scène par son `id`. `None` si absente.
    ///
    /// Vérité terrain : `m_sceneArchiveDataList[0].id = "0xF86C637D"`.
    #[must_use]
    pub fn find_by_id(&self, id: HashId) -> Option<&SceneArchiveData> {
        self.scenes.iter().find(|s| s.id == id)
    }

    /// Renvoie toutes les scènes du chapitre donné.
    ///
    /// Vérité terrain : `chapter_no` va de 0 à 8 dans le dump réel.
    #[must_use]
    pub fn filter_by_chapter(&self, chapter_no: i64) -> Vec<&SceneArchiveData> {
        self.scenes
            .iter()
            .filter(|s| s.chapter_no == chapter_no)
            .collect()
    }

    /// Renvoie toutes les scènes d'une catégorie donnée.
    ///
    /// Vérité terrain : catégorie 0 = histoire principale, 2 = side story.
    #[must_use]
    pub fn filter_by_category(&self, category: i64) -> Vec<&SceneArchiveData> {
        self.scenes
            .iter()
            .filter(|s| s.category == category)
            .collect()
    }
}

// ─── Parseur principal ────────────────────────────────────────────────────────

/// Parse un `scene_archive_config_*.cfg.bin.json` complet (2 listes).
///
/// Renvoie un [`SceneArchiveConfig`] avec les flags et les scènes valides.
/// Les entrées avec `id` nul sont silencieusement ignorées.
///
/// Comptes réels : `scene_archive_config_4.00.18.00.cfg.bin.json` →
/// 6 `SCENE_ARCHIVE_FLAGS` + 112 `SCENE_ARCHIVE_LIST_DATA`.
#[must_use]
pub fn parse_scene_archive_config(root: &Value) -> SceneArchiveConfig {
    let flags = if let Some(values) = list_values(root, "m_sceneArchiveFlags") {
        let mut out = Vec::new();
        for v in values {
            if let Some(flag) = SceneArchiveFlag::from_value(v) {
                out.push(flag);
            }
        }
        out
    } else {
        Vec::new()
    };

    let scenes = if let Some(values) = list_values(root, "m_sceneArchiveDataList") {
        let mut out = Vec::new();
        for v in values {
            if let Some(scene) = SceneArchiveData::from_value(v) {
                out.push(scene);
            }
        }
        out
    } else {
        Vec::new()
    };

    SceneArchiveConfig { flags, scenes }
}
