/// @file scene_event.cpp
/// Implementation de CSceneEvent — cinematiques et evenements scriptes.
/// Pilotee par GDSEventPlayConfig et les scripts Lua associes.

#include "iecode/game/scene/scene_event.h"

#include <spdlog/spdlog.h>

namespace game {

/// Phases internes des evenements.
namespace event_phase {
    inline constexpr uint32_t LOADING    = 0;
    inline constexpr uint32_t PLAYING    = 1;
    inline constexpr uint32_t DIALOGUE   = 2;
    inline constexpr uint32_t CUTSCENE   = 3;
    inline constexpr uint32_t FINISHING  = 4;
} // namespace event_phase

void CSceneEvent::on_enter() {
    active_ = true;
    elapsed_time_ = 0.f;
    skip_requested_ = false;
    set_phase(event_phase::LOADING);
    spdlog::info("[CSceneEvent] Entree — chargement evenement id={}",
                 event_id_);
}

void CSceneEvent::on_update(float dt) {
    elapsed_time_ += dt;

    // Skip demande par l'utilisateur.
    if (skip_requested_ && skippable_) {
        set_phase(event_phase::FINISHING);
        skip_requested_ = false;
        return;
    }

    // Dans nie.exe, les evenements utilisent :
    // - GDSEventPlayConfig pour la sequence d'actions
    // - GDSEventBustupTalkConfig pour les dialogues bustup
    // - GDSEventSubtitleConfig pour les sous-titres
    // - GDSEventEnvConfig pour l'environnement
    spdlog::trace("[CSceneEvent] Update phase={} event={} elapsed={:.2f}",
                  phase_, event_id_, elapsed_time_);
}

void CSceneEvent::on_draw() {
    spdlog::trace("[CSceneEvent] Draw phase={} event={}", phase_, event_id_);
}

void CSceneEvent::on_exit() {
    active_ = false;
    spdlog::info("[CSceneEvent] Sortie de l'evenement id={}", event_id_);
}

} // namespace game
