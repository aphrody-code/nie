#pragma once

/// @file soccer_ctrl_ai.h
/// CSoccerCtrlAI — controleur IA pour les equipes non-joueur.
/// CSoccerCtrlAIStateMachine — machine a etats de l'IA soccer.
/// Classes RTTI : game::CSoccerCtrlAI, game::CSoccerCtrlAIStateMachine.

#include "soccer_ctrl.h"
#include <cstdint>

namespace game {

/// Etats de l'IA soccer.
enum class SoccerAIState : uint8_t {
    Init     = 0,
    Idle     = 1,
    Attack   = 2,
    Defend   = 3,
    Support  = 4,
    Mark     = 5,
    None     = 6,
};

/// Retourne le nom lisible d'un etat IA.
[[nodiscard]] constexpr std::string_view soccer_ai_state_name(SoccerAIState state) {
    switch (state) {
    case SoccerAIState::Init:    return "Init";
    case SoccerAIState::Idle:    return "Idle";
    case SoccerAIState::Attack:  return "Attack";
    case SoccerAIState::Defend:  return "Defend";
    case SoccerAIState::Support: return "Support";
    case SoccerAIState::Mark:    return "Mark";
    case SoccerAIState::None:    return "None";
    }
    return "Unknown";
}

/// Machine a etats de l'IA soccer.
struct CSoccerCtrlAIStateMachine {
    SoccerAIState current_state_ = SoccerAIState::Init;
    SoccerAIState prev_state_    = SoccerAIState::Init;
    float         state_timer_   = 0.f;

    /// Effectue une transition vers un nouvel etat.
    void transition(SoccerAIState next);

    /// Met a jour le timer.
    void update(float dt);
};

/// Controleur IA — gere le comportement de l'equipe adverse (ou alliee).
/// Utilise GDSSoccerUserAIConfig pour les parametres de difficulte.
struct CSoccerCtrlAI : CSoccerCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view class_name() const override { return "CSoccerCtrlAI"; }

    /// Decide de l'etat IA en fonction de la possession de balle.
    void evaluate(bool team_has_ball);

    /// Choisit la meilleure action pour un joueur IA.
    [[nodiscard]] SoccerAction decide_action(bool has_ball, float dist_to_ball) const;

    CSoccerCtrlAIStateMachine state_machine_;

    float aggression_    = 0.5f;  // Facteur d'agressivite [0, 1]
    float pass_accuracy_ = 0.7f;  // Precision des passes [0, 1]
    float shot_accuracy_ = 0.5f;  // Precision des tirs [0, 1]
    uint32_t difficulty_ = 1;     // Niveau de difficulte

    /// Seuil de distance pour declencher un tacle.
    float tackle_distance_ = 3.f;

    /// Seuil de distance pour tenter un tir.
    float shoot_distance_  = 25.f;
};

} // namespace game
