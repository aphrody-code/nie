#pragma once

/// @file rpg_battle_dance.h
/// CRpgBattleDanceTurnManager — gestionnaire de tour pour les danses.
/// Classe RTTI : game::CRpgBattleDanceTurnManager.

#include "rpg_battle_turn_manager.h"

namespace game {

/// Gestionnaire de tour de danse — le joueur doit repondre en rythme.
/// Fenetres d'input temporelles avec notation de precision.
struct CRpgBattleDanceTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "Dance"; }

    float    bpm_              = 120.f;   // Tempo en BPM
    float    window_early_     = 0.15f;   // Fenetre d'input (secondes avant le beat)
    float    window_late_      = 0.15f;   // Fenetre d'input (secondes apres le beat)
    uint32_t total_beats_      = 16;      // Nombre total de beats
    uint32_t current_beat_     = 0;       // Beat courant
    uint32_t perfect_count_    = 0;       // Nombre de "Perfect"
    uint32_t good_count_       = 0;       // Nombre de "Good"
    uint32_t miss_count_       = 0;       // Nombre de "Miss"
};

} // namespace game
