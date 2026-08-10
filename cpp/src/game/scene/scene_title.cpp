/// @file scene_title.cpp
/// Implementation de CSceneTitle — ecran titre du jeu.
/// Phases : Logo (0), TitleScreen (1), PressStart (2).

#include "iecode/game/scene/scene_title.h"

#include <spdlog/spdlog.h>

namespace game {

/// Phases internes de l'ecran titre.
namespace title_phase {
    inline constexpr uint32_t LOGO         = 0;
    inline constexpr uint32_t TITLE_SCREEN = 1;
    inline constexpr uint32_t PRESS_START  = 2;
} // namespace title_phase

void CSceneTitle::on_enter() {
    active_ = true;
    elapsed_time_ = 0.f;
    fade_alpha_ = 0.f;
    press_start_done_ = false;
    set_phase(title_phase::LOGO);
    spdlog::info("[CSceneTitle] Entree — affichage logo Level-5");
}

void CSceneTitle::on_update(float dt) {
    elapsed_time_ += dt;

    switch (phase_) {
    case title_phase::LOGO:
        // Affichage du logo pendant 3 secondes.
        fade_alpha_ = (elapsed_time_ < 1.f)
            ? elapsed_time_       // Fade in pendant 1s
            : 1.f;
        if (elapsed_time_ > 3.f) {
            set_phase(title_phase::TITLE_SCREEN);
        }
        break;

    case title_phase::TITLE_SCREEN:
        // Ecran titre avec animation.
        fade_alpha_ = 1.f;
        // Dans nie.exe, attend une entree utilisateur.
        // Ici on passe a PressStart apres 1 seconde.
        if (elapsed_time_ > 4.f) {
            set_phase(title_phase::PRESS_START);
        }
        break;

    case title_phase::PRESS_START:
        // Attend que l'utilisateur appuie sur Start/Enter.
        // Clignotement du texte "Press Start".
        fade_alpha_ = 0.5f + 0.5f * ((static_cast<int>(elapsed_time_ * 2.f) % 2 == 0) ? 1.f : 0.f);
        break;

    default:
        break;
    }
}

void CSceneTitle::on_draw() {
    // Placeholder — le rendu reel utiliserait CMenuRender (1100 slots).
    spdlog::trace("[CSceneTitle] Draw phase={} alpha={:.2f}", phase_, fade_alpha_);
}

void CSceneTitle::on_exit() {
    active_ = false;
    spdlog::info("[CSceneTitle] Sortie de l'ecran titre");
}

} // namespace game
