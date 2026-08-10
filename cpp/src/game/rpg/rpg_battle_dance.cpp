/// @file rpg_battle_dance.cpp
/// Implementation de CRpgBattleDanceTurnManager — combat de type danse.
/// Le joueur repond en rythme sur des fenetres d'input temporelles.

#include "iecode/game/rpg/rpg_battle_dance.h"

#include <spdlog/spdlog.h>

namespace game {

void CRpgBattleDanceTurnManager::on_turn_start() {
    turn_finished_ = false;
    player_won_    = false;
    current_beat_  = 0;
    perfect_count_ = 0;
    good_count_    = 0;
    miss_count_    = 0;

    spdlog::info("[Dance] Tour {} demarre (bpm={}, {} beats)",
                 turn_number_, bpm_, total_beats_);
}

void CRpgBattleDanceTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // Temps entre deux beats en secondes
    float beat_interval = 60.f / bpm_;

    // Verifier si on a depasse le beat courant
    float expected_time = static_cast<float>(current_beat_ + 1) * beat_interval;
    if (turn_timer_ >= expected_time + window_late_) {
        // Beat rate — pas d'input dans la fenetre
        ++miss_count_;
        ++current_beat_;

        if (current_beat_ >= total_beats_) {
            // Fin de la sequence — victoire si assez de bons inputs
            uint32_t score = perfect_count_ * 3 + good_count_;
            player_won_ = (score >= total_beats_); // Seuil de victoire
            turn_finished_ = true;
        }
    }
}

void CRpgBattleDanceTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[Dance] Tour {} termine — {} (P:{}/G:{}/M:{})",
                 turn_number_,
                 player_won_ ? "victoire" : "defaite",
                 perfect_count_, good_count_, miss_count_);
}

} // namespace game
