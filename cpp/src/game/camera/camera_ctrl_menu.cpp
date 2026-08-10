/// @file camera_ctrl_menu.cpp
/// Implementation de CCameraCtrlMenu et CCameraCtrlSoccerMenu.

#include "iecode/game/camera/camera_ctrl_menu.h"

#include <cmath>

namespace game {

void CCameraCtrlMenu::update(float dt) {
    if (!is_blending_) {
        return;
    }

    // Interpolation douce vers la position et le regard cibles
    const float factor = 1.f - std::exp(-blend_speed_ * dt);

    position_ += (target_position_ - position_) * factor;
    target_   += (target_lookat_ - target_) * factor;

    // Verifier si on est assez proche pour arreter le blending
    const float dist_pos = glm::length(target_position_ - position_);
    const float dist_tgt = glm::length(target_lookat_ - target_);
    if (dist_pos < 0.01f && dist_tgt < 0.01f) {
        position_ = target_position_;
        target_   = target_lookat_;
        is_blending_ = false;
    }
}

} // namespace game
