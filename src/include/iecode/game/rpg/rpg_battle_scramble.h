#pragma once

/// @file rpg_battle_scramble.h
/// CRpgBattleScrambleTurnManager — gestionnaire de tour pour le scramble.
/// Classe RTTI : game::CRpgBattleScrambleTurnManager.

#include "rpg_battle_turn_manager.h"

namespace game {

/// Gestionnaire de tour de scramble — melee pour le ballon.
struct CRpgBattleScrambleTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "Scramble"; }

    float    power_gauge_    = 0.f;   // Jauge de puissance [0, 1]
    float    opponent_power_ = 0.f;   // Puissance de l'adversaire [0, 1]
    float    time_limit_     = 5.f;   // Limite de temps (secondes)
    uint32_t mash_count_     = 0;     // Nombre de pressions de bouton
};

} // namespace game
