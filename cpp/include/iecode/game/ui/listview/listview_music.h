#pragma once

/// @file listview_music.h
/// Vue liste musique (galerie audio).

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste de musiques.
struct CMenuListViewMusic : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_MUSIC";
};

} // namespace game
