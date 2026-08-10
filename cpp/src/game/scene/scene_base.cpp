/// @file scene_base.cpp
/// Implementation de CScene — cycle de vie et gestion des phases.

#include "iecode/game/scene/scene_base.h"

#include <spdlog/spdlog.h>

namespace game {

void CScene::set_phase(uint32_t new_phase) {
    if (new_phase == phase_) {
        return;
    }
    const uint32_t old_phase = phase_;
    on_phase_changed(old_phase, new_phase);
    phase_ = new_phase;
    spdlog::debug("[{}] Phase {} -> {}", scene_name(), old_phase, new_phase);
}

} // namespace game
