/// @file camera_ctrl_chase_base.cpp
/// Implementation des methodes communes de CCameraCtrlChaseBase
/// (reset, initialize, set_fov_blend, update_interp).
///
/// Reverse de nie.exe : game::CCameraCtrlChaseBase — base abstraite
/// partagee par toutes les cameras de poursuite.

#include "iecode/game/camera/camera_ctrl_chase_base.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace game {

namespace {
constexpr float kFltSentinel = -std::numeric_limits<float>::max();
} // namespace

void CCameraCtrlChaseBase::reset() {
    // Remet tous les vecteurs d'interpolation a l'origine.
    target_pos_prev_ = {0.f, 0.f, 0.f, 0.f};
    dynamic_offset_  = {0.f, 0.f, 0.f, 0.f};
    pos_start_       = {0.f, 0.f, 0.f, 0.f};
    pos_target_      = {0.f, 0.f, 0.f, 0.f};
    target2_         = {0.f, 0.f, 0.f, 0.f};

    // Sentinel -FLT_MAX : pas d'interpolation en cours (convention nie.exe).
    interp_state_   = {kFltSentinel, kFltSentinel};
    interp_active_  = 0;
    interp_mode_    = 0;
    additive_offset_ = 0;
    state_counter_  = 0;

    fov_interp_ = fov_;
}

void CCameraCtrlChaseBase::initialize(const float params[10]) {
    // Layout reverse de nie.exe : 10 floats consecutifs.
    if (params == nullptr) {
        return;
    }
    fov_       = params[0];
    near_clip_ = params[1];
    far_clip_  = params[2];
    dist_params_.x = params[3];  // dist_min
    dist_max_      = params[4];
    yaw_       = params[5];
    pitch_     = params[6];
    height_    = params[7];
    smoothing_ = params[8];
    interp_mode_ = static_cast<uint8_t>(std::clamp(params[9], 0.f, 255.f));

    fov_interp_ = fov_;
    dist_params_.y = dist_params_.x;  // distance courante = min au demarrage
}

void CCameraCtrlChaseBase::set_fov_blend(float fov) {
    // Declenche une interpolation de FOV vers la valeur cible.
    fov_interp_    = fov;
    interp_active_ = 1;
}

void CCameraCtrlChaseBase::update_interp(float dt) {
    // Ne fait rien tant qu'aucune interpolation n'est active.
    if (interp_active_ == 0 || dt <= 0.f) {
        return;
    }

    // Lissage exponentiel framerate-independant.
    const float factor = 1.f - std::exp(-smoothing_ * dt);

    // Interpolation du FOV courant vers la cible stockee dans fov_interp_.
    fov_ += (fov_interp_ - fov_) * factor;

    // Interpolation de la position : pos_start_ → pos_target_.
    pos_start_ += (pos_target_ - pos_start_) * factor;

    ++state_counter_;

    // Stop quand on est suffisamment proche de la cible.
    if (std::abs(fov_interp_ - fov_) < 0.01f) {
        interp_active_ = 0;
    }
}

} // namespace game
