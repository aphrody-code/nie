/// @file soccer_player_component.cpp
/// Implementation du composant joueur de foot.

#include "iecode/game/soccer/soccer_player_component.h"

#include <glm/geometric.hpp>
#include <algorithm>

namespace game {

void SoccerPlayerComponent::update(float dt) {
    // Integration cinematique simple
    position_ += velocity_ * dt;

    // Maintenir le joueur au sol
    if (position_.y < 0.f) {
        position_.y = 0.f;
    }

    // Stamina : recuperation lente au repos, drain au sprint
    constexpr float STAMINA_REGEN = 5.0f;
    constexpr float STAMINA_DRAIN = 8.0f;
    constexpr float SPRINT_THRESHOLD_SQ = 60.0f * 60.0f;
    const float speed_sq = velocity_.x * velocity_.x + velocity_.z * velocity_.z;
    if (speed_sq > SPRINT_THRESHOLD_SQ) {
        stamina_ = std::max(0.f, stamina_ - STAMINA_DRAIN * dt);
    } else {
        stamina_ = std::min(100.f, stamina_ + STAMINA_REGEN * dt);
    }
}

void SoccerPlayerComponent::move_toward(glm::vec3 target, float speed) {
    glm::vec3 delta = target - position_;
    delta.y = 0.f; // Mouvement horizontal uniquement
    const float dist_sq = delta.x * delta.x + delta.z * delta.z;
    if (dist_sq < 1e-4f) {
        velocity_ = {0.f, 0.f, 0.f};
        state_ = State::IDLE;
        return;
    }
    const float dist = std::sqrt(dist_sq);
    velocity_ = (delta / dist) * speed;
    state_ = State::RUNNING;
}

void SoccerPlayerComponent::kick_ball(BallComponent& ball, glm::vec3 direction, float power) {
    const float len_sq = direction.x * direction.x
                       + direction.y * direction.y
                       + direction.z * direction.z;
    if (len_sq < 1e-6f) {
        return;
    }
    const float len = std::sqrt(len_sq);
    const glm::vec3 unit = direction / len;

    ball.release();
    ball.apply_impulse(unit * power);
    has_ball_ = false;
    state_ = State::SHOOTING;
}

} // namespace game
