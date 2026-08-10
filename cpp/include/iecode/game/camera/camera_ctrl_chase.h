#pragma once

/// @file camera_ctrl_chase.h
/// CCameraCtrlChase — camera de poursuite generique (RPG/exploration).
/// Classe RTTI : game::CCameraCtrlChase.
///
/// Pour CCameraCtrlChaseSoccer voir camera_ctrl_chase_soccer.h.

#include "camera_ctrl_chase_base.h"

namespace game {

/// Camera de poursuite generique — suit un personnage en RPG/exploration.
struct CCameraCtrlChase : CCameraCtrlChaseBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlChase"; }

    glm::vec3 chase_target_pos_ = {0.f, 0.f, 0.f};
    float     min_distance_     = 3.f;
    float     max_distance_     = 20.f;
};

} // namespace game
