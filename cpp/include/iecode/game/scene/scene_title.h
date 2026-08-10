#pragma once

/// @file scene_title.h
/// CSceneTitle — ecran titre du jeu.
/// Classe RTTI : game::CSceneTitle.

#include "scene_base.h"
#include "scene_manager.h"

namespace game {

/// Ecran titre du jeu.
/// Gere l'affichage du logo, l'ecran de pression de touche,
/// et la transition vers le menu principal.
class CSceneTitle : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_draw() override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::Title; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneTitle"; }

    /// Indique si l'utilisateur a appuye sur une touche pour continuer.
    [[nodiscard]] bool is_press_start_done() const { return press_start_done_; }

private:
    bool press_start_done_ = false;
    float fade_alpha_ = 0.f;
};

} // namespace game
