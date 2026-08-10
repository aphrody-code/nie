#pragma once

/// @file camera_ctrl_near_far.h
/// CCameraCtrlNearFar — camera de poursuite avec gestion explicite
/// des plans near/far dynamiques (interpolation vers des valeurs cibles).
///
/// Classe RTTI : game::CCameraCtrlNearFar.
/// Heritage : game::CCameraCtrlChaseBase.
/// Usage : zoom travelling, transitions cutscene ↔ gameplay.

#include "camera_ctrl_chase_base.h"

namespace game {

/// Camera gerant l'interpolation des plans de clipping near/far.
struct CCameraCtrlNearFar : CCameraCtrlChaseBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override {
        return "CCameraCtrlNearFar";
    }

    float near_target_ = 0.1f;
    float far_target_  = 10000.f;
    float blend_speed_ = 3.f;
};

} // namespace game
