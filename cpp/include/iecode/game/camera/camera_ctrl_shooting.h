#pragma once

/// @file camera_ctrl_shooting.h
/// CCameraCtrlShooting — camera de tir specialisee soccer.
/// Cadrage automatique lors d'un tir au but : suit le ballon et
/// oriente la camera vers la cage adverse.
///
/// Classe RTTI : game::CCameraCtrlShooting.
/// Heritage : game::CCameraCtrlChaseBase.

#include "camera_ctrl_chase_base.h"

namespace game {

/// Camera de tir — cadre le ballon et la cage adverse pendant un shoot.
struct CCameraCtrlShooting : CCameraCtrlChaseBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override {
        return "CCameraCtrlShooting";
    }

    glm::vec3 shooter_pos_ = {0.f, 0.f, 0.f};
    glm::vec3 goal_pos_    = {0.f, 0.f, 0.f};
    float     shot_fov_    = 35.f;   // FOV serre pendant l'animation de tir
    float     back_offset_ = 4.f;    // Distance derriere le tireur
    float     height_off_  = 2.f;    // Hauteur au-dessus du tireur
};

} // namespace game
