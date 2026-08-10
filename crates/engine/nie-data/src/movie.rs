//! `MoviePlayingConfig` — port de `movie/movie_playing_config_*.cfg.bin` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! - Dump réel (VFS) : `data/common/gamedata/movie/movie_playing_config_1.02.28.cfg.bin`.
//! - Format **RDBN à listes** (`{ "version", "lists": [ { "name", "typeName", "values" } ] }`),
//!   décodé en forme iecode par `nie-model-serve::cfgbin_to_iecode_root` (cf. `read_values`).
//! - **Aucun parseur inagle dédié `movie` n'existe** (grep néant). La référence de portage est
//!   donc le parseur générique `packages/inagle/src/parsers/universal-gamedata.ts` (lit n'importe
//!   quel gamedata : `name`/`values`/`types`). Les structures sont **dérivées 1:1 des noms de
//!   champs RDBN auto-descriptifs** lus dans la table de types du fichier (résolus par
//!   `RdbnData::field_name`), sans sémantique inventée. Les **typos Level-5 sont préservées**
//!   (`fedeInTime`/`fedeOutTime` — « fede » pour « fade »).
//!
//! ## Les trois listes du fichier
//!
//! | Liste                          | Type                       | Lignes | Champs |
//! |--------------------------------|----------------------------|--------|--------|
//! | `m_MovieSubtitleMenuDataList`  | `MOVIE_SUBTITLE_MENU_DATA` | 3      | 7 (tous Hash) |
//! | `m_MovieSongCaptionDataList`   | `MOVIE_SONG_CAPTION_DATA`  | 0      | 4 |
//! | `m_MoviePlayingInfoList`       | `MOVIE_PLAYING_INFO`       | 219    | 12 |
//!
//! La liste song-caption est **vide dans le dump réel** (0 ligne) : ses champs sont néanmoins
//! portés depuis la table de types RDBN (`captionId` Hash, `startFrame`/`endFrame` Float,
//! `captionName` Condition) pour parser un éventuel futur dump non vide.
//!
//! ## Champs `Condition` (chemins) et sentinelle
//!
//! Les champs de type `Condition` (`moviePath`, `staffrollDataName`, `subtitle*Path`,
//! `captionName`) sont décodés soit en **chaîne réelle** (ex. `common/movie/ev90_00100.usm`),
//! soit, quand le u32 brut ne résout aucune chaîne, en littéral hexadécimal `0xFFFFFFFF` rendu
//! par le décodeur cfg.bin. On conserve la valeur **telle quelle** (byte-exact) dans une `String` ;
//! [`NONE_SENTINEL`] et les accesseurs `*_path()` permettent de distinguer « aucun chemin ».
//!
//! ## Recoupement observé (validation croisée)
//!
//! `MOVIE_SUBTITLE_MENU_DATA[0].subtitleId` = `0xC8A5975A` est exactement le `menuId` des
//! `MOVIE_PLAYING_INFO` à sous-titres (ev01_*) → la table sous-titres est indexée par ce hash.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_bool, field_hash, field_i64, field_str, list_values, owned};
use crate::hash::HashId;

/// Sentinelle « aucune valeur » des champs chaîne (`Condition`) : un `u32` `0xFFFFFFFF`
/// non résoluble en chaîne, rendu tel quel en hexadécimal par le décodeur cfg.bin.
pub const NONE_SENTINEL: &str = "0xFFFFFFFF";

/// Renvoie `Some(chemin)` si la chaîne est un vrai chemin, `None` si vide ou sentinelle.
#[must_use]
fn path_or_none(s: &str) -> Option<&str> {
    if s.is_empty() || s == NONE_SENTINEL {
        None
    } else {
        Some(s)
    }
}

/// Lit un champ flottant (`Float` RDBN) d'un objet `values[]` (`0.0` si absent).
#[must_use]
fn field_f32(v: &Value, key: &str) -> f32 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0) as f32
}

// ─── MovieSubtitleMenuData ──────────────────────────────────────────────────────

/// Entrée `MOVIE_SUBTITLE_MENU_DATA` — mise en page du menu de sous-titres d'une cinématique
/// (7 champs, tous des hash de ressources de menu/layer/locator).
///
/// Vérité terrain (`movie_playing_config_1.02.28`), ligne 0 :
/// `subtitleId=0xC8A5975A, menuCrc=0x518597B1, layerCrc=0x518597B1, textLocateCrc=0xB028913E,
///  usedGroupCrc=0x00000000, layerBGCrc=0x00000000, meshBGLocateCrc=0x00000000`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MovieSubtitleMenuData {
    /// `subtitleId` — hash identifiant le bloc de sous-titres (recoupe `MoviePlayingInfo.menu_id`).
    pub subtitle_id: HashId,
    /// `menuCrc` — hash du menu de sous-titres à instancier.
    pub menu_crc: HashId,
    /// `layerCrc` — hash du layer de menu (= `menuCrc` dans le dump réel).
    pub layer_crc: HashId,
    /// `textLocateCrc` — hash du locator de position du texte.
    pub text_locate_crc: HashId,
    /// `usedGroupCrc` — hash du groupe utilisé (souvent 0).
    pub used_group_crc: HashId,
    /// `layerBGCrc` — hash du layer d'arrière-plan (0 si aucun).
    pub layer_bg_crc: HashId,
    /// `meshBGLocateCrc` — hash du locator de l'arrière-plan (0 si aucun).
    pub mesh_bg_locate_crc: HashId,
}

