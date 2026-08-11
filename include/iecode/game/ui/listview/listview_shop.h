#pragma once

/// @file listview_shop.h
/// Vues liste boutique — boutique, recherche basara.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste de la boutique.
struct CMenuListViewShop : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SHOP";
};

/// Recherche de personnage basara en boutique.
struct CMenuListViewShopBasaraSearchChara : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SHOP_BASARA_SEARCH_CHARA";
};

} // namespace game
