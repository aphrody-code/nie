#pragma once

/// @file listview_quest.h
/// Vues liste quetes — quetes, sous-fenetre commune.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste de quetes.
struct CMenuListViewQuest : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_QUEST";
};

/// Sous-fenetre commune de quete.
struct CMenuListViewQuestSubWindowCommon : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_QUEST_SUB_WINDOW_COMMON";
};

} // namespace game
