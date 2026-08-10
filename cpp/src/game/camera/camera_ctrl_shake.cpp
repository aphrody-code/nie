/// @file camera_ctrl_shake.cpp
/// Implementation de CCameraCtrlShake — camera avec tremblement.
/// Utilisee pour les impacts et tirs speciaux.

#include "iecode/game/camera/camera_ctrl_shake.h"

#include <cmath>

namespace game {

void CCameraCtrlShake::update(float dt) {
    // Copier la position de la camera source
    if (source_) {
        position_ = source_->position_;
        target_   = source_->target_;
        fov_      = source_->fov_;
    }

    if (!is_active_) {
        return;
    }

    elapsed_ += dt;

    // Fin du tremblement
    if (elapsed_ >= duration_) {
        is_active_ = false;
        elapsed_   = 0.f;
        return;
    }

    // Attenuation exponentielle — le tremblement diminue au fil du temps
    const float decay_factor = std::exp(-decay_ * elapsed_ / duration_);
    const float current_amp  = amplitude_ * decay_factor;

    // Generateur pseudo-aleatoire simple base sur le temps
    // (deterministe pour la reproductibilite)
    const float phase = elapsed_ * frequency_ * 6.2831853f; // 2*PI*f*t
    const float shake_x = current_amp * std::sin(phase);
    const float shake_y = current_amp * std::sin(phase * 1.3f + 1.7f);
    const float shake_z = current_amp * std::sin(phase * 0.7f + 3.1f);

    position_ += glm::vec3{shake_x, shake_y, shake_z};
}

} // namespace game
