/// @file lua_menu_commands.cpp
/// Dispatch des commandes menu Lua -> C++ (game::dispatch_menu_command).
/// nie.exe : funcLuaMenuCommand — FUN_140c39f90.
/// Table de dispatch : 1026 handlers a VA 0x141a5c630, recherche binaire sur cmd_id hash.
///
/// Les cmd_id sont des hashes 32 bits dont les preimages (noms) sont inconnus.
/// Le dispatch actuel log le hash et retourne 0 (stub).

#include "iecode/game/ui/lua_menu_commands.h"

#include <fmt/format.h>
#include <spdlog/spdlog.h>

namespace game {

// ============================================================================
// menu_command_name
// ============================================================================

std::string_view menu_command_name(MenuCommandId cmd_id) {
    // Les deux seuls handlers documentes depuis nie.c :
    switch (cmd_id) {
        case kMenuCmd_Unknown1: return "CMD_99d6e8c7_EntityMotion";
        case kMenuCmd_Unknown2: return "CMD_078109cf_MenuSimple";
        default: return "UNKNOWN";
    }
}

// ============================================================================
// dispatch_menu_command — funcLuaMenuCommand (1026 handlers)
// ============================================================================

int32_t dispatch_menu_command(MenuCommandId cmd_id, int64_t arg1, int64_t arg2, int64_t arg3) {
    spdlog::trace("dispatch_menu_command — cmd=0x{:08x} ({}) args=[{}, {}, {}]",
                  cmd_id, menu_command_name(cmd_id), arg1, arg2, arg3);

    // TODO: implementer la binary search dispatch sur les 1026 handlers.
    // Chaque handler est a FUN_140c3xxxx (range ~140c39000 — 140c50000).
    // Les handlers sont indexes par hash cmd_id dans la table a VA 0x141a5c630.
    //
    // Handlers partiellement documentes depuis nie.c :
    //   0x99d6e8c7 → FUN_140c3a070 : recherche entite par ID, applique motion avec flag bool
    //   0x078109cf → FUN_140c3a1f0 : variante simplifiee de la commande menu

    switch (cmd_id) {
        case kMenuCmd_Unknown1:
            // FUN_140c3a070 : entity lookup + motion apply
            spdlog::debug("dispatch: CMD_99d6e8c7 — entity motion, id={}, motion={}", arg1, arg2);
            return 0;

        case kMenuCmd_Unknown2:
            // FUN_140c3a1f0 : simplified menu command
            spdlog::debug("dispatch: CMD_078109cf — simple menu, arg={}", arg1);
            return 0;

        default:
            spdlog::trace("dispatch_menu_command — unhandled cmd=0x{:08x}", cmd_id);
            return 0;
    }
}

// ============================================================================
// dispatch_generic_command — funcLuaCommand (48 handlers)
// ============================================================================

int32_t dispatch_generic_command(MenuCommandId cmd_id, int64_t arg1, int64_t arg2, int64_t arg3) {
    spdlog::trace("dispatch_generic_command — cmd=0x{:08x} args=[{}, {}, {}]",
                  cmd_id, arg1, arg2, arg3);

    // TODO: 48 handlers a VA 0x141a5c330.
    // nie.exe : FUN_140c34ec0 -> FUN_140c34f80 (binary search).
    return 0;
}

} // namespace game
