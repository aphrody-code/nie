#pragma once

/// @file gdd_quest_mission.h
/// Etat des quetes et missions — progression, phases, completion.

#include "gdd_serialize.h"
#include <vector>
#include <cstdint>

namespace game {

/// Statut d'une quete — CGDDQuestStatus.
struct CGDDQuestStatus : CGDDSerialize {
    uint32_t quest_id   = 0;
    uint32_t phase      = 0;     ///< Phase courante de la quete
    bool     completed  = false;
    bool     failed     = false;
    bool     discovered = false; ///< Quete visible dans le journal

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDQuestStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Statut d'une mission — CGDDMissionStatus.
struct CGDDMissionStatus : CGDDSerialize {
    uint32_t mission_id = 0;
    uint32_t progress   = 0;     ///< Progression (0-100 ou compteur)
    uint32_t target     = 0;     ///< Objectif a atteindre
    bool     completed  = false;
    bool     rewarded   = false;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDMissionStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

} // namespace game
