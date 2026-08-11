#pragma once

/// @file ball_move.h
/// IBallMoveController — interface de mouvement de balle.
/// BallMove* — implementations specifiques pour chaque type de mouvement.
/// Classes RTTI : game::IBallMoveController, game::BallMoveNormal,
///   game::BallMoveBezier, game::BallMoveMultiBezier, game::BallMoveDribble,
///   game::BallMoveGoalnet, game::BallMoveLerp, game::BallMoveRate,
///   game::BallMoveRealSkillShootBezier, game::BallMoveSimpleParabora,
///   game::BallMoveTargetFollow.

#include <glm/vec3.hpp>
#include <cstdint>

namespace game {

/// Interface de controleur de mouvement de balle.
struct IBallMoveController {
    virtual ~IBallMoveController() = default;

    /// Met a jour la position de la balle.
    virtual void update(float dt) = 0;

    /// Indique si le mouvement est termine.
    [[nodiscard]] virtual bool is_finished() const = 0;

    /// Position courante de la balle.
    glm::vec3 position_ = {0.f, 0.f, 0.f};
    glm::vec3 velocity_ = {0.f, 0.f, 0.f};
    float     elapsed_  = 0.f;
};

/// Mouvement normal — physique simple (gravite + friction).
struct BallMoveNormal : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    float friction_    = 0.98f;
    float bounce_      = 0.6f;
    float gravity_     = 2.0f;   // BALL_GRAVITY
};

/// Mouvement courbe de Bezier — trajectoire lissee pour les passes et tirs.
struct BallMoveBezier : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    glm::vec3 start_     = {0.f, 0.f, 0.f};
    glm::vec3 control_   = {0.f, 0.f, 0.f};   // Point de controle
    glm::vec3 end_       = {0.f, 0.f, 0.f};
    float     duration_  = 1.f;
};

/// Mouvement multi-Bezier — sequence de courbes de Bezier.
struct BallMoveMultiBezier : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    uint32_t segment_count_   = 0;
    uint32_t current_segment_ = 0;
    float    segment_time_    = 0.f;
};

/// Mouvement dribble — suit le joueur avec un leger decalage.
struct BallMoveDribble : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    glm::vec3 owner_position_ = {0.f, 0.f, 0.f};
    float     offset_dist_    = 0.5f;   // Distance devant le joueur
    float     height_         = 0.1f;   // Hauteur de la balle
};

/// Mouvement filet de but — la balle entre dans le filet et rebondit.
struct BallMoveGoalnet : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    glm::vec3 entry_point_ = {0.f, 0.f, 0.f};
    glm::vec3 net_center_  = {0.f, 0.f, 0.f};
    float     deceleration_ = 5.f;
};

/// Mouvement lineaire interpole (lerp).
struct BallMoveLerp : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    glm::vec3 start_    = {0.f, 0.f, 0.f};
    glm::vec3 end_      = {0.f, 0.f, 0.f};
    float     duration_ = 1.f;
};

/// Mouvement proportionnel (rate-based) — vitesse constante.
struct BallMoveRate : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    glm::vec3 direction_ = {0.f, 0.f, 1.f};
    float     speed_     = 10.f;
    float     max_time_  = 3.f;
};

/// Mouvement Bezier pour les tirs speciaux (hissatsu de tir).
struct BallMoveRealSkillShootBezier : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    glm::vec3 start_    = {0.f, 0.f, 0.f};
    glm::vec3 control1_ = {0.f, 0.f, 0.f};
    glm::vec3 control2_ = {0.f, 0.f, 0.f};
    glm::vec3 end_      = {0.f, 0.f, 0.f};
    float     duration_ = 1.5f;
    uint32_t  skill_id_ = 0;
};

/// Mouvement parabolique simple — trajectoire en arc.
struct BallMoveSimpleParabora : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    glm::vec3 start_     = {0.f, 0.f, 0.f};
    glm::vec3 end_       = {0.f, 0.f, 0.f};
    float     height_    = 5.f;     // Hauteur maximale de l'arc
    float     duration_  = 1.f;
};

/// Mouvement de suivi de cible — la balle suit une cible mobile.
struct BallMoveTargetFollow : IBallMoveController {
    void update(float dt) override;
    [[nodiscard]] bool is_finished() const override;

    glm::vec3 target_pos_  = {0.f, 0.f, 0.f};
    float     follow_speed_ = 15.f;
    float     arrive_dist_  = 0.3f;   // Distance d'arrivee
};

} // namespace game
