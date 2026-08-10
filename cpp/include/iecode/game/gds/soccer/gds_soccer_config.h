#pragma once

/// @file gds_soccer_config.h
/// Configurations du moteur de match — parametres de jeu, placement, IA.
/// Source : fichiers cfg.bin (SOCCER_GAME_CONFIG, SOCCER_CHARA_PLACEMENT, etc.).
/// nie.exe : stride joueur 0x570, max 58 joueurs, stride equipe 0x1028.

#include "../gds_types.h"
#include <string>
#include <cstdint>

namespace game {

/// Configuration globale d'un match — GDSSoccerGameConfig.
struct GDSSoccerGameConfig {
    uint32_t config_id       = 0;
    uint32_t match_duration  = 0;     ///< Duree en secondes
    uint32_t overtime_sec    = 0;
    float    ball_gravity    = 2.f;   ///< Gravite balle (defaut 2.0f — ball_component.c)
    uint32_t max_players     = 58;    ///< Max joueurs (0x3A)
    uint8_t  field_size      = 0;     ///< Taille du terrain

    static constexpr std::string_view CFG_KEY = "SOCCER_GAME_CONFIG";
};

/// Placement d'un personnage sur le terrain — GDSSoccerCharaPlacement.
struct GDSSoccerCharaPlacement {
    uint32_t placement_id = 0;
    uint32_t chara_id     = 0;
    uint32_t formation_id = 0;
    float    pos_x        = 0.f;
    float    pos_z        = 0.f;
    Position position     = Position::FW;

    static constexpr std::string_view CFG_KEY = "SOCCER_CHARA_PLACEMENT";
};

/// Configuration IA utilisateur — GDSSoccerUserAIConfig.
struct GDSSoccerUserAIConfig {
    uint32_t ai_id         = 0;
    uint8_t  aggression    = 50;      ///< 0-100
    uint8_t  pass_tendency = 50;
    uint8_t  shoot_tendency = 50;
    uint8_t  defense_line  = 50;

    static constexpr std::string_view CFG_KEY = "SOCCER_USER_AI_CONFIG";
};

} // namespace game
