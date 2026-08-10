#pragma once

/// @file rpg_battle_sled_dash.h
/// CRpgBattleSledDashTurnManager — gestionnaire de tour pour le sled dash.
/// Classe RTTI : game::CRpgBattleSledDashTurnManager.

#include "rpg_battle_turn_manager.h"

namespace game {

/// Gestionnaire de tour de sled dash — course en luge.
struct CRpgBattleSledDashTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "SledDash"; }

    float distance_        = 0.f;     // Distance parcourue
    float target_distance_ = 100.f;   // Distance a atteindre
    float speed_           = 0.f;     // Vitesse courante
    float max_speed_       = 20.f;    // Vitesse maximale
    float acceleration_    = 5.f;     // Acceleration
};

} // namespace game
