#pragma once

/// @file listview_gallery.h
/// Vue liste galerie (images/videos collectionnees).

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Liste de la galerie.
struct CMenuListViewGallery : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_GALLERY";
};

} // namespace game
