#pragma once

/// @file soccer_player_component.h
/// SoccerPlayerComponent — composant joueur de foot dans une scene match.
/// S'integre au Scene ECS via ComponentKind::SOCCER_PLAYER.

#include "iecode/engine/ecs/component.h"
#include "iecode/game/soccer/ball_component.h"

#include <glm/vec3.hpp>
#include <cstdint>
#include <string_view>

namespace game {

/// Composant joueur de foot — position, vitesse, stats et FSM courte.
struct SoccerPlayerComponent : lives::ecs::Component {
    /// Etat haut-niveau du joueur (FSM).
    enum class State : uint8_t {
        IDLE      = 0,
        RUNNING   = 1,
        DRIBBLING = 2,
        SHOOTING  = 3,
        TACKLING  = 4,
    };

    uint32_t  player_id_  = 0;
    uint32_t  team_id_    = 0;        ///< 0 = home, 1 = away
    glm::vec3 position_   = {0.f, 0.f, 0.f};
    glm::vec3 velocity_   = {0.f, 0.f, 0.f};
    float     speed_base_ = 70.0f;    ///< stat de vitesse de base
    float     stamina_    = 100.0f;
    bool      has_ball_   = false;
    State     state_      = State::IDLE;

    /// Met a jour la cinematique (position += velocity * dt) et les stats.
    void update(float dt);

    /// Deplace le joueur vers une cible avec une vitesse donnee (m/s).
    void move_toward(glm::vec3 target, float speed);

    /// Envoie la balle dans une direction avec une puissance donnee.
    /// Met has_ball_ a false et applique l'impulsion sur la balle.
    void kick_ball(BallComponent& ball, glm::vec3 direction, float power);

    // ── Component overrides ──────────────────────────────────────────

    void on_update(float dt) override { update(dt); }

    [[nodiscard]] lives::ecs::ComponentKind component_kind() const noexcept override {
        return lives::ecs::ComponentKind::SOCCER_PLAYER;
    }

    [[nodiscard]] std::string_view component_name() const override {
        return "SoccerPlayerComponent";
    }
};

} // namespace game
