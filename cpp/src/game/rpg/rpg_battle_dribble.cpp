/// @file rpg_battle_dribble.cpp
/// Implementation de CRpgBattleDribbleTurnManager — combat de type dribble.
/// Opposition 1v1 segmentee : Control (attaquant) vs Body (defenseur).

#include "iecode/game/rpg/rpg_battle_dribble.h"

#include <spdlog/spdlog.h>

namespace game {

void CRpgBattleDribbleTurnManager::on_turn_start() {
    turn_finished_     = false;
    player_won_        = false;
    current_segment_   = 0;
    successful_dodges_ = 0;
    progress_          = 0.f;
    is_dodging_        = false;

    spdlog::info("[Dribble] Tour {} demarre ({} segments, control={}, body={})",
                 turn_number_, total_segments_,
                 attacker_control_, defender_body_);
}

void CRpgBattleDribbleTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // Progression dans le segment courant
    if (is_dodging_) {
        progress_ += dt * (static_cast<float>(attacker_control_) / 50.f);

        // Segment termine
        if (progress_ >= 1.f) {
            evaluate_segment();
            progress_ = 0.f;
            is_dodging_ = false;
            ++current_segment_;

            // Tous les segments termines ?
            if (current_segment_ >= total_segments_) {
                // Victoire si plus de la moitie des esquives reussies
                player_won_ = (successful_dodges_ > total_segments_ / 2);
                turn_finished_ = true;
            }
        }
    }
}

void CRpgBattleDribbleTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[Dribble] Tour {} termine — {} ({}/{} esquives)",
                 turn_number_,
                 player_won_ ? "victoire" : "defaite",
                 successful_dodges_, total_segments_);
}

void CRpgBattleDribbleTurnManager::evaluate_segment() {
    // Calcul de degats/comparaison : control vs body avec bonus elementaire
    uint32_t damage = calculate_damage(
        attacker_control_, defender_body_,
        attacker_element_, defender_element_);

    // L'esquive est reussie si le damage est superieur au seuil
    // (seuil = body / 2)
    if (damage > defender_body_ / 2) {
        ++successful_dodges_;
        spdlog::debug("[Dribble] Segment {} : esquive reussie (score={})",
                      current_segment_, damage);
    } else {
        spdlog::debug("[Dribble] Segment {} : esquive ratee (score={})",
                      current_segment_, damage);
    }
}

} // namespace game
