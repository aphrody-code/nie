#pragma once

/// @file npc_happen_event.h
/// CHappenEventNpcController — controleur PNJ pour les evenements aleatoires.
/// CHappenEventNpcData — donnees PNJ pour les evenements aleatoires.
///
// iecode abstraction — no RTTI counterpart in nie.exe
/// Dans nie.exe, seule game::CNpcUnit existe. CHappenEventNpc* est
/// une abstraction iecode modelisant les rencontres aleatoires.

#include "npc_base.h"
#include <cstdint>

namespace game {

/// Donnees PNJ pour les evenements aleatoires — PNJ qui declenchent
/// des evenements contextuels (rencontres, mini-quetes).
struct CHappenEventNpcData : CBaseNpcData {
    uint32_t event_id       = 0;     // ID de l'evenement a declencher
    uint32_t trigger_flag   = 0;     // Flag requis pour l'apparition
    float    trigger_radius = 5.f;   // Rayon de declenchement (metres)
    bool     one_shot       = true;  // Ne se declenche qu'une fois
    bool     has_triggered  = false;
};

/// Controleur PNJ pour les evenements aleatoires.
struct CHappenEventNpcController : CBaseNpcController {
    void update(float dt) override;
    void interact() override;
    [[nodiscard]] std::string_view controller_name() const override { return "CHappenEventNpcController"; }

    float dist_to_player_ = 0.f;
    bool  is_triggered_   = false;
};

} // namespace game
