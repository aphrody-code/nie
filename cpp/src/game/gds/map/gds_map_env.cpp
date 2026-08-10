/// @file gds_map_env.cpp
/// Chargement des donnees d'environnement des cartes depuis cfg.bin (JSON).
/// GDSMapEnvDataConfig, GDSMapLightSetConfig, GDSMapCubemapConfig, GDSMapWeatherPresetConfig.

#include "iecode/game/gds/map/gds_map_env.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <vector>

namespace game {

// ── GDSMapEnvDataConfig ────────────────────────────────────────────

[[nodiscard]] std::vector<GDSMapEnvDataConfig> load_map_env_data_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapEnvDataConfig> result;

    const auto key = std::string(GDSMapEnvDataConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapEnvDataConfig env;
            env.map_id      = entry.value("map_id", 0u);
            env.env_id      = entry.value("env_id", 0u);
            env.fog_start   = entry.value("fog_start", 100.f);
            env.fog_end     = entry.value("fog_end", 1000.f);
            env.fog_density = entry.value("fog_density", 0.001f);

            if (entry.contains("fog_color") && entry["fog_color"].is_array()) {
                const auto& fc = entry["fog_color"];
                for (size_t i = 0; i < std::min(fc.size(), env.fog_color.size()); ++i) {
                    env.fog_color[i] = fc[i].get<float>();
                }
            }

            result.push_back(env);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_env_data_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_env_data_list: {} environnements charges", result.size());
    return result;
}

// ── GDSMapLightSetConfig ───────────────────────────────────────────

[[nodiscard]] std::vector<GDSMapLightSetConfig> load_map_light_set_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapLightSetConfig> result;

    const auto key = std::string(GDSMapLightSetConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapLightSetConfig light;
            light.light_set_id = entry.value("light_set_id", 0u);
            light.intensity    = entry.value("intensity", 1.f);

            auto read_vec3 = [&](const char* name, std::array<float, 3>& out) {
                if (entry.contains(name) && entry[name].is_array()) {
                    const auto& arr = entry[name];
                    for (size_t i = 0; i < std::min(arr.size(), out.size()); ++i) {
                        out[i] = arr[i].get<float>();
                    }
                }
            };
            read_vec3("direction", light.direction);
            read_vec3("color", light.color);
            read_vec3("ambient", light.ambient);

            result.push_back(light);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_light_set_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_light_set_list: {} light sets charges", result.size());
    return result;
}

// ── GDSMapCubemapConfig ────────────────────────────────────────────

[[nodiscard]] std::vector<GDSMapCubemapConfig> load_map_cubemap_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapCubemapConfig> result;

    const auto key = std::string(GDSMapCubemapConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapCubemapConfig cm;
            cm.map_id       = entry.value("map_id", 0u);
            cm.cubemap_hash = lives::hash32(entry.value("cubemap_hash", 0u));
            cm.intensity    = entry.value("intensity", 1.f);
            result.push_back(cm);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_cubemap_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_cubemap_list: {} cubemaps charges", result.size());
    return result;
}

// ── GDSMapWeatherPresetConfig ──────────────────────────────────────

[[nodiscard]] std::vector<GDSMapWeatherPresetConfig> load_map_weather_preset_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapWeatherPresetConfig> result;

    const auto key = std::string(GDSMapWeatherPresetConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapWeatherPresetConfig wp;
            wp.preset_id     = entry.value("preset_id", 0u);
            wp.preset_name   = entry.value("preset_name", "");
            wp.light_set_id  = entry.value("light_set_id", 0u);
            wp.env_id        = entry.value("env_id", 0u);
            wp.wind_strength = entry.value("wind_strength", 0.f);
            result.push_back(std::move(wp));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_weather_preset_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_weather_preset_list: {} presets charges", result.size());
    return result;
}

} // namespace game
