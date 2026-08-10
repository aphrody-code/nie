#pragma once

/// @file lua_menu_object.h
/// Objet menu Lua (game::CLuaMenuObject) — wraps un script Lua menu.
/// Chaque ecran du jeu est une instance de cette classe.
/// Loader principal : FUN_14103df90 (nie.c:3005061).
/// Bridge funcLua* : 15 fonctions enregistrees via lua_register (FUN_1405992e0).

#include "menu_controller.h"
#include "../../engine/scripting/lua_script.h"
#include <memory>
#include <array>
#include <string>
#include <string_view>

namespace game {

/// Objet menu Lua (game::CLuaMenuObject).
struct CLuaMenuObject : CMenuController {
    std::shared_ptr<lives::CLuaScript> script_;
    std::string                        script_name_;
    bool                               is_initialized_ = false;

    /// Noms des 15 fonctions bridge Lua <-> C++.
    static constexpr std::array<std::string_view, 15> FUNC_LUA_NAMES = {
        "funcLuaMenuCommand",
        "funcLuaMenuMapCommand",
        "funcLuaMenuNetworkCommand",
        "funcLuaMenuMultiplayCommand",
        "funcLuaMenuVSRouteTownCommand",
        "funcLuaActionCommand",
        "funcLuaEffectCommand",
        "funcLuaCameraCommand",
        "funcLuaCommand",
        "funcLuaMenuDictCommand",
        "funcLuaMenuMapTravelCommand",
        "funcLuaMenuNfcCommand",
        "funcLuaMenuPostCommand",
        "funcLuaMenuPostListCommand",
        "funcLuaSpTacticsCommand",
    };

    /// Chemin du script Lua : common/script/lua/menu/%s.lua.bin
    static constexpr std::string_view SCRIPT_PATH_FMT = "common/script/lua/menu/{}.lua.bin";

    void on_init()   override {}
    void on_update() override {}
    void on_close()  override {}
};

} // namespace game
