#pragma once

/// @file csoccer_ctrl.h
/// CSoccerCtrl AI — controleur d'equipe haut-niveau.
/// FSM simple : IDLE -> CHASE_BALL -> PASS -> SHOOT pour 11 joueurs.

#include "iecode/game/soccer/ball_component.h"
#include "iecode/game/soccer/soccer_player_component.h"

#include <span>
#include <cstdint>

namespace game {

/// Distance maximale (m) en deca de laquelle un joueur tente un tir au but.
inline constexpr float SOCCER_SHOOT_RANGE = 25.0f;

/// Vitesse de course standard (m/s).
inline constexpr float SOCCER_RUN_SPEED = 7.0f;

/// Vitesse de sprint (m/s) pour rejoindre le ballon.
inline constexpr float SOCCER_SPRINT_SPEED = 9.5f;

/// Puissance d'un tir au but (impulsion).
inline constexpr float SOCCER_SHOOT_POWER = 30.0f;

/// Puissance d'une passe.
inline constexpr float SOCCER_PASS_POWER = 18.0f;

/// Controleur AI d'equipe — applique une FSM simple aux 11 joueurs.
/// Distinct de game::CSoccerCtrl (input joueur) — c'est l'AI haut-niveau.
struct CSoccerTeamAi {
    /// Goal cible de l'equipe (x du but adverse).
    float target_goal_x_ = 50.0f;

    /// Met a jour l'AI d'une equipe complete.
    /// @param dt        Delta time (secondes).
    /// @param ball      Ballon partage du match.
    /// @param players   Span sur les joueurs de l'equipe.
    void update_team(float dt, BallComponent& ball,
                     std::span<SoccerPlayerComponent> players);
};

} // namespace game
