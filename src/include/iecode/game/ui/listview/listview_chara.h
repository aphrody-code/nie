#pragma once

/// @file listview_chara.h
/// Vues liste personnages — selection, banque, filtres, equipement.
/// 6 specialisations CMenuListView* pour le domaine personnage.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste de selection de personnage.
struct CMenuListViewChara : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CHARA";
};

/// Banque de personnages (collection complete).
struct CMenuListViewCharaBank : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CHARA_BANK";
};

/// Filtre banque de personnages.
struct CMenuListViewCharaBankFilter : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CHARA_BANK_FILTER";
};

/// Filtre personnage.
struct CMenuListViewCharaFilter : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CHARA_FILTER";
};

/// Recherche inverse de personnage.
struct CMenuListViewCharaReverseLookup : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CHARA_REVERSE_LOOKUP";
};

/// Equipement personnage.
struct CMenuListViewCharaEquip : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CHARA_EQUIP";
};

} // namespace game
