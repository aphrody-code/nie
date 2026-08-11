#pragma once

/// @file gds_map_placement.h
/// Placement d'objets sur les cartes — position, rotation, points d'interet.
/// Source : fichiers cfg.bin (MAP_PLACEMENT_CONFIG, MAP_FUNC_POINT_CONFIG, etc.).

#include "../gds_types.h"
#include <string>

namespace game {

/// Placement d'un objet sur une carte — GDSMapPlacementConfig.
struct GDSMapPlacementConfig {
    uint32_t      map_id      = 0;
    uint32_t      object_id   = 0;
    lives::hash32 mesh_hash;
    float         pos_x       = 0.f;
    float         pos_y       = 0.f;
    float         pos_z       = 0.f;
    float         rot_x       = 0.f;
    float         rot_y       = 0.f;
    float         rot_z       = 0.f;
    float         scale       = 1.f;

    static constexpr std::string_view CFG_KEY = "MAP_PLACEMENT_CONFIG";
};

/// Point fonctionnel sur une carte — GDSMapFuncPointConfig.
struct GDSMapFuncPointConfig {
    uint32_t    map_id    = 0;
    uint32_t    point_id  = 0;
    uint32_t    func_type = 0;
    float       pos_x     = 0.f;
    float       pos_y     = 0.f;
    float       pos_z     = 0.f;
    float       radius    = 1.f;

    static constexpr std::string_view CFG_KEY = "MAP_FUNC_POINT_CONFIG";
};

/// Point d'interet sur une carte — GDSMapInterestPointConfig.
struct GDSMapInterestPointConfig {
    uint32_t    map_id    = 0;
    uint32_t    point_id  = 0;
    std::string label_key;
    float       pos_x     = 0.f;
    float       pos_y     = 0.f;
    float       pos_z     = 0.f;

    static constexpr std::string_view CFG_KEY = "MAP_INTEREST_POINT_CONFIG";
};

/// Name tag sur une carte — GDSMapNameTagConfig.
struct GDSMapNameTagConfig {
    uint32_t    map_id   = 0;
    std::string tag_key;
    float       pos_x    = 0.f;
    float       pos_y    = 0.f;
    float       pos_z    = 0.f;

    static constexpr std::string_view CFG_KEY = "MAP_NAME_TAG_CONFIG";
};

} // namespace game
