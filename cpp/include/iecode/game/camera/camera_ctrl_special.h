#pragma once

/// @file camera_ctrl_special.h
/// CCameraCtrlSpecialAttack — camera pour les hissatsu (attaques speciales).
/// CCameraCtrlShooting — camera pour les tirs au but.
/// Classes RTTI : game::CCameraCtrlSpecialAttack, game::CCameraCtrlShooting.

#include "camera_ctrl_base.h"
#include <cstdint>

namespace game {

/// Camera d'attaque speciale — cinematique des hissatsu.
/// Angles et mouvements pre-calcules par le systeme d'animation.
struct CCameraCtrlSpecialAttack : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlSpecialAttack"; }

    uint32_t skill_id_        = 0;      // ID du hissatsu
    float    sequence_time_   = 0.f;    // Temps dans la sequence
    float    sequence_length_ = 0.f;    // Duree totale de la cinematique
    bool     is_playing_      = false;
};

/// Camera de tir — suit la trajectoire du ballon vers les buts.
struct CCameraCtrlShooting : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlShooting"; }

    glm::vec3 ball_pos_     = {0.f, 0.f, 0.f};
    glm::vec3 goal_pos_     = {0.f, 0.f, 0.f};
    float     speed_factor_ = 1.f;
    bool      slow_motion_  = false;
};

} // namespace game
