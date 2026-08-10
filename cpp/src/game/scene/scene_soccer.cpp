/// @file scene_soccer.cpp
/// Implementation de CSceneSoccer et CSceneSoccerTraining.
/// 11 phases de match : Kickoff, Play, Shoot, Dribble, Block, Catch,
/// SpecialTactics, Halftime, Goal, FreeKick, Penalty.

#include "iecode/game/scene/scene_soccer.h"

#include <spdlog/spdlog.h>

namespace game {

/// Phases internes du match soccer.
namespace soccer_phase {
    inline constexpr uint32_t INIT             = 0;
    inline constexpr uint32_t KICKOFF          = 1;
    inline constexpr uint32_t PLAY             = 2;
    inline constexpr uint32_t SHOOT            = 3;
    inline constexpr uint32_t DRIBBLE          = 4;
    inline constexpr uint32_t BLOCK            = 5;
    inline constexpr uint32_t CATCH            = 6;
    inline constexpr uint32_t SPECIAL_TACTICS  = 7;
    inline constexpr uint32_t HALFTIME         = 8;
    inline constexpr uint32_t GOAL             = 9;
    inline constexpr uint32_t FREE_KICK        = 10;
    inline constexpr uint32_t PENALTY          = 11;
    inline constexpr uint32_t RESULT           = 12;
} // namespace soccer_phase

// ── CSceneSoccer ─────────────────────────────────────────────────────

void CSceneSoccer::on_enter() {
    active_ = true;
    elapsed_time_ = 0.f;
    match_id_ = 0;
    set_phase(soccer_phase::INIT);
    spdlog::info("[CSceneSoccer] Entree — initialisation du match "
                 "(max {} joueurs, stride {:#x})",
                 MAX_PLAYERS, PLAYER_STRIDE);
}

void CSceneSoccer::on_update(float dt) {
    elapsed_time_ += dt;

    // Dans nie.exe, CSoccerStateMachine gere les transitions entre phases.
    // Chaque joueur occupe PLAYER_STRIDE (0x570 = 1392) octets.
    // Chaque equipe occupe TEAM_STRIDE (0x1028) octets.
    // Gravite de la balle : 2.0f (BallComponent).
    spdlog::trace("[CSceneSoccer] Update phase={} match={} elapsed={:.2f}",
                  phase_, match_id_, elapsed_time_);
}

void CSceneSoccer::on_draw() {
    // 13 passes de rendu, incluant les personnages, la carte, les effets.
    spdlog::trace("[CSceneSoccer] Draw phase={}", phase_);
}

void CSceneSoccer::on_exit() {
    active_ = false;
    spdlog::info("[CSceneSoccer] Sortie du match (phase={})", phase_);
}

// ── CSceneSoccerTraining ─────────────────────────────────────────────

void CSceneSoccerTraining::on_enter() {
    active_ = true;
    elapsed_time_ = 0.f;
    training_type_ = 0;
    spdlog::info("[CSceneSoccerTraining] Entree en mode entrainement");
}

void CSceneSoccerTraining::on_update(float dt) {
    elapsed_time_ += dt;
    spdlog::trace("[CSceneSoccerTraining] Update type={} elapsed={:.2f}",
                  training_type_, elapsed_time_);
}

void CSceneSoccerTraining::on_draw() {
    spdlog::trace("[CSceneSoccerTraining] Draw type={}", training_type_);
}

void CSceneSoccerTraining::on_exit() {
    active_ = false;
    spdlog::info("[CSceneSoccerTraining] Sortie du mode entrainement");
}

} // namespace game
