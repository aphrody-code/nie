/// @file camera_ctrl_shooting.cpp
/// Implementation de CCameraCtrlShooting — cadrage dynamique pendant
/// un tir au but (suit le tireur, cible la cage adverse).

#include "iecode/game/camera/camera_ctrl_shooting.h"

#include <glm/geometric.hpp>

#include <cmath>

namespace game {

void CCameraCtrlShooting::update(float dt) {
    if (dt <= 0.f) {
        return;
    }
    const float factor = 1.f - std::exp(-smoothing_ * dt);

    // Direction normalisee tireur → cage.
    glm::vec3 dir = goal_pos_ - shooter_pos_;
    const float len2 = glm::dot(dir, dir);
    if (len2 > 1e-6f) {
        dir /= std::sqrt(len2);
    } else {
        dir = {0.f, 0.f, 1.f};
    }

    // Place la camera derriere le tireur, legerement en hauteur.
    const glm::vec3 desired_pos = shooter_pos_ - dir * back_offset_
                                + glm::vec3{0.f, height_off_, 0.f};

    position_ += (desired_pos - position_) * factor;
    target_   += (goal_pos_ - target_) * factor;

    // Blend de FOV vers la valeur serree du tir.
    set_fov_blend(shot_fov_);
    update_interp(dt);
}

} // namespace game
