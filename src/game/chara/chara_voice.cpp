/// @file chara_voice.cpp
/// Implementation de CCharaVoice — gestion des cues audio par trigger.

#include "iecode/game/chara/chara_voice.h"

#include <spdlog/spdlog.h>

#include <algorithm>

namespace game {

int32_t CCharaVoice::play(VoiceTrigger trigger) {
    if (trigger == VoiceTrigger::None) {
        return -1;
    }

    const auto trigger_idx = static_cast<uint8_t>(trigger);
    if (trigger_idx >= trigger_map_.size()) {
        spdlog::warn("CCharaVoice::play: trigger {} hors limites", trigger_idx);
        return -1;
    }

    const auto& mapping = trigger_map_[trigger_idx];
    if (mapping.cue_id == 0) {
        spdlog::debug("CCharaVoice::play: aucun cue configure pour trigger {}", trigger_idx);
        return -1;
    }

    // Trouver un slot libre
    for (uint32_t i = 0; i < MAX_CONCURRENT_VOICES; ++i) {
        if (!slots_[i].active) {
            slots_[i] = VoiceCue{
                .trigger  = trigger,
                .cue_id   = mapping.cue_id,
                .elapsed  = 0.f,
                .duration = mapping.duration,
                .volume   = volume_,
                .active   = true,
            };
            spdlog::debug("CCharaVoice::play: cue {} dans slot {} (voice_set {})",
                          mapping.cue_id, i, voice_set_id_);
            return static_cast<int32_t>(i);
        }
    }

    spdlog::debug("CCharaVoice::play: aucun slot libre ({} slots occupes)",
                  MAX_CONCURRENT_VOICES);
    return -1;
}

void CCharaVoice::stop_all() {
    for (auto& slot : slots_) {
        slot.active = false;
    }
}

void CCharaVoice::update(float dt) {
    if (dt <= 0.f) {
        return;
    }

    for (auto& slot : slots_) {
        if (!slot.active) {
            continue;
        }

        slot.elapsed += dt;
        if (slot.elapsed >= slot.duration) {
            slot.active = false;
        }
    }
}

bool CCharaVoice::is_playing() const {
    return std::any_of(slots_.begin(), slots_.end(),
                       [](const VoiceCue& c) { return c.active; });
}

uint32_t CCharaVoice::active_count() const {
    return static_cast<uint32_t>(std::count_if(
        slots_.begin(), slots_.end(),
        [](const VoiceCue& c) { return c.active; }));
}

void CCharaVoice::set_cue_mapping(VoiceTrigger trigger, uint32_t cue_id, float duration) {
    const auto idx = static_cast<uint8_t>(trigger);
    if (idx >= trigger_map_.size()) {
        return;
    }
    trigger_map_[idx] = CueMapping{.cue_id = cue_id, .duration = duration};
}

} // namespace game
