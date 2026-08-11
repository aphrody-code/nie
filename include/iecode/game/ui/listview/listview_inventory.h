#pragma once

/// @file listview_inventory.h
/// Vues liste inventaire — inventaire general, objets, filtres.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste inventaire.
struct CMenuListViewInventory : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_INVENTORY";
};

/// Liste d'objets.
struct CMenuListViewItem : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_ITEM";
};

/// Filtre d'objets.
struct CMenuListViewItemFilter : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_ITEM_FILTER";
};

} // namespace game
