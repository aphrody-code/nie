#pragma once

/// @file camera_ctrl_soccer_menu.h
/// CCameraCtrlSoccerMenu — camera des menus in-match (pause, tactiques,
/// selection de joueur). Cadrage fixe avec interpolation vers un preset
/// defini par slot (0..N-1).
///
/// Classe RTTI : game::CCameraCtrlSoccerMenu.
/// Heritage : game::CCameraCtrlChaseBase.

#include "camera_ctrl_chase_base.h"

namespace game {

/// Camera des menus in-match (soccer).
struct CCameraCtrlSoccerMenu : CCameraCtrlChaseBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override {
        return "CCameraCtrlSoccerMenu";
    }

    /// Selectionne un preset de cadrage (0..N-1). Declenche une
    /// interpolation de la position et du FOV vers le preset.
    void set_menu_slot(uint32_t slot);

    uint32_t  current_slot_  = 0;
    glm::vec3 menu_position_ = {0.f, 5.f, -15.f};
    glm::vec3 menu_target_   = {0.f, 0.f, 0.f};
    float     menu_fov_      = 45.f;
    float     blend_speed_   = 8.f;
};

} // namespace game
