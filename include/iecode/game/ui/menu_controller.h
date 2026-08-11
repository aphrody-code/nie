#pragma once

/// @file menu_controller.h
/// Controleurs de menu principaux — CMenuController, CMenuStateMachine, popups.
/// game::CMenuController enregistre PrepareDrawPreModelUpd — FUN_141042be0.

#include "../../engine/menu/menu_object.h"
#include "../game_fwd.h"
#include <string_view>
#include <cstdint>

namespace game {

/// Controleur de menu principal (game::CMenuController).
struct CMenuController : lives::IMenuController {
    lives::hash32 menu_id_;
    bool          is_active_ = false;
    bool          is_paused_ = false;

    void on_init()   override {}
    void on_update() override {}
    void on_draw()   override {}
    void on_close()  override {}
};

/// Machine a etats menus (game::CMenuStateMachine).
struct CMenuStateMachine {
    uint32_t state_       = 0;
    uint32_t prev_state_  = 0;
    float    state_timer_ = 0.f;

    void transition(uint32_t next_state) {
        prev_state_ = state_;
        state_      = next_state;
        state_timer_ = 0.f;
    }
};

/// Fenetre popup (game::CMenuPopup).
struct CMenuPopup : CMenuController {
    std::string_view title_key_;
    std::string_view message_key_;
    uint8_t          button_count_ = 2;
};

/// Chargement (game::CMenuLoading).
struct CMenuLoading : CMenuController {
    float progress_  = 0.f;
    bool  show_tips_ = true;
};

/// Icone de sauvegarde (game::CMenuSavingIcon).
struct CMenuSavingIcon : CMenuController {
    float anim_timer_ = 0.f;
};

} // namespace game
