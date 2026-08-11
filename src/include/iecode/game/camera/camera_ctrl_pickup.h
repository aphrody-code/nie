#pragma once

/// @file camera_ctrl_pickup.h
/// CCameraCtrlPickUp — camera pour les sequences de pick-up (ramassage).
/// Classe RTTI : game::CCameraCtrlPickUp.

#include "camera_ctrl_base.h"

namespace game {

/// Camera pick-up — zoom sur un objet ou personnage ramasse/selectionne.
struct CCameraCtrlPickUp : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlPickUp"; }

    glm::vec3 focus_point_  = {0.f, 0.f, 0.f};
    float     zoom_in_      = 3.f;    // Distance rapprochee
    float     zoom_out_     = 10.f;   // Distance eloignee
    float     blend_time_   = 0.5f;   // Duree de la transition zoom
    float     hold_time_    = 1.f;    // Duree de maintien du zoom
    float     elapsed_      = 0.f;
};

} // namespace game
