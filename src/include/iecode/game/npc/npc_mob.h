#pragma once

/// @file npc_mob.h
/// CMobNpcController — controleur PNJ pour les figurants (mob).
/// CMobNpcData — donnees PNJ pour les figurants.
///
// iecode abstraction — no RTTI counterpart in nie.exe
/// Dans nie.exe, seule game::CNpcUnit existe. CMobNpc* est une
/// abstraction iecode servant a modeliser les figurants de carte.

#include "npc_base.h"
#include <cstdint>

namespace game {

/// Donnees PNJ pour les figurants — PNJ d'ambiance et ennemis du monde RPG.
struct CMobNpcData : CBaseNpcData {
    uint32_t patrol_route_id  = 0;    // ID de la route de patrouille
    uint32_t battle_group_id  = 0;    // ID du groupe de combat (0 = pas d'engagement)
    float    patrol_speed     = 1.5f; // Vitesse de patrouille
    float    patrol_wait      = 2.f;  // Temps d'attente entre les waypoints (secondes)
    float    engage_radius    = 3.f;  // Rayon d'engagement au combat (metres)
    bool     is_hostile       = false; // Le mob est-il hostile (peut engager le combat)
};

/// Controleur PNJ pour les figurants — patrouille simple et engagement combat.
struct CMobNpcController : CBaseNpcController {
    void update(float dt) override;
    void start_patrol() override;
    void interact() override;
    [[nodiscard]] std::string_view controller_name() const override { return "CMobNpcController"; }

    /// Verifie si le joueur est dans le rayon d'engagement.
    [[nodiscard]] bool can_engage(const glm::vec3& player_pos) const;

    uint32_t current_waypoint_  = 0;
    float    wait_timer_        = 0.f;
    float    engage_radius_     = 3.f; // Rayon d'engagement (copie de CMobNpcData)
    bool     is_waiting_        = false;
    bool     is_hostile_        = false;
    bool     combat_engaged_    = false;
};

} // namespace game
