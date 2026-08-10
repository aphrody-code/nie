#pragma once

/// @file rpg_battle_stairs.h
/// CRpgBattleStairsRaceTurnManager — gestionnaire de tour pour la course d'escalier.
/// Classe RTTI : game::CRpgBattleStairsRaceTurnManager.

#include "rpg_battle_turn_manager.h"

namespace game {

/// Gestionnaire de tour de course d'escalier — monter les marches en rythme.
struct CRpgBattleStairsRaceTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "StairsRace"; }

    uint32_t total_stairs_    = 50;    // Nombre total de marches
    uint32_t current_stair_   = 0;     // Marche courante
    uint32_t opponent_stair_  = 0;     // Marche de l'adversaire
    float    stamina_         = 100.f; // Endurance restante
    float    stamina_drain_   = 1.f;   // Consommation d'endurance par marche
};

} // namespace game
