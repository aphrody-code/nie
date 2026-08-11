/// @file rpg_battle_lifting.cpp
/// Implementation de CRpgBattleLiftingTurnManager — maintenir la balle en l'air.

#include "iecode/game/rpg/rpg_battle_lifting.h"

#include <spdlog/spdlog.h>

namespace game {

void CRpgBattleLiftingTurnManager::on_turn_start() {
    turn_finished_ = false;
    player_won_    = false;
    ball_height_   = target_height_;
    lift_count_    = 0;

    spdlog::info("[Lifting] Tour {} demarre (cible={} lifts, gravite={})",
                 turn_number_, target_count_, gravity_);
}

void CRpgBattleLiftingTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // La balle tombe avec la gravite
    ball_height_ -= gravity_ * dt;

    // Si la balle touche le sol, c'est rate
    if (ball_height_ <= 0.f) {
        ball_height_ = 0.f;
        player_won_ = (lift_count_ >= target_count_);
        turn_finished_ = true;
    }
}

void CRpgBattleLiftingTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[Lifting] Tour {} termine — {} ({}/{} lifts)",
                 turn_number_,
                 player_won_ ? "victoire" : "defaite",
                 lift_count_, target_count_);
}

} // namespace game
