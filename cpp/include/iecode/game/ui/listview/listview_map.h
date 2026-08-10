#pragma once

/// @file listview_map.h
/// Vue liste voyage carte.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste de destinations de voyage.
struct CMenuListViewMapTravel : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_MAP_TRAVEL";
};

} // namespace game
