#pragma once

/// @file listview_ability.h
/// Vue liste competences (ability).

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste de competences.
struct CMenuListViewAbility : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_ABILITY";
};

} // namespace game
