/// @file chara_move_ctrl.cpp
/// Implementation de CCharaMoveCtrl — deplacement 3D, gravite, waypoints.

#include "iecode/game/chara/chara_move_ctrl.h"

#include <glm/geometric.hpp>
#include <spdlog/spdlog.h>

#include <cmath>

namespace game {

void CCharaMoveCtrl::update(float dt) {
    if (dt <= 0.f) {
        return;
    }

    // --- Suivi de waypoints ---
    if (!waypoints_.empty() && current_waypoint_ < waypoints_.size()) {
        target_position_ = waypoints_[current_waypoint_].position;
        has_target_ = true;

        const float wp_radius = waypoints_[current_waypoint_].radius;
        const glm::vec3 to_wp = target_position_ - position_;
        const float dist = glm::length(glm::vec3(to_wp.x, 0.f, to_wp.z));

        if (dist < wp_radius) {
            ++current_waypoint_;
            if (current_waypoint_ >= waypoints_.size()) {
                // Destination atteinte
                has_target_ = false;
                is_moving_ = false;
            }
        }
    }

    // --- Calcul de la direction vers la cible ---
    if (has_target_) {
        const glm::vec3 to_target = target_position_ - position_;
        const float horiz_dist = glm::length(glm::vec3(to_target.x, 0.f, to_target.z));

        if (horiz_dist > 0.01f) {
            direction_ = glm::normalize(glm::vec3(to_target.x, 0.f, to_target.z));
            is_moving_ = true;

            // Acceleration vers la vitesse max
            speed_ += act_param_.walk_speed * move_param_.acceleration * dt;
            speed_ = std::min(speed_, max_speed_);
        } else {
            // Arrive a la cible
            has_target_ = false;
            is_moving_ = false;
        }
    }

    // --- Deceleration si pas de cible ---
    if (!is_moving_ && speed_ > 0.f) {
        speed_ -= move_param_.deceleration * dt;
        speed_ = std::max(speed_, 0.f);
    }

    // --- Integration de la velocite horizontale ---
    velocity_.x = direction_.x * speed_;
    velocity_.z = direction_.z * speed_;

    // --- Gravite ---
    if (!is_grounded_) {
        velocity_.y += move_param_.gravity * dt;
    } else {
        velocity_.y = 0.f;
    }

    // --- Integration de la position ---
    position_ += velocity_ * dt;

    // --- Sol basique (y = 0) ---
    if (position_.y < 0.f) {
        position_.y = 0.f;
        velocity_.y = 0.f;
        is_grounded_ = true;
    }

    // --- Mise a jour de l'etat d'animation ---
    anim_state_ = compute_anim_state();
}

void CCharaMoveCtrl::move_to(const glm::vec3& target) {
    target_position_ = target;
    has_target_ = true;
    waypoints_.clear();
    current_waypoint_ = 0;
}

void CCharaMoveCtrl::set_path(const std::vector<Waypoint>& path) {
    waypoints_ = path;
    current_waypoint_ = 0;
    if (!waypoints_.empty()) {
        has_target_ = true;
    }
}

void CCharaMoveCtrl::stop() {
    has_target_ = false;
    is_moving_ = false;
    speed_ = 0.f;
    velocity_ = {0.f, 0.f, 0.f};
    waypoints_.clear();
    current_waypoint_ = 0;
    anim_state_ = MoveAnimState::Idle;
}

MoveAnimState CCharaMoveCtrl::compute_anim_state() const {
    if (speed_ < 0.1f) {
        return MoveAnimState::Idle;
    }
    if (speed_ < act_param_.walk_speed * 0.9f) {
        return MoveAnimState::Walk;
    }
    if (speed_ < act_param_.run_speed * 0.9f) {
        return MoveAnimState::Run;
    }
    return MoveAnimState::Dash;
}

bool CCharaMoveCtrl::has_reached_destination() const {
    if (has_target_) {
        return false;
    }
    if (!waypoints_.empty() && current_waypoint_ < waypoints_.size()) {
        return false;
    }
    return !is_moving_;
}

} // namespace game
