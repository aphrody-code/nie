/// @file camera_ctrl_chase.cpp
/// Implementation de CCameraCtrlChase — camera de poursuite generique.
/// Pour CCameraCtrlChaseSoccer voir camera_ctrl_chase_soccer.cpp.

#include "iecode/game/camera/camera_ctrl_chase.h"

#include <glm/gtc/constants.hpp>
#include <glm/trigonometric.hpp>

#include <algorithm>
#include <cmath>

namespace game {

void CCameraCtrlChase::update(float dt) {
    // Interpolation douce vers la position cible du personnage suivi.
    // Le lissage attenuation exponentielle evite les mouvements saccades.
    const float factor = 1.f - std::exp(-smoothing_ * dt);

    // Calcul de la position souhaitee de la camera (spherique autour de la cible)
    const float yaw_rad   = glm::radians(yaw_);
    const float pitch_rad = glm::radians(pitch_);
    const float cos_pitch = std::cos(pitch_rad);

    const glm::vec3 offset{
        distance_ * cos_pitch * std::sin(yaw_rad),
        distance_ * std::sin(pitch_rad) + height_,
        distance_ * cos_pitch * std::cos(yaw_rad),
    };

    const glm::vec3 desired_pos = chase_target_pos_ + offset;

    // Interpolation position et cible
    position_ += (desired_pos - position_) * factor;
    target_   += (chase_target_pos_ - target_) * factor;

    // Clamper la distance dans les bornes min/max
    const glm::vec3 diff = position_ - target_;
    const float dist = glm::length(diff);
    if (dist > 0.001f) {
        const float clamped = std::clamp(dist, min_distance_, max_distance_);
        if (std::abs(clamped - dist) > 0.001f) {
            position_ = target_ + (diff / dist) * clamped;
        }
    }
}

} // namespace game
