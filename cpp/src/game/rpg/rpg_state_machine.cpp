/// @file rpg_state_machine.cpp
/// Implementation de CRpgStateMachine — machine a etats du mode RPG.
/// Transitions entre exploration, combats, evenements, transitions de carte.

#include "iecode/game/rpg/rpg_state_machine.h"

#include <spdlog/spdlog.h>

namespace game {

void CRpgStateMachine::transition(RpgPhase next) {
    if (current_phase_ == next) {
        return;
    }

    if (!can_transition_to(next)) {
        spdlog::warn("CRpgStateMachine: transition invalide {} -> {}",
                     rpg_phase_name(current_phase_),
                     rpg_phase_name(next));
        return;
    }

    spdlog::debug("CRpgStateMachine: {} -> {}",
                  rpg_phase_name(current_phase_),
                  rpg_phase_name(next));

    prev_phase_    = current_phase_;
    current_phase_ = next;
    phase_timer_   = 0.f;
}

void CRpgStateMachine::update(float dt) {
    phase_timer_ += dt;
}

bool CRpgStateMachine::can_transition_to(RpgPhase next) const {
    switch (current_phase_) {
    case RpgPhase::Idle:
        // Depuis Idle, on peut aller en exploration ou en cutscene
        return next == RpgPhase::FieldMove
            || next == RpgPhase::EventCutscene;

    case RpgPhase::FieldMove:
        // Depuis exploration, on peut initier un combat, une cutscene ou changer de carte
        return next == RpgPhase::BattleInit
            || next == RpgPhase::EventCutscene
            || next == RpgPhase::MapTransition;

    case RpgPhase::BattleInit:
        // L'initialisation mene au combat en cours
        return next == RpgPhase::BattleInProgress;

    case RpgPhase::BattleInProgress:
        // Le combat en cours mene au resultat
        return next == RpgPhase::BattleResult;

    case RpgPhase::BattleResult:
        // Apres le resultat, retour a l'exploration
        return next == RpgPhase::FieldMove;

    case RpgPhase::EventCutscene:
        // Apres une cutscene, retour a l'exploration ou transition de carte
        return next == RpgPhase::FieldMove
            || next == RpgPhase::MapTransition
            || next == RpgPhase::BattleInit;

    case RpgPhase::MapTransition:
        // La transition de carte mene a l'exploration ou idle
        return next == RpgPhase::FieldMove
            || next == RpgPhase::Idle;
    }

    return false;
}

void CRpgStateMachine::reset() {
    current_phase_ = RpgPhase::Idle;
    prev_phase_    = RpgPhase::Idle;
    current_map_id_ = 0;
    area_id_        = 0;
    phase_timer_    = 0.f;
}

} // namespace game
