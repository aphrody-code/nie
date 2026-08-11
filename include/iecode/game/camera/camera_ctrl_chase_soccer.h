#pragma once

/// @file camera_ctrl_chase_soccer.h
/// CCameraCtrlChaseSoccer — camera de poursuite specialisee soccer.
/// Suit le ballon avec un zoom adaptatif selon sa position sur le terrain.
///
/// Classe RTTI : game::CCameraCtrlChaseSoccer.
/// Heritage : game::CCameraCtrlChaseBase.

#include "camera_ctrl_chase_base.h"

namespace game {

/// Camera de poursuite soccer — suit le ballon et l'action sur le terrain.
/// Ajuste automatiquement l'angle et le zoom selon la position du ballon.
struct CCameraCtrlChaseSoccer : CCameraCtrlChaseBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override {
        return "CCameraCtrlChaseSoccer";
    }

    glm::vec3 ball_position_ = {0.f, 0.f, 0.f};
    float     field_width_   = 105.f;  // Largeur du terrain (metres)
    float     field_height_  = 68.f;   // Longueur du terrain (metres)
    float     zoom_factor_   = 1.f;
};

} // namespace game
