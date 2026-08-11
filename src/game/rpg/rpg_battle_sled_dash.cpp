/// @file rpg_battle_sled_dash.cpp
/// Implementation de CRpgBattleSledDashTurnManager — course en luge.

#include "iecode/game/rpg/rpg_battle_sled_dash.h"

#include <spdlog/spdlog.h>

#include <algorithm>

namespace game {

void CRpgBattleSledDashTurnManager::on_turn_start() {
    turn_finished_ = false;
    player_won_    = false;
    distance_      = 0.f;
    speed_         = 0.f;

    spdlog::info("[SledDash] Tour {} demarre (cible={:.0f}m)",
                 turn_number_, target_distance_);
}

void CRpgBattleSledDashTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // Acceleration et deplacement
    speed_ += acceleration_ * dt;
    speed_ = std::min(speed_, max_speed_);
    distance_ += speed_ * dt;

    // Atteint la distance cible ?
    if (distance_ >= target_distance_) {
        distance_ = target_distance_;
        player_won_ = true;
        turn_finished_ = true;
    }
}

void CRpgBattleSledDashTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[SledDash] Tour {} termine — {} ({:.1f}/{:.1f}m)",
                 turn_number_,
                 player_won_ ? "victoire" : "defaite",
                 distance_, target_distance_);
}

} // namespace game
