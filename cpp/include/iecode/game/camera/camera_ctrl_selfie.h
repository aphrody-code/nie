#pragma once

/// @file camera_ctrl_selfie.h
/// CCameraCtrlSelfie — camera selfie (mode photo).
/// Classe RTTI : game::CCameraCtrlSelfie.

#include "camera_ctrl_base.h"

namespace game {

/// Camera selfie — utilisee dans le mode photo du jeu.
/// L'utilisateur controle librement l'angle et le zoom.
struct CCameraCtrlSelfie : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlSelfie"; }

    float yaw_        = 0.f;
    float pitch_      = 0.f;
    float distance_   = 2.f;
    float min_dist_   = 0.5f;
    float max_dist_   = 5.f;
};

} // namespace game
