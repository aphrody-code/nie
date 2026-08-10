#pragma once

/// @file npc_base.h
/// CBaseNpcController — controleur de base des PNJ.
/// CBaseNpcData — donnees de base d'un PNJ.
///
// iecode abstraction — no RTTI counterpart in nie.exe
/// Seule la classe game::CNpcUnit existe reellement dans le RTTI de
/// nie.exe. Les types CBaseNpcController / CBaseNpcData sont des
/// abstractions propres a iecode pour factoriser la logique commune.

#include <glm/vec3.hpp>
#include <cstdint>
#include <string_view>

namespace game {

/// Etats de comportement d'un PNJ.
enum class NpcBehavior : uint8_t {
    Idle     = 0,   // Immobile
    Patrol   = 1,   // Patrouille
    Talk     = 2,   // Dialogue
    Follow   = 3,   // Suit le joueur
    Flee     = 4,   // Fuit
    Custom   = 5,   // Comportement scripte
};

/// Nom lisible d'un etat NPC.
[[nodiscard]] constexpr std::string_view npc_behavior_name(NpcBehavior b) {
    switch (b) {
    case NpcBehavior::Idle:   return "Idle";
    case NpcBehavior::Patrol: return "Patrol";
    case NpcBehavior::Talk:   return "Talk";
    case NpcBehavior::Follow: return "Follow";
    case NpcBehavior::Flee:   return "Flee";
    case NpcBehavior::Custom: return "Custom";
    }
    return "Unknown";
}

/// Donnees de base d'un PNJ — identite et parametres.
struct CBaseNpcData {
    virtual ~CBaseNpcData() = default;

    uint32_t npc_id     = 0;
    uint32_t name_hash  = 0;     // Hash CRC32 du nom
    uint32_t model_id   = 0;     // ID du modele 3D (GDSCharaModel)
    uint32_t map_id     = 0;     // ID de la carte ou se trouve le PNJ
    uint32_t dialogue_index = 0; // Index de dialogue dans cfg.bin (0 = pas de dialogue)
    glm::vec3 spawn_pos = {0.f, 0.f, 0.f};
    float    spawn_yaw  = 0.f;   // Orientation initiale (degres)
    bool     is_visible = true;
    bool     is_active  = true;
};

/// Controleur de base des PNJ — interface de comportement.
struct CBaseNpcController {
    virtual ~CBaseNpcController() = default;

    /// Mise a jour du PNJ.
    virtual void update(float /*dt*/) {}

    /// Debut d'une patrouille.
    virtual void start_patrol() {}

    /// Interaction avec le joueur.
    virtual void interact() {}

    /// Nom RTTI du controleur.
    [[nodiscard]] virtual std::string_view controller_name() const { return "CBaseNpcController"; }

    /// Verifie si le joueur est dans le rayon de detection.
    [[nodiscard]] bool is_player_in_range(const glm::vec3& player_pos) const;

    /// Change le comportement du PNJ.
    void set_behavior(NpcBehavior new_behavior);

    /// Verifie si le PNJ est en etat de dialogue.
    [[nodiscard]] bool is_talking() const { return behavior_ == NpcBehavior::Talk; }

    NpcBehavior behavior_        = NpcBehavior::Idle;
    glm::vec3   position_        = {0.f, 0.f, 0.f};
    glm::vec3   direction_       = {0.f, 0.f, 1.f};
    float       move_speed_      = 2.f;
    float       detection_radius_ = 5.f;   // Rayon de detection du joueur (metres)
    bool        is_interactable_ = true;
};

} // namespace game
