/// @file rpg_target_manager.cpp
/// Implementation de CRpgTargetManager — selection de cibles en combat RPG.

#include "iecode/game/rpg/rpg_target_manager.h"

#include <spdlog/spdlog.h>

namespace game {

void CRpgTargetManager::select_next() {
    if (target_count_ == 0) {
        return;
    }

    selected_index_ = (selected_index_ + 1) % target_count_;
    has_selection_ = true;

    spdlog::debug("CRpgTargetManager: cible suivante -> {}/{}",
                  selected_index_, target_count_);
}

void CRpgTargetManager::select_prev() {
    if (target_count_ == 0) {
        return;
    }

    if (selected_index_ == 0) {
        selected_index_ = target_count_ - 1;
    } else {
        --selected_index_;
    }
    has_selection_ = true;

    spdlog::debug("CRpgTargetManager: cible precedente -> {}/{}",
                  selected_index_, target_count_);
}

void CRpgTargetManager::confirm() {
    if (!has_selection_) {
        return;
    }

    spdlog::debug("CRpgTargetManager: cible confirmee -> index={}, chara={}",
                  selected_index_, selected_chara_id_);
}

} // namespace game
