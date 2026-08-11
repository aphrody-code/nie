/// @file func_lua_bridges.cpp
/// Implementation des 15 fonctions bridge funcLua* pour le runtime Lua 5.2.
///
/// Chaque bridge dispatche via une table de hash CRC32 (poly 0xEDB88320) du
/// nom de la sous-commande, exactement comme nie.exe. Dans le binaire, les
/// tables de commandes (ex. VA 0x141a5c630 pour funcLuaMenuCommand, 1026
/// entrees) sont des paires {hash, handler_ptr} cherchees par dichotomie.
///
/// Ici, on utilise std::unordered_map<uint32_t, LuaHandler> initialisee une
/// seule fois au startup via register_handlers(), puis lookup O(1) par hash.
///
/// Correspondance nie.exe (v5.00.24.00, base 0x140000000) :
///   funcLuaMenuCommand            -> FUN_140c39f90  (table @ 0x141a5c630)
///   funcLuaMenuMapCommand         -> FUN_1410357f0
///   funcLuaMenuNetworkCommand     -> FUN_141088380
///   funcLuaMenuMultiplayCommand   -> FUN_141091350
///   funcLuaMenuVSRouteTownCommand -> FUN_141116110
///   funcLuaActionCommand          -> FUN_140b769a0
///   funcLuaEffectCommand          -> FUN_140c39dc0
///   funcLuaCameraCommand          -> FUN_140b799f0
///   funcLuaCommand                -> FUN_140c34ec0
///   funcLuaMenuDictCommand        -> FUN_140fc2530
///   funcLuaMenuMapTravelCommand   -> FUN_14103b990
///   funcLuaMenuNfcCommand         -> FUN_141097110
///   funcLuaMenuPostCommand        -> FUN_1410b8580
///   funcLuaMenuPostListCommand    -> FUN_1410b7ed0
///   funcLuaSpTacticsCommand       -> FUN_140c97e00

#include <iecode/crypto/crc32.h>
#include <iecode/engine/core/service_locator.h>
#include <iecode/engine/ecs/scene.h>
#include <iecode/engine/func_lua_bridges.h>
#include <iecode/engine/sound/cri_sound_controller.h>

#include <spdlog/spdlog.h>

#include <functional>
#include <mutex>
#include <string_view>
#include <unordered_map>

