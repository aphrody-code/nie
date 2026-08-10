/// @file gdd_quest_mission.cpp
/// Implementation des donnees de quetes et missions —
/// CGDDQuestStatus, CGDDMissionStatus.

#include "iecode/game/gdd/gdd_quest_mission.h"

#include <spdlog/spdlog.h>

namespace game {

// ── Fonctions utilitaires pour CGDDQuestStatus ─────────────────────

/// Avance la quete a la phase suivante.
/// @return true si la phase a ete avancee.
[[nodiscard]] bool advance_quest_phase(CGDDQuestStatus& quest) {
    if (quest.completed || quest.failed) {
        return false;
    }
    ++quest.phase;
    spdlog::debug("advance_quest_phase: quete {} -> phase {}", quest.quest_id, quest.phase);
    return true;
}

/// Complete une quete.
void complete_quest(CGDDQuestStatus& quest) {
    quest.completed = true;
    spdlog::info("complete_quest: quete {} terminee", quest.quest_id);
}

/// Echoue une quete.
void fail_quest(CGDDQuestStatus& quest) {
    quest.failed = true;
    spdlog::info("fail_quest: quete {} echouee", quest.quest_id);
}

// ── Fonctions utilitaires pour CGDDMissionStatus ───────────────────

/// Incremente la progression d'une mission.
/// @return true si la mission est completee.
[[nodiscard]] bool increment_mission_progress(CGDDMissionStatus& mission, uint32_t amount) {
    if (mission.completed) {
        return true;
    }

    mission.progress += amount;

    if (mission.target > 0 && mission.progress >= mission.target) {
        mission.progress  = mission.target;
        mission.completed = true;
        spdlog::info("increment_mission_progress: mission {} completee", mission.mission_id);
        return true;
    }
    return false;
}

/// Marque la recompense comme recue.
void claim_mission_reward(CGDDMissionStatus& mission) {
    if (mission.completed && !mission.rewarded) {
        mission.rewarded = true;
        spdlog::debug("claim_mission_reward: mission {} recompensee", mission.mission_id);
    }
}

} // namespace game
