/// @file camera_ctrl_chase_soccer.cpp
/// Implementation de CCameraCtrlChaseSoccer — camera de poursuite soccer
/// avec zoom adaptatif base sur la position du ballon.

#include "iecode/game/camera/camera_ctrl_chase_soccer.h"

#include <glm/trigonometric.hpp>

#include <algorithm>
#include <cmath>

namespace game {

void CCameraCtrlChaseSoccer::update(float dt) {
    // La camera soccer suit le ballon avec un zoom adaptatif
    // base sur la position du ballon par rapport au terrain.
    const float factor = 1.f - std::exp(-smoothing_ * dt);

    // Zoom adaptatif : plus le ballon est loin du centre, plus on dezoome
    const float ball_x_norm = std::abs(ball_position_.x) / (field_width_ * 0.5f);
    const float ball_z_norm = std::abs(ball_position_.z) / (field_height_ * 0.5f);
    const float edge_factor = std::max(ball_x_norm, ball_z_norm);
    const float adaptive_distance = distance_ * (1.f + edge_factor * zoom_factor_);

    const float yaw_rad   = glm::radians(yaw_);
    const float pitch_rad = glm::radians(pitch_);
    const float cos_pitch = std::cos(pitch_rad);

    const glm::vec3 offset{
        adaptive_distance * cos_pitch * std::sin(yaw_rad),
        adaptive_distance * std::sin(pitch_rad) + height_,
        adaptive_distance * cos_pitch * std::cos(yaw_rad),
    };

    const glm::vec3 desired_pos = ball_position_ + offset;

    position_ += (desired_pos - position_) * factor;
    target_   += (ball_position_ - target_) * factor;
}

} // namespace game
