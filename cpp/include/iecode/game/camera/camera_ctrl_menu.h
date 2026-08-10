#pragma once

/// @file camera_ctrl_menu.h
/// CCameraCtrlMenu — camera pour les ecrans de menu.
/// CCameraCtrlSoccerMenu — camera pour le menu soccer.
/// Classes RTTI : game::CCameraCtrlMenu, game::CCameraCtrlSoccerMenu.

#include "camera_ctrl_base.h"

namespace game {

/// Camera de menu — angles fixes avec transitions douces.
struct CCameraCtrlMenu : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlMenu"; }

    float blend_speed_ = 3.f;   // Vitesse de transition entre positions
    bool  is_blending_ = false;

    glm::vec3 target_position_ = {0.f, 0.f, 0.f};
    glm::vec3 target_lookat_   = {0.f, 0.f, 0.f};
};

/// Camera du menu soccer — vue du terrain depuis les gradins.
struct CCameraCtrlSoccerMenu : CCameraCtrlMenu {
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlSoccerMenu"; }

    float field_overview_height_ = 20.f;
    float field_overview_angle_  = -45.f;
};

} // namespace game
