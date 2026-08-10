#pragma once

/// @file pad_steam.h
/// Wrapper Steam Input API (lives::CPadSteam).
/// Le jeu utilise Steam Input pour la gestion multi-plateforme des manettes.
/// Steam App ID : 2799860.

#include "pad.h"

namespace lives {

/// Gamepad via Steam Input API (lives::CPadSteam).
struct CPadSteam : CPad {
    uint64_t steam_input_handle_ = 0;    ///< ISteamInput handle
    bool     steam_input_active_ = false;

    [[nodiscard]] std::string_view get_class_name() const override { return "CPadSteam"; }
};

} // namespace lives
