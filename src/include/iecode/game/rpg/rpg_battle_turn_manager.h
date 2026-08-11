#pragma once

/// @file rpg_battle_turn_manager.h
/// CRpgBattleTurnManager — base des gestionnaires de tours de combat RPG.
/// CRpgBattleStateMachine — machine a etats du combat RPG.
/// Classes RTTI : game::CRpgBattleTurnManager, game::CRpgBattleStateMachine.

#include "../gds/gds_types.h"
#include <cstdint>
#include <string_view>
#include <vector>
#include <algorithm>

namespace game {

/// Etats du combat RPG.
enum class RpgBattlePhase : uint8_t {
    Init       = 0,
    TurnStart  = 1,
    PlayerInput = 2,
    Execute    = 3,
    Result     = 4,
    TurnEnd    = 5,
    Finish     = 6,
};

/// Nom lisible d'une phase de combat.
[[nodiscard]] constexpr std::string_view rpg_battle_phase_name(RpgBattlePhase p) {
    switch (p) {
    case RpgBattlePhase::Init:        return "Init";
    case RpgBattlePhase::TurnStart:   return "TurnStart";
    case RpgBattlePhase::PlayerInput: return "PlayerInput";
    case RpgBattlePhase::Execute:     return "Execute";
    case RpgBattlePhase::Result:      return "Result";
    case RpgBattlePhase::TurnEnd:     return "TurnEnd";
    case RpgBattlePhase::Finish:      return "Finish";
    }
    return "Unknown";
}

// Element enum is in gds/gds_types.h

/// Calcule le bonus elementaire attaquant vs defenseur.
/// @return 1.5f si avantage, 0.75f si desavantage, 1.0f sinon.
[[nodiscard]] constexpr float element_bonus(Element attacker, Element defender) {
    if (attacker == Element::None || defender == Element::None) return 1.0f;
    // Cycle : Fire > Wood > Earth > Wind > Fire
    // Fire(0) > Wood(1) > Earth(2) > Wind(3) > Fire(0)
    uint8_t a = static_cast<uint8_t>(attacker);
    uint8_t d = static_cast<uint8_t>(defender);
    if ((a + 1) % 4 == d) return 1.5f;  // Avantage
    if ((d + 1) % 4 == a) return 0.75f; // Desavantage
    return 1.0f;
}

/// Action dans la file d'attente du combat RPG.
struct RpgBattleAction {
    uint32_t chara_id   = 0;    // ID du personnage qui agit
    uint32_t target_id  = 0;    // ID de la cible
    uint32_t skill_id   = 0;    // ID de la competence utilisee (0 = attaque normale)
    uint32_t speed      = 0;    // Vitesse du personnage (pour l'ordre d'action)
    bool     is_player  = true; // Action joueur vs ennemi
};

/// Machine a etats du combat RPG.
struct CRpgBattleStateMachine {
    RpgBattlePhase current_phase_ = RpgBattlePhase::Init;
    RpgBattlePhase prev_phase_    = RpgBattlePhase::Init;
    uint32_t       turn_count_    = 0;
    float          phase_timer_   = 0.f;

    void transition(RpgBattlePhase next);

    /// Mise a jour du timer.
    void update(float dt);

    /// Remet a zero.
    void reset();

    /// Verifie si le combat est termine.
    [[nodiscard]] bool is_finished() const {
        return current_phase_ == RpgBattlePhase::Finish;
    }
};

/// Base des gestionnaires de tours de combat RPG.
/// Chaque mini-jeu (shoot, dribble, dance, etc.) herite de cette classe.
struct CRpgBattleTurnManager {
    virtual ~CRpgBattleTurnManager() = default;

    /// Initialisation du tour.
    virtual void on_turn_start() {}

    /// Mise a jour par frame.
    virtual void update(float /*dt*/) {}

    /// Fin du tour.
    virtual void on_turn_end() {}

    /// Nom du type de combat.
    [[nodiscard]] virtual std::string_view battle_type_name() const { return "Base"; }

    /// Indique si le tour est termine.
    [[nodiscard]] virtual bool is_turn_finished() const { return turn_finished_; }

    /// Calcul de degats : puissance vs defense avec bonus elementaire.
    /// @return Degats apres reduction et bonus elementaire.
    [[nodiscard]] static uint32_t calculate_damage(
        uint32_t power, uint32_t defense,
        Element atk_element, Element def_element);

    /// File d'attente des actions, triee par vitesse decroissante.
    std::vector<RpgBattleAction> action_queue_;

    /// Ajoute une action et retrie la file par vitesse decroissante.
    void enqueue_action(const RpgBattleAction& action);

    /// Depile la prochaine action (la plus rapide).
    [[nodiscard]] RpgBattleAction dequeue_action();

    /// Vide la file d'attente.
    void clear_queue();

    uint32_t battle_id_     = 0;
    uint32_t turn_number_   = 0;
    float    turn_timer_    = 0.f;
    bool     turn_finished_ = false;
    bool     player_won_    = false;
};

} // namespace game
