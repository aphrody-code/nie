/// @file scene_rpg_battle.cpp
/// Implementation de CSceneRpgBattle — combats RPG (mini-jeux soccer).
/// 9 types de combat : Shoot, Dribble, Dance, Lifting, Scramble,
/// SledDash, StairsRace, BallTrapFielder, BallTrapKeeper.

#include "iecode/game/scene/scene_rpg_battle.h"

#include <spdlog/spdlog.h>

namespace game {

/// Types de combat RPG (utilises comme phases internes).
namespace rpg_battle_type {
    inline constexpr uint32_t NONE                = 0;
    inline constexpr uint32_t SHOOT               = 1;
    inline constexpr uint32_t DRIBBLE             = 2;
    inline constexpr uint32_t DANCE               = 3;
    inline constexpr uint32_t LIFTING             = 4;
    inline constexpr uint32_t SCRAMBLE            = 5;
    inline constexpr uint32_t SLED_DASH           = 6;
    inline constexpr uint32_t STAIRS_RACE         = 7;
    inline constexpr uint32_t BALL_TRAP_FIELDER   = 8;
    inline constexpr uint32_t BALL_TRAP_KEEPER    = 9;
} // namespace rpg_battle_type

void CSceneRpgBattle::on_enter() {
    active_ = true;
    elapsed_time_ = 0.f;
    battle_active_ = true;
    set_phase(rpg_battle_type::NONE);
    spdlog::info("[CSceneRpgBattle] Entree — combat RPG id={}",
                 battle_id_);
}

void CSceneRpgBattle::on_update(float dt) {
    elapsed_time_ += dt;

    if (!battle_active_) {
        return;
    }

    // Dans nie.exe, CRpgBattleStateMachine dispatch vers :
    // - CRpgBattleShootTurnManager
    // - CRpgBattleDribbleTurnManager
    // - CRpgBattleDanceTurnManager
    // - CRpgBattleLiftingTurnManager
    // - CRpgBattleScrambleTurnManager
    // - CRpgBattleSledDashTurnManager
    // - CRpgBattleStairsRaceTurnManager
    // - CRpgBattleBallTrapFielderTurnManager
    // - CRpgBattleBallTrapKeeperTurnManager
    spdlog::trace("[CSceneRpgBattle] Update battle_type={} elapsed={:.2f}",
                  phase_, elapsed_time_);
}

void CSceneRpgBattle::on_draw() {
    spdlog::trace("[CSceneRpgBattle] Draw battle_type={}", phase_);
}

void CSceneRpgBattle::on_exit() {
    active_ = false;
    battle_active_ = false;
    spdlog::info("[CSceneRpgBattle] Sortie du combat RPG id={}",
                 battle_id_);
}

} // namespace game
