/// @file scene_manager.cpp
/// Implementation du CSceneManager — gestion de la pile de scenes.
/// Singleton — DAT_142138b58 dans nie.exe.

#include "iecode/game/scene/scene_manager.h"
#include "iecode/game/scene/scene_event.h"
#include "iecode/game/scene/scene_menu.h"
#include "iecode/game/scene/scene_root.h"
#include "iecode/game/scene/scene_rpg.h"
#include "iecode/game/scene/scene_rpg_battle.h"
#include "iecode/game/scene/scene_soccer.h"
#include "iecode/game/scene/scene_title.h"
#include "iecode/game/scene/scene_vsroute.h"
#include "iecode/engine/core/event_system.h"

#include <spdlog/spdlog.h>

namespace game {

// ── Factory de scenes ────────────────────────────────────────────────

std::unique_ptr<CScene> create_scene(SceneId id) {
    switch (id) {
    case SceneId::Title:
        return std::make_unique<CSceneTitle>();
    case SceneId::Menu:
        return std::make_unique<CSceneMenu>();
    case SceneId::Rpg:
        return std::make_unique<CSceneRpg>();
    case SceneId::RpgBattle:
        return std::make_unique<CSceneRpgBattle>();
    case SceneId::Soccer:
        return std::make_unique<CSceneSoccer>();
    case SceneId::SoccerTraining:
        return std::make_unique<CSceneSoccerTraining>();
    case SceneId::Event:
        return std::make_unique<CSceneEvent>();
    case SceneId::VSRoute:
        return std::make_unique<CSceneVSRoute>();
    }
    spdlog::error("SceneId inconnu : {}", static_cast<uint32_t>(id));
    return nullptr;
}

// ── Singleton ────────────────────────────────────────────────────────

CSceneManager& CSceneManager::instance() {
    static CSceneManager mgr;
    return mgr;
}

// ── Push / Pop / Switch ──────────────────────────────────────────────

void CSceneManager::push_scene(SceneId id) {
    auto scene = create_scene(id);
    if (!scene) {
        spdlog::error("Impossible de creer la scene {}", scene_id_name(id));
        return;
    }
    push_scene(std::move(scene));
}

void CSceneManager::push_scene(std::unique_ptr<CScene> scene) {
    if (!scene) {
        spdlog::error("push_scene appelee avec un pointeur null");
        return;
    }

    // Met en pause la scene courante (si elle existe).
    if (!scene_stack_.empty()) {
        auto* top = scene_stack_.back().get();
        spdlog::debug("[SceneManager] Pause de {}", top->scene_name());
        top->on_pause();
    }

    const auto name = scene->scene_name();
    const auto id   = scene->scene_id();

    spdlog::info("[SceneManager] Push {} (stack depth: {})",
                 name, scene_stack_.size() + 1);

    // Initialise et active la nouvelle scene.
    scene->on_enter();
    scene_stack_.push_back(std::move(scene));

    // Emet l'evenement de chargement.
    lives::EventSystem::fire(
        lives::EventType::SCENE_LOAD,
        static_cast<uint64_t>(id));
}

void CSceneManager::pop_scene() {
    if (scene_stack_.empty()) {
        spdlog::warn("[SceneManager] pop_scene sur pile vide");
        return;
    }

    auto& top = scene_stack_.back();
    const auto id   = top->scene_id();
    const auto name = top->scene_name();

    spdlog::info("[SceneManager] Pop {} (stack depth: {})",
                 name, scene_stack_.size() - 1);

    top->on_exit();
    scene_stack_.pop_back();

    // Emet l'evenement de dechargement.
    lives::EventSystem::fire(
        lives::EventType::SCENE_UNLOAD,
        static_cast<uint64_t>(id));

    // Reprend la scene en-dessous (si elle existe).
    if (!scene_stack_.empty()) {
        auto* resumed = scene_stack_.back().get();
        spdlog::debug("[SceneManager] Resume de {}", resumed->scene_name());
        resumed->on_resume();
    }
}

void CSceneManager::switch_scene(SceneId id) {
    auto new_scene = create_scene(id);
    if (!new_scene) {
        spdlog::error("Impossible de creer la scene {}", scene_id_name(id));
        return;
    }

    // Sortir de la scene courante.
    if (!scene_stack_.empty()) {
        auto& top      = scene_stack_.back();
        const auto old_id = top->scene_id();
        spdlog::info("[SceneManager] Switch {} -> {}",
                     top->scene_name(), new_scene->scene_name());

        top->on_exit();
        scene_stack_.pop_back();

        lives::EventSystem::fire(
            lives::EventType::SCENE_UNLOAD,
            static_cast<uint64_t>(old_id));
    }

    // Entrer dans la nouvelle scene.
    new_scene->on_enter();
    scene_stack_.push_back(std::move(new_scene));

    lives::EventSystem::fire(
        lives::EventType::SCENE_TRANSITION,
        static_cast<uint64_t>(id));

    lives::EventSystem::fire(
        lives::EventType::SCENE_LOAD,
        static_cast<uint64_t>(id));
}

// ── Update / Draw ────────────────────────────────────────────────────

void CSceneManager::update(float dt) {
    if (!scene_stack_.empty()) {
        scene_stack_.back()->on_update(dt);
    }
}

void CSceneManager::draw() {
    if (!scene_stack_.empty()) {
        scene_stack_.back()->on_draw();
    }
}

// ── Accesseurs ───────────────────────────────────────────────────────

CScene* CSceneManager::current_scene() const {
    if (scene_stack_.empty()) {
        return nullptr;
    }
    return scene_stack_.back().get();
}

SceneId CSceneManager::current_scene_id() const {
    if (scene_stack_.empty()) {
        return SceneId::Title; // Valeur par defaut.
    }
    return scene_stack_.back()->scene_id();
}

bool CSceneManager::has_scene() const {
    return !scene_stack_.empty();
}

size_t CSceneManager::scene_count() const {
    return scene_stack_.size();
}

void CSceneManager::clear() {
    // Depile toutes les scenes dans l'ordre inverse (LIFO).
    while (!scene_stack_.empty()) {
        pop_scene();
    }
    spdlog::info("[SceneManager] Pile de scenes videe");
}

} // namespace game
