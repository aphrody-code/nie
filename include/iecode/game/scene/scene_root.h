#pragma once

/// @file scene_root.h
/// CSceneRoot — scene racine, point d'entree de la hierarchie.
/// CSceneMain — scene principale du jeu (hub de navigation).
/// Classes RTTI : game::CSceneRoot, game::CSceneMain.

#include "scene_base.h"
#include "scene_manager.h"

namespace game {

/// Scene racine — premiere scene creee au lancement du jeu.
/// Initialise les sous-systemes (rendu, audio, VFS) avant de
/// transitionner vers CSceneTitle.
class CSceneRoot : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::Title; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneRoot"; }

    /// Indique si l'initialisation est terminee.
    [[nodiscard]] bool is_init_complete() const { return init_complete_; }

private:
    bool init_complete_ = false;
};

/// Scene principale — hub de navigation entre les differents modes de jeu.
/// Gere les transitions vers Soccer, RPG, Event, VSRoute, etc.
class CSceneMain : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::Menu; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneMain"; }

    /// Demande une transition vers une autre scene.
    void request_transition(SceneId target);

    /// Retourne la scene cible demandee (SceneId::Menu si aucune).
    [[nodiscard]] SceneId pending_target() const { return pending_target_; }

private:
    SceneId pending_target_ = SceneId::Menu;
};

} // namespace game
