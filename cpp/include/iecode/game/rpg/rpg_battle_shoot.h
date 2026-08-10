#pragma once

/// @file rpg_battle_shoot.h
/// CRpgBattleShootTurnManager — gestionnaire de tour pour les tirs.
/// Classe RTTI : game::CRpgBattleShootTurnManager.

#include "rpg_battle_turn_manager.h"

namespace game {

/// Gestionnaire de tour de tir — le joueur doit viser et tirer au but.
/// Gere la precision du tir, la zone du gardien, et la puissance.
/// Degats = kick_power vs keeper_catch, avec bonus elementaire.
struct CRpgBattleShootTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "Shoot"; }

    /// Evalue le resultat du tir (precision + puissance vs gardien).
    /// Calcule player_won_ et le score de degats.
    void evaluate_shot();

    float    shoot_accuracy_ = 0.5f;   // Precision du tir [0, 1]
    float    shoot_power_    = 0.5f;   // Puissance du tir [0, 1]
    float    keeper_zone_x_  = 0.f;    // Position X de la zone du gardien [-1, 1]
    float    keeper_zone_y_  = 0.f;    // Position Y de la zone du gardien [-1, 1]
    float    aim_x_          = 0.f;    // Position X de la visee [-1, 1]
    float    aim_y_          = 0.f;    // Position Y de la visee [-1, 1]
    float    charge_time_    = 0.f;    // Temps de charge (secondes)
    float    max_charge_     = 2.f;    // Temps de charge max
    uint32_t kick_power_     = 50;     // Stat kick du tireur
    uint32_t keeper_catch_   = 50;     // Stat catch du gardien
    Element  shooter_element_ = Element::None;
    Element  keeper_element_  = Element::None;
    uint32_t damage_result_  = 0;     // Degats calcules apres evaluation
    bool     is_charging_    = false;
    bool     shot_on_target_ = false;  // Le tir est-il cadre
};

} // namespace game
