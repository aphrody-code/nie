/// @file camera_ctrl_selfie.cpp
/// Implementation de CCameraCtrlSelfie — camera selfie (mode photo).

#include "iecode/game/camera/camera_ctrl_selfie.h"

#include <glm/trigonometric.hpp>

#include <algorithm>
#include <cmath>

namespace game {

void CCameraCtrlSelfie::update(float /*dt*/) {
    // Clamper le pitch et la distance
    pitch_    = std::clamp(pitch_, -80.f, 80.f);
    distance_ = std::clamp(distance_, min_dist_, max_dist_);

    const float yaw_rad   = glm::radians(yaw_);
    const float pitch_rad = glm::radians(pitch_);
    const float cos_pitch = std::cos(pitch_rad);

    // Position orbitale autour de la cible (le personnage)
    const glm::vec3 offset{
        distance_ * cos_pitch * std::sin(yaw_rad),
        distance_ * std::sin(pitch_rad),
        distance_ * cos_pitch * std::cos(yaw_rad),
    };

    position_ = target_ + offset;
}

} // namespace game
