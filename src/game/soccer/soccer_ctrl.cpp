/// @file soccer_ctrl.cpp
/// Implementation de CSoccerCtrl — controleur de joueur du match soccer.
/// Gere la selection du personnage actif, les actions et les zones de jeu.

#include "iecode/game/soccer/soccer_ctrl.h"

#include <spdlog/spdlog.h>

#include <cmath>

namespace game {

void CSoccerCtrl::update(float /*dt*/) {
    if (!active_) {
        return;
    }

    // Mise a jour des drapeaux d'action
    if (current_action_ != SoccerAction::NONE) {
        spdlog::debug("CSoccerCtrl: action en cours = {}",
                      soccer_action_name(current_action_));
    }

    // Le sprint consomme de l'endurance — ici on met juste a jour l'etat
    if (is_sprinting_) {
        current_action_ = SoccerAction::SPRINT;
    }
}

void CSoccerCtrl::select_chara(uint32_t chara_id) {
    if (selected_chara_id_ == chara_id) {
        return;
    }

    spdlog::debug("CSoccerCtrl: selection joueur {} -> {}", selected_chara_id_, chara_id);
    selected_chara_id_ = chara_id;
    current_action_    = SoccerAction::NONE;
    is_sprinting_      = false;
    is_tackling_       = false;
}

void CSoccerCtrl::execute_action(SoccerAction action) {
    if (!active_) {
        return;
    }

    current_action_ = action;

    switch (action) {
    case SoccerAction::TACKLE:
        is_tackling_ = true;
        break;
    case SoccerAction::SPRINT:
        is_sprinting_ = true;
        break;
    default:
        break;
    }

    spdlog::debug("CSoccerCtrl: execution action = {}",
                  soccer_action_name(action));
}

bool CSoccerCtrl::is_in_shoot_zone() const {
    // Zone de tir : dernier tiers du terrain
    float abs_z = std::abs(player_z_);
    return abs_z > field_half_length_ * 0.66f;
}

bool CSoccerCtrl::is_in_penalty_zone() const {
    // Surface de reparation : ~16.5m depuis la ligne de but, 20.15m de large
    float abs_z = std::abs(player_z_);
    float abs_x = std::abs(player_x_);
    return abs_z > (field_half_length_ - 16.5f) && abs_x < 20.15f;
}

} // namespace game
