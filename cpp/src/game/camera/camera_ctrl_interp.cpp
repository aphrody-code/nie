/// @file camera_ctrl_interp.cpp
/// Implementation de CCameraCtrlInterPolate.
/// Les impls de CCameraCtrlOffset et CCameraCtrlNearFar ont ete deplacees
/// dans camera_ctrl_offset.cpp et camera_ctrl_near_far.cpp (nouvelle
/// hierarchie basee sur CCameraCtrlChaseBase).

#include "iecode/game/camera/camera_ctrl_interp.h"

#include <algorithm>

namespace game {

void CCameraCtrlInterPolate::update(float dt) {
    // Blender progressivement entre camera A et camera B
    blend_weight_ = std::clamp(blend_weight_ + blend_speed_ * dt, 0.f, 1.f);

    if (camera_a_ && camera_b_) {
        const float w = blend_weight_;
        position_ = camera_a_->position_ * (1.f - w) + camera_b_->position_ * w;
        target_   = camera_a_->target_ * (1.f - w) + camera_b_->target_ * w;
        fov_      = camera_a_->fov_ * (1.f - w) + camera_b_->fov_ * w;
    } else if (camera_a_) {
        position_ = camera_a_->position_;
        target_   = camera_a_->target_;
        fov_      = camera_a_->fov_;
    } else if (camera_b_) {
        position_ = camera_b_->position_;
        target_   = camera_b_->target_;
        fov_      = camera_b_->fov_;
    }
}

} // namespace game
