/// @file camera_ctrl_offset.cpp
/// Implementation de CCameraCtrlOffset — applique un offset (additif
/// ou absolu) sur la position et la cible de la camera.

#include "iecode/game/camera/camera_ctrl_offset.h"

#include <cmath>

namespace game {

void CCameraCtrlOffset::update(float dt) {
    if (dt <= 0.f) {
        return;
    }
    const float factor = 1.f - std::exp(-blend_speed_ * dt);

    // Interpolation de dynamic_offset_ (vec4 stocke dans la base) vers la
    // valeur cible offset_pos_. dynamic_offset_.w est conserve.
    const glm::vec3 current_dyn{dynamic_offset_.x, dynamic_offset_.y, dynamic_offset_.z};
    const glm::vec3 blended = current_dyn + (offset_pos_ - current_dyn) * factor;
    dynamic_offset_ = {blended.x, blended.y, blended.z, dynamic_offset_.w};

    if (additive_offset_ != 0) {
        // Mode additif : on ajoute l'offset a la position courante.
        position_ += blended * dt;
        target_   += offset_target_ * dt;
    } else {
        // Mode absolu : l'offset remplace la position.
        position_ = blended;
        target_   = offset_target_;
    }

    update_interp(dt);
}

} // namespace game
