/// @file soccer_state_machine.cpp
/// Implementation de CSoccerStateMachine — machine a etats du match soccer.
/// Transitions entre les 11 phases du match, gestion du temps et du score.

#include "iecode/game/soccer/soccer_state_machine.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <cmath>

namespace game {

void CSoccerStateMachine::transition(SoccerPhase next) {
    if (current_phase_ == next) {
        return;
    }

    if (!can_transition_to(next)) {
        spdlog::warn("CSoccerStateMachine: transition invalide {} -> {}",
                     soccer_phase_name(current_phase_),
                     soccer_phase_name(next));
        return;
    }

    spdlog::debug("CSoccerStateMachine: {} -> {}",
                  soccer_phase_name(current_phase_),
                  soccer_phase_name(next));

    prev_phase_    = current_phase_;
    current_phase_ = next;
    phase_timer_   = 0.f;

    // Incrementer le compteur de mi-temps quand on entre en HalfTime
    if (next == SoccerPhase::HalfTime && half_ < HALF_COUNT) {
        ++half_;
    }
}

void CSoccerStateMachine::update(float dt) {
    phase_timer_ += dt;

    // Le temps de match ne progresse que pendant le jeu en cours
    if (current_phase_ == SoccerPhase::InPlay) {
        match_time_ += dt;

        // Verification de fin de mi-temps
        if (match_time_ >= half_duration_ * static_cast<float>(half_)) {
            if (half_ < HALF_COUNT) {
                transition(SoccerPhase::HalfTime);
            } else {
                transition(SoccerPhase::FullTime);
            }
        }
    }
}

void CSoccerStateMachine::score_goal(uint32_t team_index) {
    if (team_index == 0) {
        ++score_home_;
    } else {
        ++score_away_;
    }

    spdlog::info("CSoccerStateMachine: but! Score {} - {}", score_home_, score_away_);
    transition(SoccerPhase::Goal);
}

int CSoccerStateMachine::encode_time() const {
    // Format nie.exe : minutes * 10000 + secondes
    auto total_seconds = static_cast<int>(match_time_);
    int minutes = total_seconds / 60;
    int seconds = total_seconds % 60;
    return minutes * 10000 + seconds;
}

bool CSoccerStateMachine::can_transition_to(SoccerPhase next) const {
    // Depuis FullTime, aucune transition possible
    if (current_phase_ == SoccerPhase::FullTime) {
        return false;
    }

    // Matrice de transitions valides
    switch (current_phase_) {
    case SoccerPhase::Idle:
        return next == SoccerPhase::KickOff;

    case SoccerPhase::KickOff:
        return next == SoccerPhase::InPlay;

    case SoccerPhase::InPlay:
        return next == SoccerPhase::SetPlay
            || next == SoccerPhase::Goal
            || next == SoccerPhase::HalfTime
            || next == SoccerPhase::FullTime
            || next == SoccerPhase::Penalty
            || next == SoccerPhase::FocusBattle
            || next == SoccerPhase::Command;

    case SoccerPhase::SetPlay:
        return next == SoccerPhase::InPlay
            || next == SoccerPhase::Penalty;

    case SoccerPhase::Goal:
        return next == SoccerPhase::KickOff
            || next == SoccerPhase::HalfTime
            || next == SoccerPhase::FullTime;

    case SoccerPhase::HalfTime:
        return next == SoccerPhase::KickOff;

    case SoccerPhase::Penalty:
        return next == SoccerPhase::Goal
            || next == SoccerPhase::InPlay;

    case SoccerPhase::FocusBattle:
        return next == SoccerPhase::InPlay
            || next == SoccerPhase::Goal;

    case SoccerPhase::Command:
        return next == SoccerPhase::InPlay
            || next == SoccerPhase::FocusBattle;

    case SoccerPhase::Tutorial:
        // Le tutoriel peut aller vers n'importe quel etat de jeu
        return next == SoccerPhase::KickOff
            || next == SoccerPhase::InPlay
            || next == SoccerPhase::Idle;

    case SoccerPhase::FullTime:
        return false;
    }

    return false;
}

void CSoccerStateMachine::reset() {
    current_phase_ = SoccerPhase::Idle;
    prev_phase_    = SoccerPhase::Idle;
    phase_timer_   = 0.f;
    score_home_    = 0;
    score_away_    = 0;
    half_          = 1;
    match_time_    = 0.f;
    half_duration_ = DEFAULT_HALF_DURATION;
}

} // namespace game
