#pragma once

/// @file camera_ctrl_shake.h
/// CCameraCtrlShake — camera avec effet de tremblement.
/// Classe RTTI : game::CCameraCtrlShake.

#include "camera_ctrl_base.h"

namespace game {

/// Camera avec tremblement — utilisee pour les impacts, tirs speciaux.
struct CCameraCtrlShake : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlShake"; }

    float amplitude_   = 0.5f;   // Amplitude du tremblement (metres)
    float frequency_   = 10.f;   // Frequence du tremblement (Hz)
    float duration_    = 0.5f;   // Duree totale (secondes)
    float elapsed_     = 0.f;    // Temps ecoule
    float decay_       = 2.f;    // Facteur d'attenuation exponentielle
    bool  is_active_   = false;

    CCameraCtrlBase* source_ = nullptr;
};

} // namespace game
