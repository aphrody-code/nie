#pragma once

/// @file scene_soccer.h
/// SceneSoccer — scene complete d'un match de foot 11v11.
/// Place 22 acteurs dans une Scene ECS et fait tourner physique + AI.

#include "iecode/engine/ecs/scene.h"
#include "iecode/game/soccer/ball_component.h"
#include "iecode/game/soccer/csoccer_ctrl.h"
#include "iecode/game/soccer/soccer_player_component.h"

#include <vector>
#include <cstdint>

namespace game {

/// Demi-longueur du terrain (m). Terrain 100 x 68.
inline constexpr float SOCCER_FIELD_HALF_LENGTH = 50.0f;

/// Demi-largeur du terrain (m).
inline constexpr float SOCCER_FIELD_HALF_WIDTH = 34.0f;

/// Largeur du but (m).
inline constexpr float SOCCER_GOAL_HALF_WIDTH = 3.66f;

/// Duree d'un match (90 minutes).
inline constexpr float SOCCER_MATCH_DURATION = 90.0f * 60.0f;

/// Scene complete d'un match.
class SceneSoccer {
public:
    int   score_home_   = 0;
    int   score_away_   = 0;
    float match_time_   = 0.f;
    bool  match_active_ = false;

    /// Initialise la scene : cree 22 acteurs (11v11) et la balle.
    void init(lives::ecs::Scene& scene);

    /// Met a jour la simulation (physique balle, AI 2 equipes, timer).
    void update(float dt);

    /// Detecte un but et incremente le score.
    /// Appelle handle_goal() si la balle franchit une ligne de but.
    void handle_goal();

    /// Acces aux joueurs (lecture/ecriture).
    [[nodiscard]] std::vector<SoccerPlayerComponent*>& players() noexcept {
        return players_;
    }

    /// Acces a la balle.
    [[nodiscard]] BallComponent* ball() noexcept { return ball_; }

private:
    BallComponent*                       ball_ = nullptr;
    std::vector<SoccerPlayerComponent*>  players_;
    CSoccerTeamAi                        ai_home_;
    CSoccerTeamAi                        ai_away_;
    lives::ecs::Scene*                   scene_ = nullptr;
};

} // namespace game
