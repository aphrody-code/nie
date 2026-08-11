#pragma once

/// @file lua_bindings.h
/// Couche de binding sol2 pour le moteur Level-5 (lives::).
/// Enregistre tous les types engine comme usertypes Lua,
/// repliquant le bridge funcLua* de nie.exe.

#include <sol/sol.hpp>

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace iecode::engine {

/// Enregistre tous les types lives:: dans un sol::state.
/// Usertypes : CObject, CMenuObject, CMenuRender, CMenuListView,
/// CMenuLayerGroup, CMenuLayerObject, CMenuAnimation, CMenuSimpleAnimation,
/// CMenuRateAnimeCtrl, CMenuRateAnimeCompetitionCtrl, CCamera,
/// CCameraAnimeCtrl, CPad, CPadArray, CLuaScript, CResBase, etc.
/// Enums : DrawPass, PadButton, ComponentType, ResState.
void register_lua_bindings(sol::state& lua);

/// Dechiffre (XOR CRI 0x1717E18E) + decompresse (LZ10) un script .lua.bin.
/// Retourne le source Lua en clair, ou une chaine vide en cas d'erreur.
[[nodiscard]] std::string load_lua_script(const std::vector<uint8_t>& encrypted_data);

/// Charge un script menu par nom dans un sol::state.
/// Chemin : {data_root}/common/script/lua/menu/{name}.lua.bin
/// Retourne false si le fichier n'existe pas ou si le dechiffrement echoue.
[[nodiscard]] bool load_menu_script(sol::state& lua, const std::string& name,
                                    const std::filesystem::path& data_root);

/// Initialise un sol::state avec les libs standard Lua 5.2 + tous les bindings engine.
void init_lua_state(sol::state& lua);

} // namespace iecode::engine
