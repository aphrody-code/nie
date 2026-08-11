/// @file soccer_ctrl_ai.cpp
/// Implementation de CSoccerCtrlAI — controleur IA pour les equipes non-joueur.
/// Gere les decisions offensives/defensives et le declenchement de techniques.

#include "iecode/game/soccer/soccer_ctrl_ai.h"

#include <spdlog/spdlog.h>

namespace game {

// ── CSoccerCtrlAIStateMachine ───────────────────────────────────────────

void CSoccerCtrlAIStateMachine::transition(SoccerAIState next) {
    if (current_state_ == next) {
        return;
    }

    spdlog::debug("CSoccerCtrlAIStateMachine: {} -> {}",
                  soccer_ai_state_name(current_state_),
                  soccer_ai_state_name(next));

    prev_state_    = current_state_;
    current_state_ = next;
    state_timer_   = 0.f;
}

void CSoccerCtrlAIStateMachine::update(float dt) {
    state_timer_ += dt;
}

// ── CSoccerCtrlAI ───────────────────────────────────────────────────────

void CSoccerCtrlAI::update(float dt) {
    if (!active_) {
        return;
    }

    state_machine_.update(dt);
}

void CSoccerCtrlAI::evaluate(bool team_has_ball) {
    if (!active_) {
        return;
    }

    if (team_has_ball) {
        // En possession : attaque ou soutien
        if (state_machine_.current_state_ != SoccerAIState::Attack
            && state_machine_.current_state_ != SoccerAIState::Support) {
            // Le choix entre attaque et soutien depend de l'agressivite
            if (aggression_ > 0.5f) {
                state_machine_.transition(SoccerAIState::Attack);
            } else {
                state_machine_.transition(SoccerAIState::Support);
            }
        }
    } else {
        // Sans possession : defense ou marquage
        if (state_machine_.current_state_ != SoccerAIState::Defend
            && state_machine_.current_state_ != SoccerAIState::Mark) {
            if (aggression_ > 0.7f) {
                // IA aggressive : marquage individuel
                state_machine_.transition(SoccerAIState::Mark);
            } else {
                state_machine_.transition(SoccerAIState::Defend);
            }
        }
    }
}

SoccerAction CSoccerCtrlAI::decide_action(bool has_ball, float dist_to_ball) const {
    if (has_ball) {
        // Avec la balle : choisir entre tir, passe, dribble
        if (dist_to_ball < shoot_distance_ && shot_accuracy_ > 0.4f) {
            return SoccerAction::SHOOT;
        }
        if (pass_accuracy_ > 0.6f) {
            return SoccerAction::PASS;
        }
        return SoccerAction::DRIBBLE;
    }

    // Sans la balle : tacle si assez proche, sinon rien
    if (dist_to_ball < tackle_distance_ && aggression_ > 0.3f) {
        return SoccerAction::TACKLE;
    }

    return SoccerAction::NONE;
}

} // namespace game
