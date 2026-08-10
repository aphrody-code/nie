/// @file csoccer_ctrl.cpp
/// AI d'equipe simple : trouve le plus proche, chase, passe ou tire.

#include "iecode/game/soccer/csoccer_ctrl.h"

#include <glm/geometric.hpp>
#include <algorithm>
#include <cmath>
#include <limits>

namespace game {

namespace {

[[nodiscard]] float distance_xz_sq(const glm::vec3& a, const glm::vec3& b) {
    const float dx = a.x - b.x;
    const float dz = a.z - b.z;
    return dx * dx + dz * dz;
}

} // namespace

void CSoccerTeamAi::update_team(float /*dt*/, BallComponent& ball,
                                std::span<SoccerPlayerComponent> players) {
    if (players.empty()) {
        return;
    }

    // 1. Trouver le joueur le plus proche du ballon — il est designe "chaser".
    size_t chaser_idx = 0;
    float  best_dist  = std::numeric_limits<float>::max();
    for (size_t i = 0; i < players.size(); ++i) {
        const float d = distance_xz_sq(players[i].position_, ball.position_);
        if (d < best_dist) {
            best_dist = d;
            chaser_idx = i;
        }
    }

    // 2. Chaque joueur a un comportement minimal selon son role.
    for (size_t i = 0; i < players.size(); ++i) {
        auto& p = players[i];

        if (i == chaser_idx) {
            // Le chaser : si tres proche, prend possession.
            if (best_dist < 1.0f) {
                if (!ball.is_owned()) {
                    ball.set_owner(p.player_id_);
                    p.has_ball_ = true;
                }
            }

            if (p.has_ball_) {
                // Possession : choisir entre tir, passe ou dribble.
                const float dist_goal_x = target_goal_x_ - p.position_.x;
                const float dist_goal = std::sqrt(
                    dist_goal_x * dist_goal_x + p.position_.z * p.position_.z);

                if (dist_goal < SOCCER_SHOOT_RANGE) {
                    // SHOOT
                    glm::vec3 dir{target_goal_x_ - p.position_.x,
                                  1.5f, // legere elevation
                                  -p.position_.z};
                    p.kick_ball(ball, dir, SOCCER_SHOOT_POWER);
                    ball.position_ = p.position_;
                    ball.position_.y = 0.5f;
                    p.state_ = SoccerPlayerComponent::State::SHOOTING;
                } else {
                    // Cherche un coequipier plus avance et libre pour passer.
                    const float my_advance =
                        (target_goal_x_ > 0.f) ? p.position_.x : -p.position_.x;
                    int best_mate = -1;
                    float best_advance = my_advance;
                    for (size_t j = 0; j < players.size(); ++j) {
                        if (j == i) continue;
                        const auto& mate = players[j];
                        const float adv =
                            (target_goal_x_ > 0.f) ? mate.position_.x : -mate.position_.x;
                        if (adv > best_advance + 5.0f) {
                            best_advance = adv;
                            best_mate = static_cast<int>(j);
                        }
                    }

                    if (best_mate >= 0) {
                        // PASS
                        const auto& mate = players[static_cast<size_t>(best_mate)];
                        glm::vec3 dir = mate.position_ - p.position_;
                        dir.y = 0.5f;
                        p.kick_ball(ball, dir, SOCCER_PASS_POWER);
                        ball.position_ = p.position_;
                        ball.position_.y = 0.3f;
                    } else {
                        // DRIBBLE — avancer vers le but
                        glm::vec3 goal{target_goal_x_, 0.f, 0.f};
                        p.move_toward(goal, SOCCER_RUN_SPEED);
                        ball.position_ = p.position_;
                        p.state_ = SoccerPlayerComponent::State::DRIBBLING;
                    }
                }
            } else {
                // CHASE_BALL — sprinter vers le ballon
                p.move_toward(ball.position_, SOCCER_SPRINT_SPEED);
            }
        } else {
            // Autres joueurs : maintenir une position de soutien (offset
            // statique). Si on est trop loin de sa position de base, y revenir.
            // On reste passifs pour le squelette d'AI.
            if (p.state_ != SoccerPlayerComponent::State::IDLE) {
                p.velocity_ = {0.f, 0.f, 0.f};
                p.state_ = SoccerPlayerComponent::State::IDLE;
            }
        }
    }
}

} // namespace game
