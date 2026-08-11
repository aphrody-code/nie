#pragma once

/// @file listview_chara_edit.h
/// Vues liste edition personnage — couleur, parts.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Selection de couleur pour edition personnage.
struct CMenuListViewCharaEditColor : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CHARA_EDIT_COLOR";
};

/// Selection de parts pour edition personnage.
struct CMenuListViewCharaEditParts : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CHARA_EDIT_PARTS";
};

} // namespace game
