#pragma once

/// @file camera_ctrl_rail.h
/// CCameraCtrlRail — camera sur rail (spline).
/// Classe RTTI : game::CCameraCtrlRail.

#include "camera_ctrl_base.h"
#include <cstdint>

namespace game {

/// Camera sur rail — se deplace le long d'une courbe spline.
/// Utilisee pour les cinematiques de camera et les vues panoramiques.
struct CCameraCtrlRail : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlRail"; }

    float    t_             = 0.f;    // Parametre de position sur la spline [0, 1]
    float    speed_         = 1.f;    // Vitesse de deplacement
    uint32_t spline_index_  = 0;      // Index de la spline dans la liste
    uint32_t point_count_   = 0;      // Nombre de points de controle
    bool     auto_advance_  = true;   // Avance automatiquement
    bool     loop_          = false;
};

} // namespace game
