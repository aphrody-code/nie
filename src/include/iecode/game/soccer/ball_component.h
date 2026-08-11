#pragma once

/// @file ball_component.h
/// BallComponent — composant balle du moteur soccer.
/// Classe RTTI : game::BallComponent.
/// Decompile dans ball_component.c.

#include <glm/vec3.hpp>
#include <cstdint>

namespace game {

/// Gravite de la balle (constante du jeu).
inline constexpr float BALL_GRAVITY = 2.0f;

/// Valeur de slot de possession vide.
inline constexpr uint8_t BALL_POSSESSION_EMPTY = 0xFF;

/// Nombre de slots de possession.
inline constexpr uint32_t BALL_POSSESSION_SLOTS = 3;

/// ID de cible invalide.
inline constexpr uint32_t BALL_INVALID_TARGET = 0xFFFF0000;

/// Types de mouvement de la balle (10 types identifies).
enum class BallMoveType : uint8_t {
    Normal              = 0,
    Bezier              = 1,
    Parabola            = 2,
    Dribble             = 3,
    RealSkillShootBezier = 4,
    MultiBezier         = 5,
    Goalnet             = 6,
    Lerp                = 7,
    Rate                = 8,
    TargetFollow        = 9,
};

/// Composant balle — position, vitesse, possession.
struct BallComponent {
    glm::vec3 position_  = {0.f, 0.f, 0.f};
    glm::vec3 velocity_  = {0.f, 0.f, 0.f};
    glm::vec3 spin_      = {0.f, 0.f, 0.f};   // Rotation angulaire

    /// ID du personnage qui possede la balle (BALL_INVALID_TARGET si libre).
    uint32_t owner_chara_id_ = BALL_INVALID_TARGET;

    /// Type de mouvement actif.
    BallMoveType move_type_ = BallMoveType::Normal;

    /// Slots de possession (historique des 3 derniers possesseurs).
    uint8_t possession_slots_[BALL_POSSESSION_SLOTS] = {
        BALL_POSSESSION_EMPTY, BALL_POSSESSION_EMPTY, BALL_POSSESSION_EMPTY
    };

    /// Puissance de tir courante.
    float shot_power_ = 0.f;

    /// Direction de tir courante.
    glm::vec3 shot_direction_ = {0.f, 0.f, 0.f};

    /// Rayon de la balle (pour les collisions).
    float radius_ = 0.11f;

    /// Coefficient de friction au sol.
    float ground_friction_ = 0.98f;

    /// Coefficient de rebond.
    float bounce_factor_ = 0.6f;

    /// Indique si la balle est en l'air.
    [[nodiscard]] bool is_airborne() const { return position_.y > radius_; }

    /// Indique si la balle est possedee par un joueur.
    [[nodiscard]] bool is_owned() const { return owner_chara_id_ != BALL_INVALID_TARGET; }

    /// Met a jour la physique de la balle (gravite, friction, rebond).
    void update_physics(float dt);

    /// Transfere la possession a un nouveau joueur.
    void set_owner(uint32_t chara_id);

    /// Libere la balle (plus de possesseur).
    void release();

    /// Applique une impulsion a la balle (tir, passe).
    void apply_impulse(const glm::vec3& impulse);

    /// Remet la balle a une position avec vitesse nulle.
    void reset_at(const glm::vec3& pos);
};

} // namespace game
