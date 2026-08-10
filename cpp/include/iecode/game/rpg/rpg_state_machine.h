#pragma once

/// @file rpg_state_machine.h
/// CRpgStateMachine — machine a etats du mode RPG.
/// Classe RTTI : game::CRpgStateMachine.

#include <cstdint>
#include <string_view>

namespace game {

/// Etats de la machine RPG.
enum class RpgPhase : uint32_t {
    Idle             = 0,
    FieldMove        = 1,
    BattleInit       = 2,
    BattleInProgress = 3,
    BattleResult     = 4,
    EventCutscene    = 5,
    MapTransition    = 6,
};

/// Nom lisible d'une phase RPG.
[[nodiscard]] constexpr std::string_view rpg_phase_name(RpgPhase p) {
    switch (p) {
    case RpgPhase::Idle:             return "Idle";
    case RpgPhase::FieldMove:        return "FieldMove";
    case RpgPhase::BattleInit:       return "BattleInit";
    case RpgPhase::BattleInProgress: return "BattleInProgress";
    case RpgPhase::BattleResult:     return "BattleResult";
    case RpgPhase::EventCutscene:    return "EventCutscene";
    case RpgPhase::MapTransition:    return "MapTransition";
    }
    return "Unknown";
}

/// Machine a etats du mode RPG.
/// Gere les transitions entre exploration, combats, evenements.
struct CRpgStateMachine {
    RpgPhase current_phase_ = RpgPhase::Idle;
    RpgPhase prev_phase_    = RpgPhase::Idle;
    uint32_t current_map_id_ = 0;
    uint32_t area_id_        = 0;
    float    phase_timer_    = 0.f;

    /// Effectue une transition vers un nouvel etat.
    void transition(RpgPhase next);

    /// Mise a jour par frame (accumule le timer).
    void update(float dt);

    /// Verifie si la transition est valide.
    [[nodiscard]] bool can_transition_to(RpgPhase next) const;

    /// Remet la machine a zero.
    void reset();

    /// Verifie si on est en combat.
    [[nodiscard]] bool is_in_battle() const {
        return current_phase_ == RpgPhase::BattleInit ||
               current_phase_ == RpgPhase::BattleInProgress ||
               current_phase_ == RpgPhase::BattleResult;
    }

    /// Verifie si on est en exploration.
    [[nodiscard]] bool is_field_move() const {
        return current_phase_ == RpgPhase::FieldMove;
    }
};

} // namespace game
