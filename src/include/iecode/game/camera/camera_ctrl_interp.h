#pragma once

/// @file camera_ctrl_interp.h
/// CCameraCtrlInterPolate — interpolation entre deux cameras.
/// Classe RTTI : game::CCameraCtrlInterPolate.
///
/// Note : CCameraCtrlOffset et CCameraCtrlNearFar ont ete deplaces dans
/// leurs propres headers (camera_ctrl_offset.h, camera_ctrl_near_far.h)
/// et heritent desormais de CCameraCtrlChaseBase.

#include "camera_ctrl_base.h"

namespace game {

/// Camera d'interpolation — blend entre deux controleurs de camera.
struct CCameraCtrlInterPolate : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlInterPolate"; }

    float blend_weight_ = 0.f;   // 0.0 = camera A, 1.0 = camera B
    float blend_speed_  = 1.f;   // Vitesse de transition

    CCameraCtrlBase* camera_a_ = nullptr;
    CCameraCtrlBase* camera_b_ = nullptr;
};

} // namespace game
