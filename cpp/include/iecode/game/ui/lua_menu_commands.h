#pragma once

/// @file lua_menu_commands.h
/// Command IDs pour le dispatch Lua -> C++ (game::dispatch_menu_command).
///
/// nie.exe : funcLuaMenuCommand — FUN_140c39f90.
/// La table de dispatch se trouve a VA 0x141a5c630 (file offset 0x01a5ac30).
/// Format des entrees : { handler_va: uint64, cmd_id: uint32, padding: uint32 } = 16 octets.
/// Dispatch par recherche binaire sur cmd_id trie (FUN_140c34f80).
///
/// IMPORTANT : Les cmd_id sont des hashes 32 bits — NOT des entiers sequentiels.
///   funcLuaMenuCommand  : 1026 handlers, IDs range [0x00003b4c .. 0xffce7918]
///   funcLuaCommand      : 48 handlers,   table VA 0x141a5c330
///   funcLuaMenuNetworkCommand : 39 handlers
///
/// Les preimages (noms de commandes) ne sont pas encore determines.
/// Le tableau ci-dessous documente les IDs confirmes depuis le binaire nie.exe.
/// Les constantes non-documentees sont annotees UNKNOWN jusqu'a resolution.

#include <cstdint>
#include <string_view>

namespace game {

// ============================================================================
// Type de base pour un command ID (hash 32 bits)
// ============================================================================

/// Identifiant de commande menu Lua — valeur hash 32 bits.
/// Calcule depuis le nom de la commande par un algorithme hash non encore determine.
using MenuCommandId = uint32_t;

// ============================================================================
// Commandes confirmees depuis nie.exe (preimages partiellement inconnues)
// ============================================================================

/// Deux commandes dont les handlers sont documentes dans nie.c :
///   0x99d6e8c7 — FUN_140c3a070 : recherche entite par ID, applique motion avec flag bool
///   0x078109cf — FUN_140c3a1f0 : variante simplifiee de la commande menu Lua
static constexpr MenuCommandId kMenuCmd_Unknown1 = 0x99d6e8c7u;
static constexpr MenuCommandId kMenuCmd_Unknown2 = 0x078109cfu;

// ============================================================================
// Metadonnees de la table de dispatch (nie.exe)
// ============================================================================

/// Adresse virtuelle de la table funcLuaMenuCommand (nie.exe image base 0x140000000).
static constexpr uint64_t kMenuCommandTableVA   = 0x141a5c630ull;
/// Nombre de handlers enregistres pour funcLuaMenuCommand.
static constexpr uint32_t kMenuCommandCount     = 1026u;

/// Adresse virtuelle de la table funcLuaCommand.
static constexpr uint64_t kGenericCommandTableVA = 0x141a5c330ull;
/// Nombre de handlers enregistres pour funcLuaCommand.
static constexpr uint32_t kGenericCommandCount   = 48u;

/// Plage des cmd_id dans funcLuaMenuCommand.
static constexpr MenuCommandId kMenuCommandIdMin = 0x00003b4cu;
static constexpr MenuCommandId kMenuCommandIdMax = 0xffce7918u;

// ============================================================================
// Dispatch
// ============================================================================

/// Dispatch une commande menu Lua vers le handler C++ correspondant.
/// @param cmd_id Identifiant hash de la commande (table funcLuaMenuCommand).
/// @param arg1   Premier argument generique.
/// @param arg2   Second argument generique.
/// @param arg3   Troisieme argument generique.
/// @return Code de retour (0 = succes, ou valeur specifique a la commande).
/// @note nie.exe : FUN_140c39f90 -> FUN_140c34f80 (binary search dispatch).
[[nodiscard]] int32_t dispatch_menu_command(MenuCommandId cmd_id,
                                            int64_t arg1 = 0,
                                            int64_t arg2 = 0,
                                            int64_t arg3 = 0);

/// Dispatch une commande generique Lua (table funcLuaCommand, 48 handlers).
/// @note nie.exe : FUN_140c34ec0 -> FUN_140c34f80.
[[nodiscard]] int32_t dispatch_generic_command(MenuCommandId cmd_id,
                                               int64_t arg1 = 0,
                                               int64_t arg2 = 0,
                                               int64_t arg3 = 0);

/// Retourne le nom lisible d'une commande si connu (pour debug/logging).
/// Retourne "0xXXXXXXXX" si le preimage n'est pas encore determine.
[[nodiscard]] std::string_view menu_command_name(MenuCommandId cmd_id);

} // namespace game
