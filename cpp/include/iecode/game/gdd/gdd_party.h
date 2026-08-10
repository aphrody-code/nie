#pragma once

/// @file gdd_party.h
/// Etat de l'equipe et du combat RPG — formation, membres, phase.

#include "gdd_serialize.h"
#include <vector>
#include <array>
#include <cstdint>

namespace game {

/// Statut de l'equipe — CGDDPartyStatus.
/// Slots des membres de l'equipe et formation active.
struct CGDDPartyStatus : CGDDSerialize {
    static constexpr uint32_t MAX_MEMBERS = 16;

    uint32_t formation_id = 0;
    std::array<uint32_t, MAX_MEMBERS> member_ids = {};  ///< IDs des personnages (0 = vide)
    uint32_t active_count = 0;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDPartyStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Etat de phase du jeu — CGDDPhaseStatus.
struct CGDDPhaseStatus : CGDDSerialize {
    uint32_t phase_id      = 0;
    uint32_t chapter       = 0;
    uint32_t sub_phase     = 0;
    bool     phase_cleared = false;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDPhaseStatus"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

/// Donnees de combat RPG — CGDDRpgBattleData.
struct CGDDRpgBattleData : CGDDSerialize {
    uint32_t battle_id     = 0;
    uint32_t turn_count    = 0;
    uint32_t score_team_a  = 0;
    uint32_t score_team_b  = 0;
    bool     is_won        = false;

    [[nodiscard]] std::string_view gdd_type_name() const override { return "CGDDRpgBattleData"; }
    bool serialize(std::vector<uint8_t>&) const override { return true; }
    bool deserialize(const std::vector<uint8_t>&) override { return true; }
};

} // namespace game
