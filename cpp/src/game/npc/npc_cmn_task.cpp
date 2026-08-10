/// @file npc_cmn_task.cpp
/// Implementation de CCmnTaskNpcController — PNJ pour taches communes.
/// Dialogues, quetes generiques, progression d'etat de tache.

#include "iecode/game/npc/npc_cmn_task.h"

#include <spdlog/spdlog.h>

namespace game {

void CCmnTaskNpcController::update(float /*dt*/) {
    // Le PNJ tache commune ne bouge pas — il attend l'interaction
}

void CCmnTaskNpcController::interact() {
    if (!is_interactable_) {
        return;
    }

    // Passer en mode dialogue
    set_behavior(NpcBehavior::Talk);

    spdlog::info("CCmnTaskNpc: interaction, etat tache = {}",
                 current_task_state_);
}

} // namespace game
