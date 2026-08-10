/// @file camera_ctrl_near_far.cpp
/// Implementation de CCameraCtrlNearFar — interpolation des plans
/// de clipping pour effets de zoom et transitions.

#include "iecode/game/camera/camera_ctrl_near_far.h"

#include <cmath>

namespace game {

void CCameraCtrlNearFar::update(float dt) {
    if (dt <= 0.f) {
        return;
    }

    // Lissage exponentiel vers les plans cibles.
    const float factor = 1.f - std::exp(-blend_speed_ * dt);
    near_clip_ += (near_target_ - near_clip_) * factor;
    far_clip_  += (far_target_  - far_clip_)  * factor;

    // Propage l'interpolation de la base (FOV, pos_start → pos_target).
    update_interp(dt);
}

} // namespace game