namespace iecode::engine {

// ============================================================================
// Registre des hooks game::
// ============================================================================

LuaGameHooks& lua_game_hooks() noexcept {
    static LuaGameHooks hooks;
    return hooks;
}

// ============================================================================
// Helpers internes
// ============================================================================

namespace {

/// Signature uniforme des handlers de sous-commandes Lua.
using LuaHandler = std::function<sol::object(sol::this_state, sol::variadic_args)>;

/// Table de dispatch par hash CRC32 du nom de commande.
using HandlerMap = std::unordered_map<uint32_t, LuaHandler>;

/// Hash CRC32 d'une chaine litterale (compatible nie.exe, poly 0xEDB88320).
[[nodiscard]] inline uint32_t cmd_hash(std::string_view name) {
    return crypto::crc32_compute(name);
}

/// Extrait un argument depuis sol::variadic_args a l'index donne.
template <typename T>
[[nodiscard]] T get_arg(const sol::variadic_args& va, std::size_t index, T default_val = {}) {
    if (index < va.size()) {
        auto obj = va[index];
        if (obj.is<T>()) {
            return obj.as<T>();
        }
    }
    return default_val;
}

/// Dispatch generique : cherche cmd_id dans la map et appelle le handler.
/// Logge un warning si le hash est inconnu.
sol::object dispatch(std::string_view bridge_name, const HandlerMap& handlers,
                     sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    if (auto it = handlers.find(cmd_id); it != handlers.end()) {
        return it->second(ts, va);
    }
    spdlog::warn("{}: cmd_id 0x{:08x} inconnu ({} args)", bridge_name, cmd_id, va.size());
    return sol::make_object(sol::state_view(ts), sol::nil);
}

// ============================================================================
// Tables de handlers (une par bridge)
// ============================================================================

HandlerMap s_menu_handlers;
HandlerMap s_camera_handlers;
HandlerMap s_action_handlers;
HandlerMap s_effect_handlers;
HandlerMap s_command_handlers;
HandlerMap s_sp_tactics_handlers;
HandlerMap s_menu_map_handlers;
HandlerMap s_menu_network_handlers;
HandlerMap s_menu_multiplay_handlers;
HandlerMap s_menu_vs_route_handlers;
HandlerMap s_menu_dict_handlers;
HandlerMap s_menu_map_travel_handlers;
HandlerMap s_menu_nfc_handlers;
HandlerMap s_menu_post_handlers;
HandlerMap s_menu_post_list_handlers;

std::once_flag s_init_flag;

/// Macro utilitaire : enregistre un handler par nom de commande.
/// Le nom est hashe avec CRC32 (meme algo que nie.exe).
#define REG(MAP, NAME, LAMBDA) (MAP)[cmd_hash(NAME)] = (LAMBDA)

// ----------------------------------------------------------------------------
// funcLuaMenuCommand — menus generaux
// ----------------------------------------------------------------------------
void register_menu_handlers() {
    auto& m = s_menu_handlers;

    // Layout & positionnement
    REG(m, "SET_POSITION", [](sol::this_state ts, sol::variadic_args va) {
        // Forme etendue : SET_POSITION(actor_id, x, y, z)
        // Forme legacy   : SET_POSITION(x, y) — applique sur le menu courant.
        if (va.size() >= 4) {
            const auto actor_id = static_cast<uint32_t>(get_arg<int>(va, 0));
            const auto x = get_arg<float>(va, 1);
            const auto y = get_arg<float>(va, 2);
            const auto z = get_arg<float>(va, 3);
            if (auto* scene = lives::ServiceLocator::try_get<lives::ecs::Scene>()) {
                if (auto* actor = scene->find_actor(actor_id)) {
                    actor->transform().position = glm::vec3(x, y, z);
                    spdlog::debug("funcLuaMenuCommand: SET_POSITION({}, {}, {}, {}) -> actor='{}'",
                                  actor_id, x, y, z, actor->name());
                    return sol::make_object(sol::state_view(ts), sol::nil);
                }
                spdlog::warn("funcLuaMenuCommand: SET_POSITION actor_id 0x{:08x} introuvable", actor_id);
            }
            return sol::make_object(sol::state_view(ts), sol::nil);
        }
        auto x = get_arg<float>(va, 0);
        auto y = get_arg<float>(va, 1);
        spdlog::debug("funcLuaMenuCommand: SET_POSITION({}, {}) [legacy]", x, y);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_SIZE", [](sol::this_state ts, sol::variadic_args va) {
        auto w = get_arg<float>(va, 0);
        auto h = get_arg<float>(va, 1);
        spdlog::debug("funcLuaMenuCommand: SET_SIZE({}, {})", w, h);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_VISIBLE", [](sol::this_state ts, sol::variadic_args va) {
        // Forme etendue : SET_VISIBLE(actor_id, bool)
        // Forme legacy   : SET_VISIBLE(bool)
        if (va.size() >= 2) {
            const auto actor_id = static_cast<uint32_t>(get_arg<int>(va, 0));
            const bool visible  = get_arg<bool>(va, 1);
            if (auto* scene = lives::ServiceLocator::try_get<lives::ecs::Scene>()) {
                if (auto* actor = scene->find_actor(actor_id)) {
                    actor->set_active(visible);
                    spdlog::debug("funcLuaMenuCommand: SET_VISIBLE({}, {}) -> actor='{}'",
                                  actor_id, visible, actor->name());
                    return sol::make_object(sol::state_view(ts), sol::nil);
                }
                spdlog::warn("funcLuaMenuCommand: SET_VISIBLE actor_id 0x{:08x} introuvable", actor_id);
            }
            return sol::make_object(sol::state_view(ts), sol::nil);
        }
        spdlog::debug("funcLuaMenuCommand: SET_VISIBLE({}) [legacy]", get_arg<bool>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_ACTIVE", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_ACTIVE({})", get_arg<bool>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_SCALE", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_SCALE({})", get_arg<float>(va, 0, 1.f));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_ROTATION", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_ROTATION({})", get_arg<float>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_ALPHA", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_ALPHA({})", get_arg<float>(va, 0, 1.f));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_COLOR", [](sol::this_state ts, sol::variadic_args va) {
        auto r = get_arg<int>(va, 0, 255);
        auto g = get_arg<int>(va, 1, 255);
        auto b = get_arg<int>(va, 2, 255);
        auto a = get_arg<int>(va, 3, 255);
        spdlog::debug("funcLuaMenuCommand: SET_COLOR({}, {}, {}, {})", r, g, b, a);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Texte
    REG(m, "SET_TEXT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_TEXT(\"{}\")", get_arg<std::string>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_TEXT_COLOR", [](sol::this_state ts, sol::variadic_args va) {
        auto r = get_arg<int>(va, 0, 255);
        auto g = get_arg<int>(va, 1, 255);
        auto b = get_arg<int>(va, 2, 255);
        auto a = get_arg<int>(va, 3, 255);
        spdlog::debug("funcLuaMenuCommand: SET_TEXT_COLOR({}, {}, {}, {})", r, g, b, a);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_FONT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_FONT({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_TEXT_ALIGN", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_TEXT_ALIGN({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Texture / Image
    REG(m, "LOAD_TEXTURE", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: LOAD_TEXTURE(\"{}\")", get_arg<std::string>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_UV", [](sol::this_state ts, sol::variadic_args va) {
        auto u0 = get_arg<float>(va, 0);
        auto v0 = get_arg<float>(va, 1);
        auto u1 = get_arg<float>(va, 2, 1.f);
        auto v1 = get_arg<float>(va, 3, 1.f);
        spdlog::debug("funcLuaMenuCommand: SET_UV({}, {}, {}, {})", u0, v0, u1, v1);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_TEXTURE_INDEX", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_TEXTURE_INDEX({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // ListView
    REG(m, "LIST_SET_COUNT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: LIST_SET_COUNT({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "LIST_GET_SELECTED", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuCommand: LIST_GET_SELECTED");
        return sol::make_object(sol::state_view(ts), -1);
    });
    REG(m, "LIST_SCROLL_TO", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: LIST_SCROLL_TO({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "LIST_SET_CURSOR", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: LIST_SET_CURSOR({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Animation — PLAY_ANIMATION(actor_id, clip_name) / STOP_ANIMATION(actor_id)
    REG(m, "PLAY_ANIMATION", [](sol::this_state ts, sol::variadic_args va) {
        const auto actor_id  = static_cast<uint32_t>(get_arg<int>(va, 0));
        const auto clip_name = get_arg<std::string>(va, 1);
        if (auto* scene = lives::ServiceLocator::try_get<lives::ecs::Scene>()) {
            if (auto* actor = scene->find_actor(actor_id)) {
                spdlog::debug("funcLuaMenuCommand: PLAY_ANIMATION({}, '{}') -> actor='{}'",
                              actor_id, clip_name, actor->name());
                // L'AnimPlayer iecode n'est pas encore expose comme Component ECS :
                // on logge la requete et on attend l'integration anim_component.
                return sol::make_object(sol::state_view(ts), sol::nil);
            }
            spdlog::warn("funcLuaMenuCommand: PLAY_ANIMATION actor_id 0x{:08x} introuvable", actor_id);
        }
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "STOP_ANIMATION", [](sol::this_state ts, sol::variadic_args va) {
        const auto actor_id = static_cast<uint32_t>(get_arg<int>(va, 0));
        if (auto* scene = lives::ServiceLocator::try_get<lives::ecs::Scene>()) {
            if (auto* actor = scene->find_actor(actor_id)) {
                spdlog::debug("funcLuaMenuCommand: STOP_ANIMATION({}) -> actor='{}'",
                              actor_id, actor->name());
                return sol::make_object(sol::state_view(ts), sol::nil);
            }
            spdlog::warn("funcLuaMenuCommand: STOP_ANIMATION actor_id 0x{:08x} introuvable", actor_id);
        }
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_ANIM_SPEED", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SET_ANIM_SPEED({})", get_arg<float>(va, 0, 1.f));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Son — utilise lives::ISoundController via le ServiceLocator.
    auto play_sound_handler = [](sol::this_state ts, sol::variadic_args va) {
        const auto sound_id = static_cast<uint32_t>(get_arg<int>(va, 0));
        if (auto* sc = lives::ServiceLocator::try_get<lives::ISoundController>()) {
            const lives::hash32 h{sound_id};
            const bool ok = sc->play(h);
            spdlog::debug("funcLuaMenuCommand: PLAY_SOUND(0x{:08x}) -> {}", sound_id, ok);
        } else {
            spdlog::debug("funcLuaMenuCommand: PLAY_SOUND(0x{:08x}) [no sound controller]", sound_id);
        }
        return sol::make_object(sol::state_view(ts), sol::nil);
    };
    auto stop_sound_handler = [](sol::this_state ts, sol::variadic_args va) {
        const auto sound_id = static_cast<uint32_t>(get_arg<int>(va, 0));
        if (auto* sc = lives::ServiceLocator::try_get<lives::ISoundController>()) {
            sc->stop(lives::hash32{sound_id});
            spdlog::debug("funcLuaMenuCommand: STOP_SOUND(0x{:08x})", sound_id);
        }
        return sol::make_object(sol::state_view(ts), sol::nil);
    };
    REG(m, "PLAY_SOUND", play_sound_handler);
    REG(m, "STOP_SOUND", stop_sound_handler);
    REG(m, "PLAY_SE", play_sound_handler);
    REG(m, "PLAY_BGM", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: PLAY_BGM({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "STOP_BGM", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuCommand: STOP_BGM");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Navigation / Scene
    REG(m, "PUSH_MENU", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: PUSH_MENU(\"{}\")", get_arg<std::string>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "POP_MENU", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuCommand: POP_MENU");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "CHANGE_SCENE", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: CHANGE_SCENE({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "LOAD_SCENE", [](sol::this_state ts, sol::variadic_args va) {
        const auto name = get_arg<std::string>(va, 0);
        auto& hooks = lua_game_hooks();
        if (hooks.load_scene) {
            hooks.load_scene(name);
            spdlog::debug("funcLuaMenuCommand: LOAD_SCENE('{}')", name);
        } else {
            spdlog::warn("funcLuaMenuCommand: LOAD_SCENE('{}') — hook game:: non enregistre", name);
        }
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_PLAYER_STAT", [](sol::this_state ts, sol::variadic_args va) {
        const auto pid  = static_cast<uint32_t>(get_arg<int>(va, 0));
        const auto stat = get_arg<std::string>(va, 1);
        double value = 0.0;
        auto& hooks = lua_game_hooks();
        if (hooks.get_player_stat) {
            value = hooks.get_player_stat(pid, stat);
        } else {
            spdlog::warn("funcLuaMenuCommand: GET_PLAYER_STAT({}, '{}') — hook game:: non enregistre",
                         pid, stat);
        }
        return sol::make_object(sol::state_view(ts), value);
    });
    REG(m, "SET_PLAYER_STAT", [](sol::this_state ts, sol::variadic_args va) {
        const auto pid  = static_cast<uint32_t>(get_arg<int>(va, 0));
        const auto stat = get_arg<std::string>(va, 1);
        const auto val  = get_arg<double>(va, 2);
        auto& hooks = lua_game_hooks();
        if (hooks.set_player_stat) {
            hooks.set_player_stat(pid, stat, val);
            spdlog::debug("funcLuaMenuCommand: SET_PLAYER_STAT({}, '{}', {})", pid, stat, val);
        } else {
            spdlog::warn("funcLuaMenuCommand: SET_PLAYER_STAT({}, '{}', {}) — hook game:: non enregistre",
                         pid, stat, val);
        }
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SHOW_POPUP", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: SHOW_POPUP({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "CLOSE_POPUP", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuCommand: CLOSE_POPUP");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Acces aux donnees
    REG(m, "GET_CHARA_NAME", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_CHARA_NAME({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), std::string(""));
    });
    REG(m, "GET_SKILL_NAME", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_SKILL_NAME({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), std::string(""));
    });
    REG(m, "GET_ITEM_NAME", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_ITEM_NAME({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), std::string(""));
    });
    REG(m, "GET_TEAM_NAME", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_TEAM_NAME({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), std::string(""));
    });
    REG(m, "GET_CHARA_STATS", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_CHARA_STATS({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_CHARA_ELEMENT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_CHARA_ELEMENT({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "GET_CHARA_POSITION", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_CHARA_POSITION({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), 0);
    });

    // Etat du jeu
    REG(m, "GET_PARTY_MEMBER", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_PARTY_MEMBER({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), -1);
    });
    REG(m, "GET_INVENTORY_COUNT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_INVENTORY_COUNT({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "GET_QUEST_STATE", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuCommand: GET_QUEST_STATE({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "GET_MONEY", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuCommand: GET_MONEY");
        return sol::make_object(sol::state_view(ts), 0);
    });

    // Alias numeriques (opcodes nie.exe) — partages avec les noms ci-dessus.
    m[0x31] = m[cmd_hash("LIST_GET_SELECTED")];
    m[0x70] = m[cmd_hash("GET_CHARA_NAME")];
    m[0x83] = m[cmd_hash("GET_MONEY")];
}

// ----------------------------------------------------------------------------
// funcLuaCameraCommand
// ----------------------------------------------------------------------------
void register_camera_handlers() {
    auto& m = s_camera_handlers;

    REG(m, "SET_CAMERA_POS", [](sol::this_state ts, sol::variadic_args va) {
        auto x = get_arg<float>(va, 0);
        auto y = get_arg<float>(va, 1);
        auto z = get_arg<float>(va, 2);
        spdlog::debug("funcLuaCameraCommand: SET_CAMERA_POS({}, {}, {})", x, y, z);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_CAMERA_TARGET", [](sol::this_state ts, sol::variadic_args va) {
        auto x = get_arg<float>(va, 0);
        auto y = get_arg<float>(va, 1);
        auto z = get_arg<float>(va, 2);
        spdlog::debug("funcLuaCameraCommand: SET_CAMERA_TARGET({}, {}, {})", x, y, z);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_CAMERA_FOV", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaCameraCommand: SET_CAMERA_FOV({})", get_arg<float>(va, 0, 60.f));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "CAMERA_SHAKE", [](sol::this_state ts, sol::variadic_args va) {
        auto i = get_arg<float>(va, 0);
        auto d = get_arg<float>(va, 1);
        spdlog::debug("funcLuaCameraCommand: CAMERA_SHAKE({}, {})", i, d);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "CAMERA_TRANSITION", [](sol::this_state ts, sol::variadic_args va) {
        auto d = get_arg<float>(va, 0);
        auto t = get_arg<int>(va, 1);
        spdlog::debug("funcLuaCameraCommand: CAMERA_TRANSITION({}, {})", d, t);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
}

// ----------------------------------------------------------------------------
// funcLuaActionCommand
// ----------------------------------------------------------------------------
void register_action_handlers() {
    auto& m = s_action_handlers;

    REG(m, "SET_CHARA_POS", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto x  = get_arg<float>(va, 1);
        auto y  = get_arg<float>(va, 2);
        auto z  = get_arg<float>(va, 3);
        spdlog::debug("funcLuaActionCommand: SET_CHARA_POS({}, {}, {}, {})", id, x, y, z);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_CHARA_ROTATION", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto a  = get_arg<float>(va, 1);
        spdlog::debug("funcLuaActionCommand: SET_CHARA_ROTATION({}, {})", id, a);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "PLAY_CHARA_ANIM", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto a  = get_arg<int>(va, 1);
        spdlog::debug("funcLuaActionCommand: PLAY_CHARA_ANIM({}, {})", id, a);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SHOW_CHARA", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto v  = get_arg<bool>(va, 1, true);
        spdlog::debug("funcLuaActionCommand: SHOW_CHARA({}, {})", id, v);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "MOVE_CHARA", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto x  = get_arg<float>(va, 1);
        auto y  = get_arg<float>(va, 2);
        auto z  = get_arg<float>(va, 3);
        auto s  = get_arg<float>(va, 4, 1.f);
        spdlog::debug("funcLuaActionCommand: MOVE_CHARA({}, {}, {}, {}, {})", id, x, y, z, s);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
}

// ----------------------------------------------------------------------------
// funcLuaEffectCommand
// ----------------------------------------------------------------------------
void register_effect_handlers() {
    auto& m = s_effect_handlers;

    REG(m, "PLAY_EFFECT", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto x  = get_arg<float>(va, 1);
        auto y  = get_arg<float>(va, 2);
        auto z  = get_arg<float>(va, 3);
        spdlog::debug("funcLuaEffectCommand: PLAY_EFFECT({}, {}, {}, {})", id, x, y, z);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "STOP_EFFECT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaEffectCommand: STOP_EFFECT({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_EFFECT_SCALE", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto s  = get_arg<float>(va, 1, 1.f);
        spdlog::debug("funcLuaEffectCommand: SET_EFFECT_SCALE({}, {})", id, s);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_EFFECT_COLOR", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto r  = get_arg<int>(va, 1, 255);
        auto g  = get_arg<int>(va, 2, 255);
        auto b  = get_arg<int>(va, 3, 255);
        auto a  = get_arg<int>(va, 4, 255);
        spdlog::debug("funcLuaEffectCommand: SET_EFFECT_COLOR({}, {}, {}, {}, {})", id, r, g, b, a);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "ATTACH_EFFECT", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto t  = get_arg<int>(va, 1);
        spdlog::debug("funcLuaEffectCommand: ATTACH_EFFECT({}, {})", id, t);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
}

// ----------------------------------------------------------------------------
// funcLuaCommand — generique
// ----------------------------------------------------------------------------
void register_command_handlers() {
    auto& m = s_command_handlers;

    REG(m, "SET_FLAG", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto v  = get_arg<int>(va, 1);
        spdlog::debug("funcLuaCommand: SET_FLAG({}, {})", id, v);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_FLAG", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaCommand: GET_FLAG({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "FADE_IN", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaCommand: FADE_IN({})", get_arg<float>(va, 0, 0.5f));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "FADE_OUT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaCommand: FADE_OUT({})", get_arg<float>(va, 0, 0.5f));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "WAIT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaCommand: WAIT({})", get_arg<int>(va, 0, 1));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Alias numeriques (opcodes nie.exe).
    m[0x02] = m[cmd_hash("GET_FLAG")];
}

// ----------------------------------------------------------------------------
// funcLuaSpTacticsCommand
// ----------------------------------------------------------------------------
void register_sp_tactics_handlers() {
    auto& m = s_sp_tactics_handlers;

    REG(m, "SET_FORMATION", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaSpTacticsCommand: SET_FORMATION({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_FORMATION", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaSpTacticsCommand: GET_FORMATION");
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "ACTIVATE_TACTICS", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaSpTacticsCommand: ACTIVATE_TACTICS({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "DEACTIVATE_TACTICS", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaSpTacticsCommand: DEACTIVATE_TACTICS({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_TACTICS_INFO", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaSpTacticsCommand: GET_TACTICS_INFO({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Alias numeriques (opcodes nie.exe).
    m[0x02] = m[cmd_hash("GET_FORMATION")];
}

// ----------------------------------------------------------------------------
// funcLuaMenuMapCommand
// ----------------------------------------------------------------------------
void register_menu_map_handlers() {
    auto& m = s_menu_map_handlers;

    REG(m, "SET_MAP_POS", [](sol::this_state ts, sol::variadic_args va) {
        auto x = get_arg<float>(va, 0);
        auto y = get_arg<float>(va, 1);
        spdlog::debug("funcLuaMenuMapCommand: SET_MAP_POS({}, {})", x, y);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_MAP_ZOOM", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuMapCommand: SET_MAP_ZOOM({})", get_arg<float>(va, 0, 1.f));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "ADD_MARKER", [](sol::this_state ts, sol::variadic_args va) {
        auto id = get_arg<int>(va, 0);
        auto x  = get_arg<float>(va, 1);
        auto y  = get_arg<float>(va, 2);
        auto t  = get_arg<int>(va, 3);
        spdlog::debug("funcLuaMenuMapCommand: ADD_MARKER({}, {}, {}, {})", id, x, y, t);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "REMOVE_MARKER", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuMapCommand: REMOVE_MARKER({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_FOG", [](sol::this_state ts, sol::variadic_args va) {
        auto z = get_arg<int>(va, 0);
        auto v = get_arg<bool>(va, 1, true);
        spdlog::debug("funcLuaMenuMapCommand: SET_FOG({}, {})", z, v);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Marqueurs minimap — delegues a la couche game:: via hooks.
    REG(m, "MAP_SET_MARKER", [](sol::this_state ts, sol::variadic_args va) {
        const auto x       = get_arg<float>(va, 0);
        const auto z       = get_arg<float>(va, 1);
        const auto icon_id = get_arg<int>(va, 2);
        auto& hooks = lua_game_hooks();
        if (hooks.map_set_marker) {
            hooks.map_set_marker(x, z, icon_id);
            spdlog::debug("funcLuaMenuMapCommand: MAP_SET_MARKER({}, {}, {})", x, z, icon_id);
        } else {
            spdlog::warn("funcLuaMenuMapCommand: MAP_SET_MARKER — hook game:: non enregistre");
        }
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "MAP_CLEAR_MARKERS", [](sol::this_state ts, sol::variadic_args /*va*/) {
        auto& hooks = lua_game_hooks();
        if (hooks.map_clear_markers) {
            hooks.map_clear_markers();
            spdlog::debug("funcLuaMenuMapCommand: MAP_CLEAR_MARKERS");
        } else {
            spdlog::warn("funcLuaMenuMapCommand: MAP_CLEAR_MARKERS — hook game:: non enregistre");
        }
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "MAP_GET_PLAYER_POS", [](sol::this_state ts, sol::variadic_args /*va*/) {
        auto& hooks = lua_game_hooks();
        sol::state_view sv(ts);
        if (hooks.map_get_player_pos) {
            const auto pos = hooks.map_get_player_pos();
            sol::table t = sv.create_table();
            t["x"] = std::get<0>(pos);
            t["y"] = std::get<1>(pos);
            t["z"] = std::get<2>(pos);
            return sol::make_object(sv, t);
        }
        spdlog::warn("funcLuaMenuMapCommand: MAP_GET_PLAYER_POS — hook game:: non enregistre");
        return sol::make_object(sv, sol::nil);
    });
}

// ----------------------------------------------------------------------------
// funcLuaMenuNetworkCommand
// ----------------------------------------------------------------------------
void register_menu_network_handlers() {
    auto& m = s_menu_network_handlers;

    REG(m, "GET_ONLINE_STATUS", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuNetworkCommand: GET_ONLINE_STATUS");
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "CREATE_ROOM", [](sol::this_state ts, sol::variadic_args va) {
        auto n = get_arg<std::string>(va, 0);
        auto p = get_arg<int>(va, 1, 4);
        spdlog::debug("funcLuaMenuNetworkCommand: CREATE_ROOM(\"{}\", {})", n, p);
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "JOIN_ROOM", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuNetworkCommand: JOIN_ROOM({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "LEAVE_ROOM", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuNetworkCommand: LEAVE_ROOM");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_ROOM_MEMBERS", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuNetworkCommand: GET_ROOM_MEMBERS");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Alias numeriques (opcodes nie.exe).
    m[0x01] = m[cmd_hash("GET_ONLINE_STATUS")];
}

// ----------------------------------------------------------------------------
// funcLuaMenuMultiplayCommand
// ----------------------------------------------------------------------------
void register_menu_multiplay_handlers() {
    auto& m = s_menu_multiplay_handlers;

    REG(m, "START_MATCHMAKING", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuMultiplayCommand: START_MATCHMAKING({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "CANCEL_MATCHMAKING", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuMultiplayCommand: CANCEL_MATCHMAKING");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_MATCH_STATUS", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuMultiplayCommand: GET_MATCH_STATUS");
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "SET_TEAM_READY", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuMultiplayCommand: SET_TEAM_READY({})", get_arg<bool>(va, 0, true));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
}

// ----------------------------------------------------------------------------
// funcLuaMenuVSRouteTownCommand
// ----------------------------------------------------------------------------
void register_menu_vs_route_handlers() {
    auto& m = s_menu_vs_route_handlers;

    REG(m, "GET_VS_ROUTE_STATE", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuVSRouteTownCommand: GET_VS_ROUTE_STATE");
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "SET_VS_ROUTE_TARGET", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuVSRouteTownCommand: SET_VS_ROUTE_TARGET({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_VS_ROUTE_PROGRESS", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuVSRouteTownCommand: GET_VS_ROUTE_PROGRESS");
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "GET_VS_ROUTE_REWARD", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuVSRouteTownCommand: GET_VS_ROUTE_REWARD({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
}

// ----------------------------------------------------------------------------
// funcLuaMenuDictCommand
// ----------------------------------------------------------------------------
void register_menu_dict_handlers() {
    auto& m = s_menu_dict_handlers;

    REG(m, "GET_DICT_ENTRY", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuDictCommand: GET_DICT_ENTRY({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "IS_ENTRY_UNLOCKED", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuDictCommand: IS_ENTRY_UNLOCKED({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), false);
    });
    REG(m, "GET_DICT_COUNT", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuDictCommand: GET_DICT_COUNT");
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "GET_UNLOCKED_COUNT", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuDictCommand: GET_UNLOCKED_COUNT");
        return sol::make_object(sol::state_view(ts), 0);
    });

    // Alias numeriques (opcodes nie.exe).
    m[0x03] = m[cmd_hash("GET_DICT_COUNT")];
}

// ----------------------------------------------------------------------------
// funcLuaMenuMapTravelCommand
// ----------------------------------------------------------------------------
void register_menu_map_travel_handlers() {
    auto& m = s_menu_map_travel_handlers;

    REG(m, "GET_TRAVEL_POINTS", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuMapTravelCommand: GET_TRAVEL_POINTS");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "TRAVEL_TO", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuMapTravelCommand: TRAVEL_TO({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "IS_POINT_UNLOCKED", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuMapTravelCommand: IS_POINT_UNLOCKED({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), false);
    });
    REG(m, "GET_CURRENT_AREA", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuMapTravelCommand: GET_CURRENT_AREA");
        return sol::make_object(sol::state_view(ts), 0);
    });
}

// ----------------------------------------------------------------------------
// funcLuaMenuNfcCommand
// ----------------------------------------------------------------------------
void register_menu_nfc_handlers() {
    auto& m = s_menu_nfc_handlers;

    REG(m, "START_NFC_SCAN", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuNfcCommand: START_NFC_SCAN");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "STOP_NFC_SCAN", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuNfcCommand: STOP_NFC_SCAN");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_NFC_STATUS", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuNfcCommand: GET_NFC_STATUS");
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "GET_NFC_DATA", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuNfcCommand: GET_NFC_DATA");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
}

// ----------------------------------------------------------------------------
// funcLuaMenuPostCommand
// ----------------------------------------------------------------------------
void register_menu_post_handlers() {
    auto& m = s_menu_post_handlers;

    REG(m, "CREATE_POST", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuPostCommand: CREATE_POST(\"{}\")", get_arg<std::string>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "DELETE_POST", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuPostCommand: DELETE_POST({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "LIKE_POST", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuPostCommand: LIKE_POST({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "GET_POST_DATA", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuPostCommand: GET_POST_DATA({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
}

// ----------------------------------------------------------------------------
// funcLuaMenuPostListCommand
// ----------------------------------------------------------------------------
void register_menu_post_list_handlers() {
    auto& m = s_menu_post_list_handlers;

    REG(m, "GET_POST_COUNT", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuPostListCommand: GET_POST_COUNT");
        return sol::make_object(sol::state_view(ts), 0);
    });
    REG(m, "GET_POST_AT", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuPostListCommand: GET_POST_AT({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "SET_FILTER", [](sol::this_state ts, sol::variadic_args va) {
        spdlog::debug("funcLuaMenuPostListCommand: SET_FILTER({})", get_arg<int>(va, 0));
        return sol::make_object(sol::state_view(ts), sol::nil);
    });
    REG(m, "REFRESH_LIST", [](sol::this_state ts, sol::variadic_args /*va*/) {
        spdlog::debug("funcLuaMenuPostListCommand: REFRESH_LIST");
        return sol::make_object(sol::state_view(ts), sol::nil);
    });

    // Alias numeriques (opcodes nie.exe).
    m[0x01] = m[cmd_hash("GET_POST_COUNT")];
}

#undef REG

/// Initialise toutes les tables de handlers une seule fois (thread-safe).
void register_handlers() {
    std::call_once(s_init_flag, [] {
        register_menu_handlers();
        register_camera_handlers();
        register_action_handlers();
        register_effect_handlers();
        register_command_handlers();
        register_sp_tactics_handlers();
        register_menu_map_handlers();
        register_menu_network_handlers();
        register_menu_multiplay_handlers();
        register_menu_vs_route_handlers();
        register_menu_dict_handlers();
        register_menu_map_travel_handlers();
        register_menu_nfc_handlers();
        register_menu_post_handlers();
        register_menu_post_list_handlers();

        const std::size_t total =
            s_menu_handlers.size() + s_camera_handlers.size() + s_action_handlers.size() +
            s_effect_handlers.size() + s_command_handlers.size() + s_sp_tactics_handlers.size() +
            s_menu_map_handlers.size() + s_menu_network_handlers.size() +
            s_menu_multiplay_handlers.size() + s_menu_vs_route_handlers.size() +
            s_menu_dict_handlers.size() + s_menu_map_travel_handlers.size() +
            s_menu_nfc_handlers.size() + s_menu_post_handlers.size() +
            s_menu_post_list_handlers.size();
        spdlog::info("Lua bridges: {} handlers enregistres dans 15 tables CRC32", total);
    });
}

// ============================================================================
// Trampolines sol2 — un par bridge, dispatch via la map correspondante
// ============================================================================

sol::object trampoline_menu(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuCommand", s_menu_handlers, ts, cmd_id, va);
}
sol::object trampoline_camera(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaCameraCommand", s_camera_handlers, ts, cmd_id, va);
}
sol::object trampoline_action(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaActionCommand", s_action_handlers, ts, cmd_id, va);
}
sol::object trampoline_effect(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaEffectCommand", s_effect_handlers, ts, cmd_id, va);
}
sol::object trampoline_command(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaCommand", s_command_handlers, ts, cmd_id, va);
}
sol::object trampoline_sp_tactics(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaSpTacticsCommand", s_sp_tactics_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_map(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuMapCommand", s_menu_map_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_network(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuNetworkCommand", s_menu_network_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_multiplay(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuMultiplayCommand", s_menu_multiplay_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_vs_route(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuVSRouteTownCommand", s_menu_vs_route_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_dict(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuDictCommand", s_menu_dict_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_map_travel(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuMapTravelCommand", s_menu_map_travel_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_nfc(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuNfcCommand", s_menu_nfc_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_post(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuPostCommand", s_menu_post_handlers, ts, cmd_id, va);
}
sol::object trampoline_menu_post_list(sol::this_state ts, uint32_t cmd_id, sol::variadic_args va) {
    return dispatch("funcLuaMenuPostListCommand", s_menu_post_list_handlers, ts, cmd_id, va);
}

} // namespace

// ============================================================================
// register_func_lua_bridges — point d'entree
// ============================================================================

void register_func_lua_bridges(sol::state& lua) {
    spdlog::info("Enregistrement des 15 fonctions bridge funcLua* (dispatch CRC32)...");

    register_handlers();

    lua.set_function("funcLuaMenuCommand",            trampoline_menu);
    lua.set_function("funcLuaMenuMapCommand",         trampoline_menu_map);
    lua.set_function("funcLuaMenuNetworkCommand",     trampoline_menu_network);
    lua.set_function("funcLuaMenuMultiplayCommand",   trampoline_menu_multiplay);
    lua.set_function("funcLuaMenuVSRouteTownCommand", trampoline_menu_vs_route);
    lua.set_function("funcLuaActionCommand",          trampoline_action);
    lua.set_function("funcLuaEffectCommand",          trampoline_effect);
    lua.set_function("funcLuaCameraCommand",          trampoline_camera);
    lua.set_function("funcLuaCommand",                trampoline_command);
    lua.set_function("funcLuaMenuDictCommand",        trampoline_menu_dict);
    lua.set_function("funcLuaMenuMapTravelCommand",   trampoline_menu_map_travel);
    lua.set_function("funcLuaMenuNfcCommand",         trampoline_menu_nfc);
    lua.set_function("funcLuaMenuPostCommand",        trampoline_menu_post);
    lua.set_function("funcLuaMenuPostListCommand",    trampoline_menu_post_list);
    lua.set_function("funcLuaSpTacticsCommand",       trampoline_sp_tactics);

    spdlog::info("15 fonctions bridge funcLua* enregistrees avec succes.");
}

} // namespace iecode::engine
