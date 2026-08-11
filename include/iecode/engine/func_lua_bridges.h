#pragma once

/// @file func_lua_bridges.h
/// Enregistrement des 15 fonctions bridge funcLua* dans un etat sol2.
/// Ces fonctions sont le pont entre les scripts Lua 5.2 du jeu et le moteur C++.
/// Dans nie.exe, elles sont enregistrees via lua_register (FUN_1405992e0).
/// Adresses : voir iecode::game::addr dans game_constants.h.

#include <sol/sol.hpp>

#include <cstdint>
#include <functional>
#include <string>
#include <tuple>

namespace iecode::engine {

/// Hooks injectables par la couche game:: (rompt la dependance circulaire
/// engine -> game). Chaque champ est un std::function nullable. Si non
/// enregistre, le handler retombe sur un comportement par defaut + warning.
struct LuaGameHooks {
    /// Charge une scene par nom (ex: "TitleScene"). Appelle game::CSceneManager.
    std::function<void(const std::string& scene_name)> load_scene;

    /// Lit une stat numerique d'un joueur (ex: "kick", "speed", "stamina").
    /// Retourne 0 si la stat est inconnue.
    std::function<double(uint32_t player_id, const std::string& stat_name)> get_player_stat;

    /// Modifie une stat numerique d'un joueur. No-op si la stat n'existe pas.
    std::function<void(uint32_t player_id, const std::string& stat_name, double value)>
        set_player_stat;

    /// Map: ajoute un marqueur a une position (x, z) avec une icone.
    std::function<void(float x, float z, int32_t icon_id)> map_set_marker;

    /// Map: vide tous les marqueurs courants.
    std::function<void()> map_clear_markers;

    /// Map: retourne la position monde courante du joueur.
    std::function<std::tuple<float, float, float>()> map_get_player_pos;
};

/// Acces au registre global des hooks (a remplir au demarrage par iecode_game).
[[nodiscard]] LuaGameHooks& lua_game_hooks() noexcept;

/// Enregistre les 15 fonctions bridge funcLua* dans l'etat Lua sol2.
///
/// Chaque bridge suit le pattern (int cmd, sol::variadic_args va) -> sol::object.
/// Le premier argument `cmd` est un ID de sous-commande qui dispatche vers la
/// logique C++ appropriee (layout, texte, texture, liste, animation, son, etc.).
///
/// Fonctions enregistrees :
/// - funcLuaMenuCommand       — menus generaux (~200 sous-commandes)
/// - funcLuaMenuMapCommand    — carte RPG
/// - funcLuaMenuNetworkCommand   — reseau
/// - funcLuaMenuMultiplayCommand — multijoueur
/// - funcLuaMenuVSRouteTownCommand — VS Route
/// - funcLuaActionCommand     — actions scene
/// - funcLuaEffectCommand     — effets visuels
/// - funcLuaCameraCommand     — camera
/// - funcLuaCommand           — commande generique
/// - funcLuaMenuDictCommand   — dictionnaire
/// - funcLuaMenuMapTravelCommand — voyage rapide
/// - funcLuaMenuNfcCommand    — NFC
/// - funcLuaMenuPostCommand   — posts
/// - funcLuaMenuPostListCommand — liste de posts
/// - funcLuaSpTacticsCommand  — tactiques speciales
void register_func_lua_bridges(sol::state& lua);

} // namespace iecode::engine
