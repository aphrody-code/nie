/// @file gds_event_config.cpp
/// Chargement des configurations d'evenements — scripts Lua, environnement, dialogues.

#include "iecode/game/gds/event/gds_event_config.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <string>
#include <vector>

namespace game {

// ── GDSEventPlayConfig ──────────────────────────────────────────────

[[nodiscard]] std::vector<GDSEventPlayConfig> load_event_play_config_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSEventPlayConfig> result;

    const auto key = std::string(GDSEventPlayConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSEventPlayConfig evt;
            evt.event_id    = entry.value("event_id", 0u);
            evt.script_key  = entry.value("script_key", "");
            evt.map_id      = entry.value("map_id", 0u);
            evt.chapter     = entry.value("chapter", 0u);
            evt.is_skippable = entry.value("is_skippable", true);
            result.push_back(std::move(evt));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_event_play_config_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_event_play_config_list: {} evenements charges", result.size());
    return result;
}

// ── GDSEventEnvConfig ───────────────────────────────────────────────

[[nodiscard]] std::vector<GDSEventEnvConfig> load_event_env_config_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSEventEnvConfig> result;

    const auto key = std::string(GDSEventEnvConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSEventEnvConfig env;
            env.event_id      = entry.value("event_id", 0u);
            env.env_preset_id = entry.value("env_preset_id", 0u);
            env.light_set_id  = entry.value("light_set_id", 0u);
            env.weather_id    = entry.value("weather_id", 0u);
            result.push_back(env);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_event_env_config_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_event_env_config_list: {} env evenements charges", result.size());
    return result;
}

// NOTE: load_event_bustup_talk_list, load_event_subtitle_list et
// load_event_general_bustup_talk_list sont dans gds/event/gds_event_talk.cpp.

} // namespace game
