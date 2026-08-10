/// @file rpg_battle_turn_manager.cpp
/// Implementation de CRpgBattleStateMachine et CRpgBattleTurnManager.
/// Gestion des tours, file d'attente d'actions, calcul de degats.

#include "iecode/game/rpg/rpg_battle_turn_manager.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <cmath>

namespace game {

// ── CRpgBattleStateMachine ─────────────────────────────────────────

void CRpgBattleStateMachine::transition(RpgBattlePhase next) {
    if (current_phase_ == next) {
        return;
    }

    spdlog::debug("CRpgBattleStateMachine: {} -> {}",
                  rpg_battle_phase_name(current_phase_),
                  rpg_battle_phase_name(next));

    prev_phase_    = current_phase_;
    current_phase_ = next;
    phase_timer_   = 0.f;

    // Incrementer le compteur de tours lors de TurnStart
    if (next == RpgBattlePhase::TurnStart) {
        ++turn_count_;
    }
}

void CRpgBattleStateMachine::update(float dt) {
    phase_timer_ += dt;
}

void CRpgBattleStateMachine::reset() {
    current_phase_ = RpgBattlePhase::Init;
    prev_phase_    = RpgBattlePhase::Init;
    turn_count_    = 0;
    phase_timer_   = 0.f;
}

// ── CRpgBattleTurnManager ──────────────────────────────────────────

uint32_t CRpgBattleTurnManager::calculate_damage(
    uint32_t power, uint32_t defense,
    Element atk_element, Element def_element) {

    // Formule de base : max(1, power - defense/2)
    int32_t base_damage = static_cast<int32_t>(power)
                        - static_cast<int32_t>(defense / 2);
    if (base_damage < 1) {
        base_damage = 1;
    }

    // Appliquer le bonus elementaire
    float bonus = element_bonus(atk_element, def_element);
    auto result = static_cast<uint32_t>(
        std::round(static_cast<float>(base_damage) * bonus));

    // Au minimum 1 degat
    return std::max(result, 1u);
}

void CRpgBattleTurnManager::enqueue_action(const RpgBattleAction& action) {
    action_queue_.push_back(action);

    // Trier par vitesse decroissante (le plus rapide agit en premier)
    std::sort(action_queue_.begin(), action_queue_.end(),
              [](const RpgBattleAction& a, const RpgBattleAction& b) {
                  return a.speed > b.speed;
              });
}

RpgBattleAction CRpgBattleTurnManager::dequeue_action() {
    if (action_queue_.empty()) {
        return {};
    }

    auto action = action_queue_.front();
    action_queue_.erase(action_queue_.begin());
    return action;
}

void CRpgBattleTurnManager::clear_queue() {
    action_queue_.clear();
}

} // namespace game
