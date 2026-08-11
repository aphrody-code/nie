/// @file rpg_battle_ball_trap.cpp
/// Implementation de CRpgBattleBallTrap*TurnManager — ball trap.
/// Deux variantes : joueur de champ (fielder) et gardien (keeper).

#include "iecode/game/rpg/rpg_battle_ball_trap.h"

#include <spdlog/spdlog.h>

namespace game {

// ── BallTrap Fielder ───────────────────────────────────────────────

void CRpgBattleBallTrapFielderTurnManager::on_turn_start() {
    turn_finished_   = false;
    player_won_      = false;
    trap_count_      = 0;
    reaction_time_   = 0.f;
    is_trap_active_  = false;

    spdlog::info("[BallTrapFielder] Tour {} demarre (cible={} traps)",
                 turn_number_, target_count_);
}

void CRpgBattleBallTrapFielderTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // Quand un trap est actif, mesurer le temps de reaction
    if (is_trap_active_) {
        reaction_time_ += dt;

        // Echec si le temps de reaction depasse le max
        if (reaction_time_ > max_reaction_) {
            is_trap_active_ = false;
            reaction_time_ = 0.f;
            // Un trap rate — pas d'increment
        }
    }

    // Verification de fin
    if (trap_count_ >= target_count_) {
        player_won_ = true;
        turn_finished_ = true;
    }
}

void CRpgBattleBallTrapFielderTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[BallTrapFielder] Tour {} termine — {} ({}/{} traps)",
                 turn_number_,
                 player_won_ ? "victoire" : "defaite",
                 trap_count_, target_count_);
}

// ── BallTrap Keeper ────────────────────────────────────────────────

void CRpgBattleBallTrapKeeperTurnManager::on_turn_start() {
    turn_finished_ = false;
    player_won_    = false;
    is_diving_     = false;

    spdlog::info("[BallTrapKeeper] Tour {} demarre (save_radius={:.1f}, prob={:.0f}%)",
                 turn_number_, save_radius_, save_prob_ * 100.f);
}

void CRpgBattleBallTrapKeeperTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // Le gardien plonge — temps d'animation
    if (is_diving_) {
        // Le plongeon prend un certain temps (distance / vitesse)
        float dive_time = max_distance_ / dive_speed_;
        if (turn_timer_ >= dive_time) {
            turn_finished_ = true;
        }
    }
}

void CRpgBattleBallTrapKeeperTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[BallTrapKeeper] Tour {} termine — {}",
                 turn_number_,
                 player_won_ ? "arret !" : "but encaisse");
}

} // namespace game
