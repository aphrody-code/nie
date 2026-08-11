#pragma once

/// @file listview_equip.h
/// Vues liste equipement — equipement, aura skill, medal set.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste d'equipement general.
struct CMenuListViewEquip : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_EQUIP";
};

/// Selection de competence aura a equiper.
struct CMenuListViewEquipAuraSkill : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_EQUIP_AURA_SKILL";
};

/// Set de medailles.
struct CMenuListViewEquipMedalSet : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_EQUIP_MEDAL_SET";
};

/// Position dans un set de medailles.
struct CMenuListViewEquipMedalSetPos : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_EQUIP_MEDAL_SET_POS";
};

} // namespace game
