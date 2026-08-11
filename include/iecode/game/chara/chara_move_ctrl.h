#pragma once

/// @file chara_move_ctrl.h
/// CCharaMoveCtrl — controleur de mouvement d'un personnage.
/// CCharaMoveNAnimComp — composant mouvement + animation.
/// Classes RTTI : game::CCharaMoveCtrl, game::CCharaMoveNAnimComp.

#include "chara_param.h"

#include <glm/vec3.hpp>
#include <cstdint>
#include <vector>

namespace game {

/// Etat d'animation du personnage.
enum class MoveAnimState : uint8_t {
    Idle   = 0,
    Walk   = 1,
    Run    = 2,
    Dash   = 3,
};

/// Point de passage pour le pathfinding simple.
struct Waypoint {
    glm::vec3 position = {0.f, 0.f, 0.f};
    float     radius   = 0.5f;   ///< Rayon de validation (arrive au waypoint si distance < radius)
};

/// Controleur de mouvement — gere le deplacement physique d'un personnage.
struct CCharaMoveCtrl {
    virtual ~CCharaMoveCtrl() = default;

    /// Mise a jour du mouvement (integre position, vitesse, gravite, waypoints).
    virtual void update(float dt);

    /// Definit une destination directe (pas de pathfinding).
    void move_to(const glm::vec3& target);

    /// Definit un chemin de waypoints a suivre sequentiellement.
    void set_path(const std::vector<Waypoint>& path);

    /// Arrete le mouvement et vide le chemin.
    void stop();

    /// Retourne l'etat d'animation correspondant a la vitesse courante.
    [[nodiscard]] MoveAnimState compute_anim_state() const;

    /// Retourne true si le personnage a atteint sa destination.
    [[nodiscard]] bool has_reached_destination() const;

    // --- Donnees de mouvement ---
    glm::vec3 position_    = {0.f, 0.f, 0.f};
    glm::vec3 velocity_    = {0.f, 0.f, 0.f};
    glm::vec3 direction_   = {0.f, 0.f, 1.f};
    float     speed_       = 0.f;
    float     max_speed_   = 6.f;
    bool      is_grounded_ = true;
    bool      is_moving_   = false;

    // --- Parametres physiques ---
    CCharaActParam  act_param_;
    CCharaMoveParam move_param_;

    // --- Pathfinding ---
    std::vector<Waypoint> waypoints_;
    uint32_t              current_waypoint_ = 0;
    glm::vec3             target_position_  = {0.f, 0.f, 0.f};
    bool                  has_target_       = false;

    // --- Animation ---
    MoveAnimState anim_state_ = MoveAnimState::Idle;
};

/// Composant mouvement + animation — synchronise le deplacement
/// avec les animations du squelette (game::CCharaMoveNAnimComp).
struct CCharaMoveNAnimComp {
    virtual ~CCharaMoveNAnimComp() = default;

    virtual void update(float /*dt*/) {}

    uint32_t current_anim_id_ = 0;     // ID de l'animation courante
    float    anim_speed_      = 1.f;   // Multiplicateur de vitesse d'animation
    float    blend_weight_    = 1.f;   // Poids du blend avec l'animation precedente
    bool     root_motion_     = false; // Utiliser le root motion de l'animation
};

} // namespace game
