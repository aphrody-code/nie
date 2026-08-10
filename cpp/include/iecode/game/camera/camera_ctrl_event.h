#pragma once

/// @file camera_ctrl_event.h
/// CCameraCtrlEvent — camera scriptee pour les cinematiques.
/// Classe RTTI : game::CCameraCtrlEvent.

#include "camera_ctrl_base.h"

namespace game {

/// Camera d'evenement — pilotee par les scripts Lua des cutscenes.
/// Supporte les keyframes de position/rotation/FOV.
struct CCameraCtrlEvent : CCameraCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlEvent"; }

    uint32_t event_id_       = 0;
    float    timeline_pos_   = 0.f;   // Position sur la timeline (secondes)
    float    timeline_len_   = 0.f;   // Duree totale de la sequence
    bool     is_playing_     = false;
    bool     is_looping_     = false;
};

} // namespace game
