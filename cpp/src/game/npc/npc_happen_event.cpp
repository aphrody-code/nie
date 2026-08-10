/// @file npc_happen_event.cpp
/// Implementation de CHappenEventNpcController — PNJ declencheur d'evenements.
/// Evenements contextuels declenches par proximite ou interaction.

#include "iecode/game/npc/npc_happen_event.h"

#include <spdlog/spdlog.h>

#include <glm/geometric.hpp>

namespace game {

void CHappenEventNpcController::update(float /*dt*/) {
    // Rien a faire si deja declenche (one-shot)
    if (is_triggered_) {
        return;
    }

    // Mise a jour de l'etat de base
    // Le declenchement se fait soit par proximite (dans le caller via
    // is_player_in_range) soit par interaction directe.
}

void CHappenEventNpcController::interact() {
    if (!is_interactable_) {
        return;
    }

    if (is_triggered_) {
        spdlog::debug("CHappenEventNpc: evenement deja declenche");
        return;
    }

    // Declencher l'evenement
    is_triggered_ = true;
    set_behavior(NpcBehavior::Custom);

    spdlog::info("CHappenEventNpc: evenement declenche, dist_joueur={:.2f}",
                 dist_to_player_);
}

} // namespace game
