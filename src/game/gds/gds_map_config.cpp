/// @file gds_map_config.cpp
/// Chargement des configurations de cartes — maps, environnement, placement.

#include "iecode/game/gds/map/gds_map_config.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <string>
#include <vector>

namespace game {

// ── GDSMapConfig ────────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSMapConfig> load_map_config_list(const nlohmann::json& cfg_data) {
    std::vector<GDSMapConfig> result;

    const auto key = std::string(GDSMapConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapConfig map;
            map.map_id    = entry.value("map_id", 0u);
            map.name_hash = lives::hash32(entry.value("name_hash", 0u));
            map.name_key  = entry.value("name_key", "");
            map.field_id  = entry.value("field_id", 0u);
            map.is_indoor = entry.value("is_indoor", false);
            result.push_back(std::move(map));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_config_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_config_list: {} cartes chargees", result.size());
    return result;
}

// ── GDSMapAdditionalConfig ──────────────────────────────────────────

[[nodiscard]] std::vector<GDSMapAdditionalConfig> load_map_additional_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapAdditionalConfig> result;

    const auto key = std::string(GDSMapAdditionalConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapAdditionalConfig add;
            add.map_id        = entry.value("map_id", 0u);
            add.bgm_id        = entry.value("bgm_id", 0u);
            add.env_preset_id = entry.value("env_preset_id", 0u);
            result.push_back(add);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_additional_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_additional_list: {} configs additionnelles chargees", result.size());
    return result;
}

// NOTE: load_map_env_data_list, load_map_placement_list, load_map_weather_preset_list
// et les configs associees sont dans gds/map/gds_map_env.cpp et gds/map/gds_map_placement.cpp.

} // namespace game
