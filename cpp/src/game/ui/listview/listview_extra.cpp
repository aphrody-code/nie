/// @file listview_extra.cpp
/// Implementation des vues liste supplementaires — 18 specialisations.
/// Chaque sous-classe implemente les methodes de base de CMenuListView.

#include "iecode/game/ui/listview/listview_extra.h"

#include <spdlog/spdlog.h>

namespace game {

// ============================================================================
// MenuNestListView
// ============================================================================

void MenuNestListView::enter_child(uint32_t index) {
    if (!is_valid_index(index)) return;
    parent_indices_.push_back(selected_index_);
    depth_++;
    selected_index_ = 0;
    scroll_offset_ = 0;
    // TODO: charger les sous-elements du noeud selectionne.
    spdlog::trace("MenuNestListView::enter_child — depth={}", depth_);
}

void MenuNestListView::go_back() {
    if (depth_ == 0 || parent_indices_.empty()) return;
    selected_index_ = parent_indices_.back();
    parent_indices_.pop_back();
    depth_--;
    scroll_offset_ = 0;
    // TODO: recharger les elements du niveau parent.
    spdlog::trace("MenuNestListView::go_back — depth={}", depth_);
}

// Les autres listviews sont des structs POD derivant de lives::CMenuListView.
// Elles se distinguent par leur CFG_KEY et leur get_class_name().
// La logique de remplissage (populate) est pilotee par les scripts Lua
// et les GDS*Config correspondants.

} // namespace game