impl MovieSubtitleMenuData {
    /// Construit depuis un objet `values[]` (forme iecode). Les clés sont les noms de champs RDBN.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            subtitle_id: field_hash(v, "subtitleId"),
            menu_crc: field_hash(v, "menuCrc"),
            layer_crc: field_hash(v, "layerCrc"),
            text_locate_crc: field_hash(v, "textLocateCrc"),
            used_group_crc: field_hash(v, "usedGroupCrc"),
            layer_bg_crc: field_hash(v, "layerBGCrc"),
            mesh_bg_locate_crc: field_hash(v, "meshBGLocateCrc"),
        }
    }
}

// ─── MovieSongCaptionData ───────────────────────────────────────────────────────

/// Entrée `MOVIE_SONG_CAPTION_DATA` — une légende (parole) affichée sur une plage d'images
/// d'une cinématique chantée (4 champs). **Liste vide dans le dump réel** ; structure dérivée
/// de la table de types RDBN (`captionId` Hash, `startFrame`/`endFrame` Float, `captionName`
/// Condition).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MovieSongCaptionData {
    /// `captionId` — hash identifiant la légende.
    pub caption_id: HashId,
    /// `startFrame` — image de début d'affichage.
    pub start_frame: f32,
    /// `endFrame` — image de fin d'affichage.
    pub end_frame: f32,
    /// `captionName` — nom/clé de la légende (chemin/texte, [`NONE_SENTINEL`] si aucun).
    pub caption_name: String,
}

impl MovieSongCaptionData {
    /// Construit depuis un objet `values[]` (forme iecode).
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            caption_id: field_hash(v, "captionId"),
            start_frame: field_f32(v, "startFrame"),
            end_frame: field_f32(v, "endFrame"),
            caption_name: field_str(v, "captionName").map_or_else(String::new, owned),
        }
    }

    /// Nom de légende réel, ou `None` si vide / sentinelle.
    #[must_use]
    pub fn caption_name_path(&self) -> Option<&str> {
        path_or_none(&self.caption_name)
    }
}

// ─── MoviePlayingInfo ───────────────────────────────────────────────────────────

/// Entrée `MOVIE_PLAYING_INFO` — comment lire une cinématique : fichier `.usm`, BGM, fondus,
/// staffroll et sous-titres (12 champs).
///
/// Vérité terrain (`movie_playing_config_1.02.28`), ligne 0 :
/// `movieId=0x15F883E4, menuId=0, captionId=0, moviePath="common/movie/ev90_00100.usm",
///  bgmName=0x15F883E4, fedeInTime=1.0, fedeOutTime=1.0, staffrollDataName="ed_01",
///  subtitleTextPath=0xFFFFFFFF, subtitleSettingPath=0xFFFFFFFF, notStopBgmOnMovieEnd=false,
///  fadeMethodType=0`.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MoviePlayingInfo {
    /// `movieId` — hash identifiant la cinématique (clé de recherche en jeu).
    pub movie_id: HashId,
    /// `menuId` — hash du menu de sous-titres associé (0 si aucun ; recoupe `MovieSubtitleMenuData.subtitle_id`).
    pub menu_id: HashId,
    /// `captionId` — hash de la légende/chanson associée (0 si aucune).
    pub caption_id: HashId,
    /// `moviePath` — chemin du fichier vidéo `.usm` (ex. `common/movie/ev90_00100.usm`).
    pub movie_path: String,
    /// `bgmName` — hash de la musique de fond jouée pendant la cinématique (0 si aucune).
    pub bgm_name: HashId,
    /// `fedeInTime` — durée du fondu d'entrée en secondes (typo Level-5 : « fede » = « fade »).
    pub fede_in_time: f32,
    /// `fedeOutTime` — durée du fondu de sortie en secondes (typo Level-5 préservée).
    pub fede_out_time: f32,
    /// `staffrollDataName` — nom des données de staffroll (ex. `ed_01`, [`NONE_SENTINEL`] si aucun).
    pub staffroll_data_name: String,
    /// `subtitleTextPath` — chemin du `.cfg.bin` de texte des sous-titres ([`NONE_SENTINEL`] si aucun).
    pub subtitle_text_path: String,
    /// `subtitleSettingPath` — chemin du `.cfg.bin` de réglage des sous-titres ([`NONE_SENTINEL`] si aucun).
    pub subtitle_setting_path: String,
    /// `notStopBgmOnMovieEnd` — `true` : ne pas couper la BGM à la fin de la cinématique.
    pub not_stop_bgm_on_movie_end: bool,
    /// `fadeMethodType` — méthode de fondu (octet ; valeurs observées : 0 et 1).
    pub fade_method_type: i64,
}

