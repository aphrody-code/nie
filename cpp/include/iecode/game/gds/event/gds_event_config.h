#pragma once

/// @file gds_event_config.h
/// Configurations des evenements — play, environnement, terrain, fuseau horaire, lumiere.
/// Source : fichiers cfg.bin (EVENT_PLAY_CONFIG, EVENT_ENV_CONFIG, etc.).

#include "../gds_types.h"
#include <string>

namespace game {

/// Configuration de lecture d'un evenement — GDSEventPlayConfig.
struct GDSEventPlayConfig {
    uint32_t    event_id   = 0;
    std::string script_key;        ///< Cle du script Lua associe
    uint32_t    map_id     = 0;
    uint32_t    chapter    = 0;
    bool        is_skippable = true;

    static constexpr std::string_view CFG_KEY = "EVENT_PLAY_CONFIG";
};

/// Configuration environnement d'un evenement — GDSEventEnvConfig.
struct GDSEventEnvConfig {
    uint32_t event_id       = 0;
    uint32_t env_preset_id  = 0;
    uint32_t light_set_id   = 0;
    uint32_t weather_id     = 0;

    static constexpr std::string_view CFG_KEY = "EVENT_ENV_CONFIG";
};

/// Definition de terrain pour un evenement — GDSEventFldDef.
struct GDSEventFldDef {
    uint32_t    event_id  = 0;
    uint32_t    field_id  = 0;
    std::string field_name;

    static constexpr std::string_view CFG_KEY = "EVENT_FLD_DEF";
};

/// Fuseau horaire d'un evenement — GDSEventTimeZone.
struct GDSEventTimeZone {
    uint32_t event_id    = 0;
    uint8_t  time_zone   = 0;   ///< 0=matin, 1=jour, 2=soir, 3=nuit
    float    sun_angle   = 0.f;

    static constexpr std::string_view CFG_KEY = "EVENT_TIME_ZONE";
};

/// Configuration eclairage d'un evenement — GDSEventLightConfig.
struct GDSEventLightConfig {
    uint32_t event_id       = 0;
    uint32_t light_set_id   = 0;
    float    intensity_mult = 1.f;

    static constexpr std::string_view CFG_KEY = "EVENT_LIGHT_CONFIG";
};

} // namespace game
