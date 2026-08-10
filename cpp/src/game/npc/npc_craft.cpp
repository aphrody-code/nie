/// @file npc_craft.cpp
/// Implementation de CCraftNpcController — PNJ pour les ateliers de craft.

#include "iecode/game/npc/npc_craft.h"

#include <spdlog/spdlog.h>

namespace game {

void CCraftNpcController::update(float /*dt*/) {
    // Le PNJ craft est statique — attend l'interaction
}

void CCraftNpcController::interact() {
    if (!is_interactable_) {
        return;
    }

    // Ouvrir le menu de craft
    is_crafting_ = true;
    set_behavior(NpcBehavior::Talk);

    spdlog::info("CCraftNpc: ouverture de l'atelier de craft");
}

} // namespace game
