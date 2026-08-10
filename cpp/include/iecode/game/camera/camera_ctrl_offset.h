#pragma once

/// @file camera_ctrl_offset.h
/// CCameraCtrlOffset — camera applicant un offset additif ou absolu
/// a la position d'une camera de poursuite existante.
///
/// Classe RTTI : game::CCameraCtrlOffset.
/// Heritage : game::CCameraCtrlChaseBase.
/// Usage : decaler la camera lors d'un evenement, effet de vent, etc.

#include "camera_ctrl_chase_base.h"

namespace game {

/// Camera applicant un offset (additif ou absolu) sur la position.
/// Le flag additive_offset_ de la base controle le mode :
///   - 0 : l'offset remplace la position
///   - 1 : l'offset s'ajoute a la position calculee
struct CCameraCtrlOffset : CCameraCtrlChaseBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view ctrl_name() const override {
        return "CCameraCtrlOffset";
    }

    glm::vec3 offset_pos_    = {0.f, 0.f, 0.f};
    glm::vec3 offset_target_ = {0.f, 0.f, 0.f};
    float     blend_speed_   = 6.f;
};

} // namespace game
