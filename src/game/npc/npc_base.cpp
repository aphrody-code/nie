/// @file npc_base.cpp
/// Implementation de CBaseNpcController — comportement de base des PNJ.
/// Gestion de la detection du joueur, transitions d'etat, dialogue.

#include "iecode/game/npc/npc_base.h"

#include <spdlog/spdlog.h>

#include <glm/geometric.hpp>

namespace game {

bool CBaseNpcController::is_player_in_range(const glm::vec3& player_pos) const {
    float dist = glm::distance(position_, player_pos);
    return dist <= detection_radius_;
}

void CBaseNpcController::set_behavior(NpcBehavior new_behavior) {
    if (behavior_ == new_behavior) {
        return;
    }

    spdlog::debug("NPC: {} -> {}",
                  npc_behavior_name(behavior_),
                  npc_behavior_name(new_behavior));

    behavior_ = new_behavior;
}

} // namespace game
