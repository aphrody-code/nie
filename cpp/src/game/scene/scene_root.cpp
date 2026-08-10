/// @file scene_root.cpp
/// Implementation de CSceneRoot et CSceneMain.
/// CSceneRoot initialise les sous-systemes puis transite vers Title.
/// CSceneMain sert de hub de navigation entre les modes de jeu.

#include "iecode/game/scene/scene_root.h"

#include <spdlog/spdlog.h>

namespace game {

// ── CSceneRoot ───────────────────────────────────────────────────────

void CSceneRoot::on_enter() {
    active_ = true;
    spdlog::info("[CSceneRoot] Initialisation des sous-systemes...");
    // Dans nie.exe, initialise le VFS, l'audio CRI, PhysX, le rendu D3D11.
    // Ici on simule la completion immediate.
    init_complete_ = true;
    spdlog::info("[CSceneRoot] Initialisation terminee");
}

void CSceneRoot::on_update(float dt) {
    elapsed_time_ += dt;

    // Transite vers CSceneTitle une fois l'init complete.
    if (init_complete_) {
        spdlog::debug("[CSceneRoot] Pret a transiter vers Title");
    }
}

// ── CSceneMain ───────────────────────────────────────────────────────

void CSceneMain::on_enter() {
    active_ = true;
    pending_target_ = SceneId::Menu;
    spdlog::info("[CSceneMain] Entree dans le hub de navigation");
}

void CSceneMain::on_update(float dt) {
    elapsed_time_ += dt;

    // Si une transition est demandee, le SceneManager la gerera.
    if (pending_target_ != SceneId::Menu) {
        spdlog::debug("[CSceneMain] Transition en attente vers {}",
                      scene_id_name(pending_target_));
    }
}

void CSceneMain::on_exit() {
    active_ = false;
    spdlog::info("[CSceneMain] Sortie du hub de navigation");
}

void CSceneMain::request_transition(SceneId target) {
    pending_target_ = target;
    spdlog::info("[CSceneMain] Transition demandee vers {}",
                 scene_id_name(target));
}

} // namespace game
