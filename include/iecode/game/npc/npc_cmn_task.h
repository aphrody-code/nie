#pragma once

/// @file npc_cmn_task.h
/// CCmnTaskNpcController — controleur PNJ pour les taches communes.
/// CCmnTaskNpcData — donnees PNJ pour les taches communes.
/// Classes RTTI : game::CCmnTaskNpcController, game::CCmnTaskNpcData.

#include "npc_base.h"
#include <cstdint>

namespace game {

/// Donnees PNJ pour les taches communes (dialogues, quetes generiques).
struct CCmnTaskNpcData : CBaseNpcData {
    uint32_t task_id          = 0;   // ID de la tache associee
    uint32_t dialogue_id      = 0;   // ID du dialogue
    uint32_t quest_trigger_id = 0;   // ID du declencheur de quete (0 = aucun)
    bool     task_complete    = false;
};

/// Controleur PNJ pour les taches communes.
struct CCmnTaskNpcController : CBaseNpcController {
    void update(float dt) override;
    void interact() override;
    [[nodiscard]] std::string_view controller_name() const override { return "CCmnTaskNpcController"; }

    uint32_t current_task_state_ = 0;
};

} // namespace game
