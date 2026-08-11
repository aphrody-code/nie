/// @file ball_component.cpp
/// Implementation de BallComponent — physique de la balle du match soccer.
/// Gravite, friction, rebonds, possession et impulsions.

#include "iecode/game/soccer/ball_component.h"

#include <spdlog/spdlog.h>

#include <glm/geometric.hpp>
#include <algorithm>
#include <cmath>

namespace game {

void BallComponent::update_physics(float dt) {
    // Application de la gravite — appliquee par frame (convention nie.exe a 60Hz fixe).
    // BALL_GRAVITY (2.0f) represente la deceleration verticale par frame, pas par seconde.
    velocity_.y -= BALL_GRAVITY;

    // Mise a jour de la position
    position_ += velocity_ * dt;

    // Rebond au sol
    if (position_.y < 0.f) {
        position_.y = 0.f;
        velocity_.y = -velocity_.y * bounce_factor_;

        // Si le rebond est trop faible, on arrete
        if (std::abs(velocity_.y) < 0.1f) {
            velocity_.y = 0.f;
        }

        // Friction au sol sur les composantes horizontales
        velocity_.x *= ground_friction_;
        velocity_.z *= ground_friction_;
    }

    // Friction
    if (is_airborne()) {
        // Friction aerienne (tres legere)
        constexpr float AIR_FRICTION = 0.999f;
        velocity_.x *= AIR_FRICTION;
        velocity_.z *= AIR_FRICTION;
    } else {
        // Friction au sol — appliquee a chaque frame, pas seulement au rebond
        velocity_.x *= ground_friction_;
        velocity_.z *= ground_friction_;
    }

    // Amortissement du spin
    constexpr float SPIN_DECAY = 0.99f;
    spin_ *= SPIN_DECAY;

    // Arret complet si la vitesse est negligeable
    float speed_sq = velocity_.x * velocity_.x
                   + velocity_.y * velocity_.y
                   + velocity_.z * velocity_.z;
    if (speed_sq < 0.001f && !is_airborne()) {
        velocity_ = {0.f, 0.f, 0.f};
    }
}

void BallComponent::set_owner(uint32_t chara_id) {
    // Decaler l'historique de possession
    for (uint32_t i = BALL_POSSESSION_SLOTS - 1; i > 0; --i) {
        possession_slots_[i] = possession_slots_[i - 1];
    }

    // Enregistrer le nouveau possesseur dans le slot 0
    if (owner_chara_id_ != BALL_INVALID_TARGET) {
        possession_slots_[0] = static_cast<uint8_t>(owner_chara_id_ & 0xFF);
    }

    owner_chara_id_ = chara_id;

    spdlog::debug("BallComponent: possession -> joueur {:#x}", chara_id);
}

void BallComponent::release() {
    if (owner_chara_id_ != BALL_INVALID_TARGET) {
        // Enregistrer dans l'historique avant de liberer
        for (uint32_t i = BALL_POSSESSION_SLOTS - 1; i > 0; --i) {
            possession_slots_[i] = possession_slots_[i - 1];
        }
        possession_slots_[0] = static_cast<uint8_t>(owner_chara_id_ & 0xFF);
    }

    owner_chara_id_ = BALL_INVALID_TARGET;
    shot_power_     = 0.f;
    shot_direction_ = {0.f, 0.f, 0.f};

    spdlog::debug("BallComponent: balle liberee");
}

void BallComponent::apply_impulse(const glm::vec3& impulse) {
    velocity_ += impulse;

    // Calcul de la puissance de tir a partir de l'impulsion
    shot_power_     = glm::length(impulse);
    shot_direction_ = (shot_power_ > 0.f)
                    ? impulse / shot_power_
                    : glm::vec3{0.f, 0.f, 0.f};

    spdlog::debug("BallComponent: impulsion appliquee, puissance = {:.2f}", shot_power_);
}

void BallComponent::reset_at(const glm::vec3& pos) {
    position_        = pos;
    velocity_        = {0.f, 0.f, 0.f};
    spin_            = {0.f, 0.f, 0.f};
    shot_power_      = 0.f;
    shot_direction_  = {0.f, 0.f, 0.f};
    owner_chara_id_  = BALL_INVALID_TARGET;
    move_type_       = BallMoveType::Normal;
}

} // namespace game
