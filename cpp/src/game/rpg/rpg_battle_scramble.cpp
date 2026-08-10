/// @file rpg_battle_scramble.cpp
/// Implementation de CRpgBattleScrambleTurnManager — melee pour le ballon.
/// Le joueur doit marteler le bouton pour remplir la jauge de puissance.

#include "iecode/game/rpg/rpg_battle_scramble.h"

#include <spdlog/spdlog.h>

namespace game {

void CRpgBattleScrambleTurnManager::on_turn_start() {
    turn_finished_  = false;
    player_won_     = false;
    power_gauge_    = 0.f;
    opponent_power_ = 0.f;
    mash_count_     = 0;

    spdlog::info("[Scramble] Tour {} demarre (time_limit={:.1f}s)",
                 turn_number_, time_limit_);
}

void CRpgBattleScrambleTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // L'adversaire accumule de la puissance lineairement
    opponent_power_ += dt / time_limit_;
    if (opponent_power_ > 1.f) {
        opponent_power_ = 1.f;
    }

    // Le joueur a rempli sa jauge — victoire immediate
    if (power_gauge_ >= 1.f) {
        player_won_    = true;
        turn_finished_ = true;
        return;
    }

    // Temps ecoule ?
    if (turn_timer_ >= time_limit_) {
        player_won_    = (power_gauge_ >= opponent_power_);
        turn_finished_ = true;
    }
}

void CRpgBattleScrambleTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[Scramble] Tour {} termine — {} (joueur={:.2f}, adversaire={:.2f}, mash={})",
                 turn_number_,
                 player_won_ ? "victoire" : "defaite",
                 power_gauge_, opponent_power_, mash_count_);
}

} // namespace game
