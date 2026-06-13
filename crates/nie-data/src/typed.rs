//! Dispatch **typé** des `cfg.bin` : d'une `Value` au format iecode (`lists`/`entries`) +
//! d'une clé de famille (dérivée du nom de fichier), vers la structure de jeu nommée
//! correspondante sérialisée en JSON. Partagé entre `nie-model-serve` (route `/typed`) et
//! `nie-wasm` (décodage in-browser) — source unique des 37 familles couvertes.
//!
//! `no_std + alloc` : `serde_json::to_value` fonctionne en mode `alloc`. Gated `serde`
//! (les structures de famille ne dérivent `Serialize` que sous cette feature).
#![cfg(feature = "serde")]

use alloc::string::{String, ToString};
use serde_json::Value;

/// Dérive la **clé de famille** d'un `cfg.bin` depuis son chemin/nom : nom de base, suffixes
/// `.json`/`.cfg.bin` retirés, suffixe de version `_<chiffres.points>` final retiré.
/// Ex. `formation_config_0.02.16.cfg.bin` -> `formation_config`,
/// `phase_set_c21_0.00.00.cfg.bin` -> `phase_set_c21`, `record_config.cfg.bin` -> `record_config`.
#[must_use]
pub fn family_key(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    let base = base.strip_suffix(".json").unwrap_or(base);
    let base = base.strip_suffix(".cfg.bin").unwrap_or(base);
    if let Some(idx) = base.rfind('_') {
        let tail = &base[idx + 1..];
        if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
            return base[..idx].to_string();
        }
    }
    base.to_string()
}

/// Dispatche un `root` (forme iecode `lists`/`entries`) vers le parseur typé de la famille
/// `key`, et renvoie `(label, json)`. `None` si aucune famille typée ne correspond (le caller
/// renvoie alors le générique). Couvre 37 familles game-data validées golden byte-exact.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn decode_by_key(key: &str, root: &Value) -> Option<(&'static str, Value)> {
    use serde_json::to_value;
    macro_rules! t {
        ($label:literal, $call:expr) => {
            to_value($call).ok().map(|v| ($label, v))
        };
    }
    match key {
        "formation_config" => t!("formation", crate::formation::parse_formation_config(root)),
        "item_config" => t!("item", crate::item::parse_all_items(root)),
        "skill_config" => t!("skill", crate::skill::parse_skill_config(root)),
        "mission_config" => t!("mission", crate::mission::parse_mission_config(root)),
        "aura_skill_config" => t!("aura", crate::aura::parse_all_aura_cmds(root)),
        "trophy_config" => t!("trophy", crate::trophy::parse_trophy_config(root)),
        "gallery_config" => t!("gallery", crate::gallery::parse_gallery_config(root)),
        "record_config" => t!("record", crate::record::parse_record_config(root)),
        "dictionary_config" => t!("dictionary", crate::dictionary::parse_dictionary_config(root)),
        "help_list_config" => t!("help", crate::help::parse_help_list_config(root)),
        "setting_list_config" => {
            t!("setting_menu", crate::setting_menu::parse_setting_list_config(root))
        }
        "scene_archive_config" => {
            t!("scene_archive", crate::scene_archive::parse_scene_archive_config(root))
        }
        "music_app_config" => t!("music_app", crate::music_app::parse_music_app_config(root)),
        "chara_param" => t!("chara_param", crate::chara_param::parse_all_chara_params(root)),
        "chara_exp_table_config" => t!("exp", crate::exp::parse_exp_table(root)),
        "soccer_game_config" => t!("soccer_game", crate::soccer::parse_soccer_game_config(root)),
        "tutorial_banner_config" => t!("banner", crate::banner::parse_banner_config(root)),
        "boost_player_group_config" => {
            t!("boost_grp", crate::boost_grp::parse_boost_grp_config(root))
        }
        "chronicle_top_caravan_config" => {
            t!("chronicle_top", crate::chronicle_top::parse_chronicle_top_caravan_config(root))
        }
        "craft_obj_config" => t!("craft", crate::craft::parse_craft_obj_config(root)),
        "fast_travel_config" => t!("fast_travel", crate::fast_travel::parse_fast_travel_config(root)),
        "friendmap_config" => t!("friendmap", crate::friendmap::parse_friendmap_config(root)),
        "light_overwrite_config" => t!("light", crate::light::parse_light_overwrite_config(root)),
        "photo_mode_random_pose_config" => {
            t!("photo_mode", crate::photo_mode::parse_photo_mode_random_pose_config(root))
        }
        "info_bookmark_config" => {
            t!("search_word", crate::search_word::parse_info_bookmark_config(root))
        }
        "update_notice_config" => {
            t!("update_notice", crate::update_notice::parse_update_notice_config(root))
        }
        "user_name_plate_config" => {
            t!("user_name_plate", crate::user_name_plate::parse_user_name_plate_config(root))
        }
        "chronicle_vs_route_config" => {
            t!("vsroute", crate::vsroute::parse_chronicle_vs_route_config(root))
        }
        "weather_convert" => t!("weather", crate::weather::parse_weather_convert(root)),
        "gimmick_system_num_config" => {
            t!("dungeon", crate::dungeon::parse_gimmick_system_num_config(root))
        }
        "soccer_club_room_config" => {
            t!("chara_bank", crate::chara_bank::parse_soccer_club_room_config(root))
        }
        "advent_calendar_config" => {
            t!("advent_calendar", crate::post::parse_advent_calendar_config(root))
        }
        "delivery_config" => t!("delivery", crate::post::parse_delivery_config(root)),
        "delivery_list_config" => t!("delivery_list", crate::post::parse_delivery_list_config(root)),
        "password_list_config" => t!("password_list", crate::post::parse_password_list_config(root)),
        "post_notice_config" => t!("post_notice", crate::post::parse_post_notice_config(root)),
        "skill_view_preset_config" => {
            t!("skill_view", crate::skill_view::parse_skill_view_preset_config(root))
        }
        _ => None,
    }
}
