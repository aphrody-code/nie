#pragma once

/// @file camera_ctrl_fps.h
/// CCameraCtrlFps — camera premiere personne.
/// Classe RTTI : game::CCameraCtrlFps.

#include "camera_ctrl_base.h"

namespace game {

/// Camera premiere personne — attachee a la tete du personnage.
struct CCameraCtrlFps : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlFps"; }

    float yaw_           = 0.f;
    float pitch_         = 0.f;
    float sensitivity_   = 1.f;
    float head_height_   = 1.7f;  // Hauteur de la camera par rapport aux pieds
};

} // namespace game