impl MoviePlayingInfo {
    /// Construit depuis un objet `values[]` (forme iecode).
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            movie_id: field_hash(v, "movieId"),
            menu_id: field_hash(v, "menuId"),
            caption_id: field_hash(v, "captionId"),
            movie_path: field_str(v, "moviePath").map_or_else(String::new, owned),
            bgm_name: field_hash(v, "bgmName"),
            fede_in_time: field_f32(v, "fedeInTime"),
            fede_out_time: field_f32(v, "fedeOutTime"),
            staffroll_data_name: field_str(v, "staffrollDataName").map_or_else(String::new, owned),
            subtitle_text_path: field_str(v, "subtitleTextPath").map_or_else(String::new, owned),
            subtitle_setting_path: field_str(v, "subtitleSettingPath")
                .map_or_else(String::new, owned),
            not_stop_bgm_on_movie_end: field_bool(v, "notStopBgmOnMovieEnd").unwrap_or(false),
            fade_method_type: field_i64(v, "fadeMethodType").unwrap_or(0),
        }
    }

    /// Chemin du fichier `.usm` réel, ou `None` si vide / sentinelle.
    #[must_use]
    pub fn movie_usm_path(&self) -> Option<&str> {
        path_or_none(&self.movie_path)
    }

    /// Nom des données de staffroll réel, ou `None` si vide / sentinelle.
    #[must_use]
    pub fn staffroll_path(&self) -> Option<&str> {
        path_or_none(&self.staffroll_data_name)
    }

    /// Chemin du texte de sous-titres réel, ou `None` si vide / sentinelle.
    #[must_use]
    pub fn subtitle_text(&self) -> Option<&str> {
        path_or_none(&self.subtitle_text_path)
    }

    /// Chemin du réglage de sous-titres réel, ou `None` si vide / sentinelle.
    #[must_use]
    pub fn subtitle_setting(&self) -> Option<&str> {
        path_or_none(&self.subtitle_setting_path)
    }
}

// ─── MoviePlayingConfig ─────────────────────────────────────────────────────────

/// Contenu complet d'un `movie_playing_config_*.cfg.bin` (les trois listes).
///
/// Construire via [`parse_movie_playing_config`].
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MoviePlayingConfig {
    /// `m_MovieSubtitleMenuDataList` — mises en page de menus de sous-titres (3 dans le dump réel).
    pub subtitle_menus: Vec<MovieSubtitleMenuData>,
    /// `m_MovieSongCaptionDataList` — légendes de chansons (0 dans le dump réel).
    pub song_captions: Vec<MovieSongCaptionData>,
    /// `m_MoviePlayingInfoList` — configurations de lecture de cinématiques (219 dans le dump réel).
    pub playing_infos: Vec<MoviePlayingInfo>,
}

impl MoviePlayingConfig {
    /// Recherche une cinématique par son `movie_id`. `None` si absente.
    #[must_use]
    pub fn find_movie(&self, movie_id: HashId) -> Option<&MoviePlayingInfo> {
        self.playing_infos.iter().find(|m| m.movie_id == movie_id)
    }

    /// Résout le menu de sous-titres référencé par une cinématique (`menu_id` →
    /// `MovieSubtitleMenuData.subtitle_id`). `None` si la cinématique n'a pas de sous-titres.
    #[must_use]
    pub fn subtitle_menu_of(&self, info: &MoviePlayingInfo) -> Option<&MovieSubtitleMenuData> {
        if info.menu_id.is_zero() {
            return None;
        }
        self.subtitle_menus
            .iter()
            .find(|s| s.subtitle_id == info.menu_id)
    }
}

// ─── Parseur principal ───────────────────────────────────────────────────────────

/// Parse une liste nommée de la forme iecode via `f` appliqué à chaque objet `values[]`.
fn parse_list<T, F>(root: &Value, list_name: &str, f: F) -> Vec<T>
where
    F: Fn(&Value) -> T,
{
    list_values(root, list_name)
        .map(|vals| vals.iter().map(f).collect())
        .unwrap_or_default()
}

/// Parse un `movie_playing_config_*.cfg.bin` complet (forme iecode `{ "lists": [...] }`).
///
/// Comptes réels (`movie_playing_config_1.02.28`) : 3 subtitle menus, 0 song captions,
/// 219 playing infos.
#[must_use]
pub fn parse_movie_playing_config(root: &Value) -> MoviePlayingConfig {
    MoviePlayingConfig {
        subtitle_menus: parse_list(
            root,
            "m_MovieSubtitleMenuDataList",
            MovieSubtitleMenuData::from_value,
        ),
        song_captions: parse_list(
            root,
            "m_MovieSongCaptionDataList",
            MovieSongCaptionData::from_value,
        ),
        playing_infos: parse_list(root, "m_MoviePlayingInfoList", MoviePlayingInfo::from_value),
    }
}
