/// @file npc_mob.cpp
/// Implementation de CMobNpcController — PNJ figurant et ennemi du monde RPG.
/// Patrouille simple entre waypoints, engagement de combat au contact.

#include "iecode/game/npc/npc_mob.h"

#include <spdlog/spdlog.h>

#include <glm/geometric.hpp>

namespace game {

void CMobNpcController::update(float dt) {
    // Si le combat est engage, ne pas bouger
    if (combat_engaged_) {
        return;
    }

    // Gestion de la patrouille
    if (behavior_ == NpcBehavior::Patrol) {
        if (is_waiting_) {
            // Attente entre deux waypoints
            wait_timer_ -= dt;
            if (wait_timer_ <= 0.f) {
                is_waiting_ = false;
                wait_timer_ = 0.f;
                ++current_waypoint_;
                spdlog::trace("CMobNpc: passage au waypoint {}", current_waypoint_);
            }
        } else {
            // Deplacement vers le prochain waypoint
            // (La direction reelle est calculee par le systeme de navigation)
            position_ += direction_ * move_speed_ * dt;
        }
    }
}

void CMobNpcController::start_patrol() {
    set_behavior(NpcBehavior::Patrol);
    current_waypoint_ = 0;
    is_waiting_ = false;
    wait_timer_ = 0.f;
    combat_engaged_ = false;

    spdlog::debug("CMobNpc: debut de patrouille");
}

void CMobNpcController::interact() {
    if (!is_interactable_) {
        return;
    }

    if (is_hostile_ && !combat_engaged_) {
        // Engagement de combat
        combat_engaged_ = true;
        set_behavior(NpcBehavior::Custom);
        spdlog::info("CMobNpc: combat engage !");
    }
}

bool CMobNpcController::can_engage(const glm::vec3& player_pos) const {
    if (!is_hostile_ || combat_engaged_) {
        return false;
    }
    float dist = glm::distance(position_, player_pos);
    return dist <= engage_radius_;
}

} // namespace game
