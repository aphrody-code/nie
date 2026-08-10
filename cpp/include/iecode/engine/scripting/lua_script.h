#pragma once

/// @file lua_script.h
/// Script Lua du moteur Level-5 (lives::CLuaScript).
/// Runtime Lua 5.2.1 integre dans nie.exe.
/// Chemin format : common/script/lua/menu/%s.lua.bin
/// Chiffrement : XOR CRI 0x1717E18E + LZ10 — dechiffrer avant parse.
///
/// Layout binaire confirme (analyse nie.c) :
///   +0x00  vftable*
///   +0x08  lua_State*     (runtime Lua 5.2.1)
///   +0x10  CResLua*       (resource encapsulant le bytecode)
///
/// Note : les 15 funcLua* (funcLuaMenuCommand, funcLuaMenuMapCommand, etc.)
/// sont des fonctions globales enregistrees via FUN_1405992e0, PAS des
/// methodes de CLuaScript.

#include "../res/res_base.h"
#include <cstdint>
#include <string>
#include <string_view>

// Forward declaration — evite d'inclure <lua.h> ici.
struct lua_State;

namespace lives {

struct CResLua;  // resource bytecode Lua (forward)

/// Script Lua charge depuis le VFS (lives::CLuaScript).
/// Loader nie.exe : FUN_14103df90 (CRC32 lookup -> path format).
struct CLuaScript : CResBase {
    lua_State* lua_state_ = nullptr;  ///< +0x08 — runtime Lua 5.2.1
    CResLua*   res_lua_   = nullptr;  ///< +0x10 — resource bytecode

    // Donnees internes iecode (hors layout nie.exe).
    std::string script_name_;
    bool        is_menu_script_ = false;

    /// Format du chemin VFS pour les scripts menu.
    static constexpr std::string_view PATH_FORMAT = "common/script/lua/menu/%s.lua.bin";

    /// Cle XOR CRI pour le dechiffrement des scripts.
    static constexpr uint32_t CRI_XOR_KEY = 0x1717E18EU;

    [[nodiscard]] std::string_view res_type_name() const override { return "CLuaScript"; }
    [[nodiscard]] std::string_view get_class_name() const override { return "CLuaScript"; }
};

} // namespace lives
