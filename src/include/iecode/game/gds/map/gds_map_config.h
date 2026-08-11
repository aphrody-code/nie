#pragma once

/// @file gds_map_config.h
/// Configurations des cartes — ID, informations de jeu, validite.
/// Source : fichiers cfg.bin (MAP_CONFIG, MAP_ADDITIONAL_CONFIG, etc.).

#include "../gds_types.h"
#include <string>

namespace game {

/// Configuration d'une carte — GDSMapConfig.
struct GDSMapConfig {
    uint32_t      map_id   = 0;
    lives::hash32 name_hash;
    std::string   name_key;
    uint32_t      field_id = 0;
    bool          is_indoor = false;

    static constexpr std::string_view CFG_KEY = "MAP_CONFIG";
};

/// Configuration additionnelle d'une carte — GDSMapAdditionalConfig.
struct GDSMapAdditionalConfig {
    uint32_t map_id         = 0;
    uint32_t bgm_id         = 0;
    uint32_t env_preset_id  = 0;

    static constexpr std::string_view CFG_KEY = "MAP_ADDITIONAL_CONFIG";
};

/// Carte valide pour une phase de jeu — GDSMapValidConfig.
struct GDSMapValidConfig {
    uint32_t map_id   = 0;
    uint32_t phase_id = 0;
    bool     enabled  = true;

    static constexpr std::string_view CFG_KEY = "MAP_VALID_CONFIG";
};

/// Infos de jeu associees a une carte — GDSMapGameInfo.
struct GDSMapGameInfo {
    uint32_t    map_id   = 0;
    uint32_t    chapter  = 0;
    std::string scene_key;

    static constexpr std::string_view CFG_KEY = "MAP_GAME_INFO";
};

} // namespace game
