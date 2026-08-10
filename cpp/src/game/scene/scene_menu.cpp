/// @file scene_menu.cpp
/// Implementation de CSceneMenu — scene des menus pilotes par Lua 5.2.
/// Phases : Main (0), Options (1), SaveLoad (2), Gallery (3).

#include "iecode/game/scene/scene_menu.h"

#include <spdlog/spdlog.h>

namespace game {

/// Phases internes du menu principal.
namespace menu_phase {
    inline constexpr uint32_t MAIN      = 0;
    inline constexpr uint32_t OPTIONS   = 1;
    inline constexpr uint32_t SAVE_LOAD = 2;
    inline constexpr uint32_t GALLERY   = 3;
} // namespace menu_phase

void CSceneMenu::on_enter() {
    active_ = true;
    elapsed_time_ = 0.f;
    active_menu_count_ = 0;
    set_phase(menu_phase::MAIN);
    spdlog::info("[CSceneMenu] Entree — chargement des menus Lua");
    // Dans nie.exe, charge les scripts via FUN_14103df90
    // (CRC32 lookup -> "common/script/lua/menu/%s.lua.bin").
    active_menu_count_ = 1; // Menu principal charge.
}

void CSceneMenu::on_update(float dt) {
    elapsed_time_ += dt;

    // Mise a jour des CLuaMenuObject actifs.
    // Dans nie.exe, itere sur la liste des menus Lua empiles.
    spdlog::trace("[CSceneMenu] Update phase={} menus_actifs={}",
                  phase_, active_menu_count_);
}

void CSceneMenu::on_draw() {
    // Rendu des menus via CMenuRender (1100 slots, stride 0x38).
    spdlog::trace("[CSceneMenu] Draw phase={}", phase_);
}

void CSceneMenu::on_exit() {
    active_ = false;
    active_menu_count_ = 0;
    spdlog::info("[CSceneMenu] Sortie — dechargement des menus Lua");
}

} // namespace game
