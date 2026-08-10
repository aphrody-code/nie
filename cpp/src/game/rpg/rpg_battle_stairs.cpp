/// @file rpg_battle_stairs.cpp
/// Implementation de CRpgBattleStairsRaceTurnManager — course d'escalier.
/// Monter les marches en rythme avec gestion de l'endurance.

#include "iecode/game/rpg/rpg_battle_stairs.h"

#include <spdlog/spdlog.h>

namespace game {

void CRpgBattleStairsRaceTurnManager::on_turn_start() {
    turn_finished_  = false;
    player_won_     = false;
    current_stair_  = 0;
    opponent_stair_ = 0;
    stamina_        = 100.f;

    spdlog::info("[StairsRace] Tour {} demarre ({} marches)",
                 turn_number_, total_stairs_);
}

void CRpgBattleStairsRaceTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // L'adversaire monte a une vitesse constante
    // ~1 marche par 0.3 secondes
    float opponent_rate = 3.3f;
    opponent_stair_ = static_cast<uint32_t>(turn_timer_ * opponent_rate);
    if (opponent_stair_ > total_stairs_) {
        opponent_stair_ = total_stairs_;
    }

    // Regeneration de l'endurance (lente)
    stamina_ += 5.f * dt;
    if (stamina_ > 100.f) {
        stamina_ = 100.f;
    }

    // Verifier la condition de victoire/defaite
    if (current_stair_ >= total_stairs_) {
        player_won_ = true;
        turn_finished_ = true;
    } else if (opponent_stair_ >= total_stairs_) {
        player_won_ = false;
        turn_finished_ = true;
    }
}

void CRpgBattleStairsRaceTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[StairsRace] Tour {} termine — {} (joueur={}/{}, adversaire={})",
                 turn_number_,
                 player_won_ ? "victoire" : "defaite",
                 current_stair_, total_stairs_, opponent_stair_);
}

} // namespace game
