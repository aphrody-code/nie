/// @file lua_menu_object.cpp
/// Implementation de CLuaMenuObject — objet menu Lua.
/// Chaque ecran du jeu est une instance de cette classe.
/// Loader principal : FUN_14103df90 (nie.c:3005061).
/// Bridge funcLua* : 15 fonctions enregistrees via lua_register (FUN_1405992e0).

#include "iecode/game/ui/lua_menu_object.h"

#include <spdlog/spdlog.h>
#include <fmt/format.h>

namespace game {

// ============================================================================
// CLuaMenuObject — Implementation
// ============================================================================
//
// CLuaMenuObject herite de CMenuController et contient un shared_ptr
// vers un CLuaScript. Il gere le cycle de vie d'un ecran de menu :
//
// 1. on_init() :
//    - Construit le chemin du script : fmt(SCRIPT_PATH_FMT, script_name_)
//    - Charge le script Lua depuis le VFS (XOR CRI 0x1717E18E + LZ10)
//    - Cree un sol::state et charge le script
//    - Enregistre les 15 fonctions bridge funcLua*
//    - Appelle la fonction Lua "onInit()" du script
//
// 2. on_update() :
//    - Appelle la fonction Lua "onUpdate()" du script chaque frame
//    - Le script Lua peut appeler les funcLua* pour modifier l'UI
//    - Les commandes sont dispatchees via dispatch_menu_command()
//
// 3. on_close() :
//    - Appelle la fonction Lua "onClose()" du script
//    - Libere le sol::state et les ressources associees
//
// Les 15 fonctions bridge funcLua* sont enregistrees dans le runtime
// Lua via FUN_1405992e0 dans nie.exe. Chaque fonction mappe un
// command ID numerique vers une action C++ du moteur.
//
// Bridge funcLua* (nie.exe) :
//   funcLuaMenuCommand       — FUN_140c39f90 — menus generaux
//   funcLuaMenuMapCommand    — FUN_1410357f0 — carte RPG
//   funcLuaMenuNetworkCommand — FUN_141088380 — reseau
//   funcLuaMenuMultiplayCommand — FUN_141091350 — multijoueur
//   funcLuaMenuVSRouteTownCommand — FUN_141116110 — VS Route
//   funcLuaActionCommand     — FUN_140b769a0 — actions scene
//   funcLuaEffectCommand     — FUN_140c39dc0 — effets
//   funcLuaCameraCommand     — FUN_140b799f0 — camera
//   funcLuaCommand           — FUN_140c34ec0 — generique
//   funcLuaMenuDictCommand   — FUN_140fc2530 — dictionnaire
//   funcLuaMenuMapTravelCommand — FUN_14103b990 — voyage
//   funcLuaMenuNfcCommand    — FUN_141097110 — NFC
//   funcLuaMenuPostCommand   — FUN_1410b8580 — posts
//   funcLuaMenuPostListCommand — FUN_1410b7ed0 — liste posts
//   funcLuaSpTacticsCommand  — FUN_140c97e00 — tactiques speciales
//
// TODO: port FUN_14103df90 — loader de script Lua menu
//   1. CRC32 lookup (FUN_1404d30c0) sur script_name_
//   2. snprintf(path, 0xff, "common/script/lua/menu/%s.lua.bin", name)
//   3. Ouvrir via VFS, dechiffrer XOR CRI, decompresser LZ10
//   4. Charger dans sol::state
//
// TODO: port FUN_1405992e0 — enregistrement des bridges funcLua*
//   Pour chaque bridge, appeler lua_register(L, name, c_func).
//   La c_func lit le premier argument (command ID) et dispatch.

} // namespace game
