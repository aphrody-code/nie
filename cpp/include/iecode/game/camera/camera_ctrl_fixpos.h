#pragma once

/// @file camera_ctrl_fixpos.h
/// CCameraCtrlFixPos — camera a position fixe.
/// Classe RTTI : game::CCameraCtrlFixPos.

#include "camera_ctrl_base.h"

namespace game {

/// Camera a position fixe — reste a un point donne, regarde la cible.
struct CCameraCtrlFixPos : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlFixPos"; }

    glm::vec3 fixed_position_  = {0.f, 5.f, -10.f};
    bool      track_target_    = true;  // Suivre la cible en rotation
};

} // namespace game
