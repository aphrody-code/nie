/// @file scene_vsroute.cpp
/// Implementation de CSceneVSRoute — mode VS Route (combats IA et en ligne).
/// Gere la progression sur la route et les matchs via EOS.

#include "iecode/game/scene/scene_vsroute.h"

#include <spdlog/spdlog.h>

namespace game {

/// Phases internes du VS Route.
namespace vsroute_phase {
    inline constexpr uint32_t TOWN           = 0;
    inline constexpr uint32_t TEAM_SELECT    = 1;
    inline constexpr uint32_t MATCHMAKING    = 2;
    inline constexpr uint32_t PRE_MATCH      = 3;
    inline constexpr uint32_t MATCH          = 4;
    inline constexpr uint32_t POST_MATCH     = 5;
    inline constexpr uint32_t RESULT         = 6;
} // namespace vsroute_phase

void CSceneVSRoute::on_enter() {
    active_ = true;
    elapsed_time_ = 0.f;
    set_phase(vsroute_phase::TOWN);
    spdlog::info("[CSceneVSRoute] Entree — VS Route niveau {} (online={})",
                 route_level_, is_online_);
}

void CSceneVSRoute::on_update(float dt) {
    elapsed_time_ += dt;

    // Dans nie.exe, le VS Route utilise :
    // - funcLuaMenuVSRouteTownCommand (FUN_141116110) pour la navigation
    // - EOS (Epic Online Services) pour le matchmaking en ligne
    // - CSoccerStateMachine pour les matchs eux-memes
    spdlog::trace("[CSceneVSRoute] Update phase={} level={} elapsed={:.2f}",
                  phase_, route_level_, elapsed_time_);
}

void CSceneVSRoute::on_draw() {
    spdlog::trace("[CSceneVSRoute] Draw phase={}", phase_);
}

void CSceneVSRoute::on_exit() {
    active_ = false;
    spdlog::info("[CSceneVSRoute] Sortie du VS Route");
}

} // namespace game
