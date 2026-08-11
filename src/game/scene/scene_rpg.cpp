/// @file scene_rpg.cpp
/// Implementation de CSceneRpg — mode RPG/aventure.
/// 33 phases identifiees dans nie.exe (Phase010 a Phase910 + Post/Prev).

#include "iecode/game/scene/scene_rpg.h"

#include <spdlog/spdlog.h>

namespace game {

void CSceneRpg::on_enter() {
    active_ = true;
    elapsed_time_ = 0.f;
    current_map_id_ = 0;
    area_id_ = 0;
    set_phase(static_cast<uint32_t>(RpgScenePhase::Phase010));
    spdlog::info("[CSceneRpg] Entree — debut du mode histoire (Phase010)");
}

void CSceneRpg::on_update(float dt) {
    elapsed_time_ += dt;

    // Dans nie.exe, CSceneRpg gere :
    // - Navigation sur la carte (CCharaMoveCtrl)
    // - Dialogues PNJ (CBaseNpcController)
    // - Transitions vers les combats (CSceneRpgBattle)
    // - Chargement/dechargement de zones (GDSMapConfig)
    spdlog::trace("[CSceneRpg] Update phase={} map={} area={}",
                  phase_, current_map_id_, area_id_);
}

void CSceneRpg::on_draw() {
    // 13 passes de rendu (00_UI_Before -> 61_PostMenuEndDraw).
    spdlog::trace("[CSceneRpg] Draw phase={}", phase_);
}

void CSceneRpg::on_exit() {
    active_ = false;
    spdlog::info("[CSceneRpg] Sortie du mode RPG (phase={})", phase_);
}

void CSceneRpg::set_rpg_phase(RpgScenePhase phase) {
    set_phase(static_cast<uint32_t>(phase));
}

void CSceneRpg::on_phase_changed(uint32_t old_phase, uint32_t new_phase) {
    spdlog::info("[CSceneRpg] Transition de phase RPG : {} -> {}",
                 old_phase, new_phase);
    // Dans nie.exe, chaque phase charge des ressources differentes :
    // - Phase010-090 : tutorial / debut du jeu
    // - Phase100-200 : progression principale
    // - Phase300-320 : chapitres avances
    // - Phase900-910 : fin du jeu
    // - Post100/Prev100 : post-game
}

} // namespace game
