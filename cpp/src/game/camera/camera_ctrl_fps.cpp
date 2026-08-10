/// @file camera_ctrl_fps.cpp
/// Implementation de CCameraCtrlFps — camera premiere personne.

#include "iecode/game/camera/camera_ctrl_fps.h"

#include <glm/trigonometric.hpp>

#include <algorithm>
#include <cmath>

namespace game {

void CCameraCtrlFps::update(float /*dt*/) {
    // Clamper le pitch pour eviter le retournement de la camera
    pitch_ = std::clamp(pitch_, -89.f, 89.f);

    const float yaw_rad   = glm::radians(yaw_);
    const float pitch_rad = glm::radians(pitch_);

    // Direction du regard
    const glm::vec3 forward{
        std::cos(pitch_rad) * std::sin(yaw_rad),
        std::sin(pitch_rad),
        std::cos(pitch_rad) * std::cos(yaw_rad),
    };

    // La position est callee a hauteur de tete au-dessus de position_
    // (position_ represente la base du personnage)
    position_.y = position_.y + head_height_;
    target_ = position_ + forward;
}

} // namespace game
