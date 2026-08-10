#pragma once

/// @file gds_map_env.h
/// Environnement des cartes — eclairage, cubemap, meteo.
/// Source : fichiers cfg.bin (MAP_ENV_DATA_CONFIG, MAP_LIGHT_SET_CONFIG, etc.).

#include "../gds_types.h"
#include <string>
#include <array>

namespace game {

/// Donnees d'environnement d'une carte — GDSMapEnvDataConfig.
struct GDSMapEnvDataConfig {
    uint32_t map_id        = 0;
    uint32_t env_id        = 0;
    float    fog_start     = 100.f;
    float    fog_end       = 1000.f;
    float    fog_density   = 0.001f;
    std::array<float, 3> fog_color = {0.5f, 0.5f, 0.5f};

    static constexpr std::string_view CFG_KEY = "MAP_ENV_DATA_CONFIG";
};

/// Set d'eclairage — GDSMapLightSetConfig.
struct GDSMapLightSetConfig {
    uint32_t light_set_id  = 0;
    std::array<float, 3> direction = {0.f, -1.f, 0.f};
    std::array<float, 3> color     = {1.f, 1.f, 1.f};
    float    intensity     = 1.f;
    std::array<float, 3> ambient   = {0.2f, 0.2f, 0.2f};

    static constexpr std::string_view CFG_KEY = "MAP_LIGHT_SET_CONFIG";
};

/// Configuration cubemap — GDSMapCubemapConfig.
struct GDSMapCubemapConfig {
    uint32_t      map_id        = 0;
    lives::hash32 cubemap_hash;      ///< CRC32 du fichier cubemap .g4tx
    float         intensity     = 1.f;

    static constexpr std::string_view CFG_KEY = "MAP_CUBEMAP_CONFIG";
};

/// Preset meteo — GDSMapWeatherPresetConfig.
struct GDSMapWeatherPresetConfig {
    uint32_t    preset_id   = 0;
    std::string preset_name;
    uint32_t    light_set_id = 0;
    uint32_t    env_id       = 0;
    float       wind_strength = 0.f;

    static constexpr std::string_view CFG_KEY = "MAP_WEATHER_PRESET_CONFIG";
};

} // namespace game
