#pragma once

/// @file npc_craft.h
/// CCraftNpcController — controleur PNJ pour les ateliers de craft.
/// CCraftNpcData — donnees PNJ pour les ateliers de craft.
///
// iecode abstraction — no RTTI counterpart in nie.exe
/// Dans nie.exe, seule game::CNpcUnit existe. CCraftNpc* est une
/// abstraction iecode pour les PNJ d'ateliers/marchands.

#include "npc_base.h"
#include <cstdint>

namespace game {

/// Donnees PNJ pour les ateliers de craft.
struct CCraftNpcData : CBaseNpcData {
    uint32_t shop_id     = 0;   // ID de la boutique de craft
    uint32_t recipe_list = 0;   // ID de la liste de recettes disponibles
    uint32_t craft_type  = 0;   // Type de craft (equipement, objet, etc.)
};

/// Controleur PNJ pour les ateliers de craft.
struct CCraftNpcController : CBaseNpcController {
    void update(float dt) override;
    void interact() override;
    [[nodiscard]] std::string_view controller_name() const override { return "CCraftNpcController"; }

    bool is_crafting_ = false;
};

} // namespace game
