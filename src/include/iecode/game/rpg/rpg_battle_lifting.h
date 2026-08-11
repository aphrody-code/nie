#pragma once

/// @file rpg_battle_lifting.h
/// CRpgBattleLiftingTurnManager — gestionnaire de tour pour le lifting.
/// Classe RTTI : game::CRpgBattleLiftingTurnManager.

#include "rpg_battle_turn_manager.h"

namespace game {

/// Gestionnaire de tour de lifting — le joueur doit maintenir la balle en l'air.
struct CRpgBattleLiftingTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "Lifting"; }

    float    ball_height_    = 0.f;   // Hauteur actuelle de la balle
    float    target_height_  = 2.f;   // Hauteur cible
    uint32_t lift_count_     = 0;     // Nombre de lifts effectues
    uint32_t target_count_   = 10;    // Nombre de lifts requis
    float    gravity_        = 2.0f;  // Gravite de la balle
};

} // namespace game
