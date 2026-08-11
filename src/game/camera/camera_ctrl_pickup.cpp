/// @file camera_ctrl_pickup.cpp
/// Implementation de CCameraCtrlPickUp — camera pour les sequences de ramassage.

#include "iecode/game/camera/camera_ctrl_pickup.h"


namespace game {

void CCameraCtrlPickUp::update(float dt) {
    elapsed_ += dt;

    // Phase 1 : zoom in (0 -> blend_time_)
    // Phase 2 : hold (blend_time_ -> blend_time_ + hold_time_)
    // Phase 3 : zoom out (apres)
    float target_dist = zoom_out_;
    if (elapsed_ < blend_time_) {
        // Zoom in — interpolation de zoom_out vers zoom_in
        const float t = elapsed_ / blend_time_;
        target_dist = zoom_out_ + (zoom_in_ - zoom_out_) * t;
    } else if (elapsed_ < blend_time_ + hold_time_) {
        // Hold — maintient le zoom in
        target_dist = zoom_in_;
    } else {
        // Zoom out — retour progressif
        const float t = (elapsed_ - blend_time_ - hold_time_) / blend_time_;
        const float t_clamped = std::min(t, 1.f);
        target_dist = zoom_in_ + (zoom_out_ - zoom_in_) * t_clamped;
    }

    // Positionner la camera a target_dist du focus_point
    const glm::vec3 dir = position_ - focus_point_;
    const float len = glm::length(dir);
    if (len > 0.001f) {
        position_ = focus_point_ + (dir / len) * target_dist;
    }

    target_ = focus_point_;
}

} // namespace game
