#pragma once

/// @file rpg_battle_ball_trap.h
/// CRpgBattleBallTrapFielderTurnManager — ball trap (joueur de champ).
/// CRpgBattleBallTrapKeeperTurnManager — ball trap (gardien).
/// Classes RTTI : game::CRpgBattleBallTrapFielderTurnManager,
///                game::CRpgBattleBallTrapKeeperTurnManager.

#include "rpg_battle_turn_manager.h"

namespace game {

/// Ball trap pour les joueurs de champ — attraper ou frapper la balle.
struct CRpgBattleBallTrapFielderTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "BallTrapFielder"; }

    float    reaction_time_ = 0.f;     // Temps de reaction mesure (secondes)
    float    max_reaction_  = 1.f;     // Temps max avant echec
    uint32_t trap_count_    = 0;       // Nombre de traps reussis
    uint32_t target_count_  = 5;       // Nombre de traps requis
    bool     is_trap_active_ = false;
};

/// Ball trap pour les gardiens — plonger pour arreter la balle.
struct CRpgBattleBallTrapKeeperTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "BallTrapKeeper"; }

    float save_radius_    = 1.0f;    // Rayon de save du gardien
    float max_distance_   = 5.0f;    // Distance max de plongeon
    float save_prob_      = 0.8f;    // Probabilite de save (80%)
    float reaction_time_  = 4.73f;   // Temps de reaction (constante du jeu)
    float dive_speed_     = 2.67f;   // Vitesse de plongeon (constante du jeu)
    bool  is_diving_      = false;
};

} // namespace game
