/// @file camera_ctrl_soccer_menu.cpp
/// Implementation de CCameraCtrlSoccerMenu — cadrage fixe avec
/// interpolation pour les menus in-match.

#include "iecode/game/camera/camera_ctrl_soccer_menu.h"

#include <cmath>

namespace game {

void CCameraCtrlSoccerMenu::set_menu_slot(uint32_t slot) {
    current_slot_ = slot;
    // Declenche l'interpolation de la base vers pos_target_.
    pos_start_  = {position_.x, position_.y, position_.z, 0.f};
    pos_target_ = {menu_position_.x, menu_position_.y, menu_position_.z, 0.f};
    set_fov_blend(menu_fov_);
}

void CCameraCtrlSoccerMenu::update(float dt) {
    if (dt <= 0.f) {
        return;
    }
    const float factor = 1.f - std::exp(-blend_speed_ * dt);

    position_ += (menu_position_ - position_) * factor;
    target_   += (menu_target_   - target_)   * factor;

    update_interp(dt);
}

} // namespace game
