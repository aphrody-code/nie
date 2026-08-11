#pragma once

/// @file scene_menu.h
/// CSceneMenu — scene des menus du jeu (pilotes par Lua 5.2).
/// Classe RTTI : game::CSceneMenu.

#include "scene_base.h"
#include "scene_manager.h"
#include <cstdint>

namespace game {

/// Scene des menus — conteneur pour le systeme de menus Lua.
/// Charge les scripts Lua via le loader FUN_14103df90 et
/// gere les CLuaMenuObject actifs.
class CSceneMenu : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_draw() override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::Menu; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneMenu"; }

    /// Nombre de menus Lua actuellement empiles.
    [[nodiscard]] uint32_t active_menu_count() const { return active_menu_count_; }

private:
    uint32_t active_menu_count_ = 0;
};

} // namespace game
