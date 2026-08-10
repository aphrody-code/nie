#pragma once

/// @file rpg_battle_dribble.h
/// CRpgBattleDribbleTurnManager — gestionnaire de tour pour les dribbles.
/// Classe RTTI : game::CRpgBattleDribbleTurnManager.

#include "rpg_battle_turn_manager.h"

namespace game {

/// Gestionnaire de tour de dribble — le joueur doit esquiver les defenseurs.
/// Segmente en plusieurs sections de dribble a traverser.
/// Opposition 1v1 : Control (attaquant) vs Body (defenseur).
struct CRpgBattleDribbleTurnManager : CRpgBattleTurnManager {
    void on_turn_start() override;
    void update(float dt) override;
    void on_turn_end() override;
    [[nodiscard]] std::string_view battle_type_name() const override { return "Dribble"; }

    /// Evalue le resultat d'un segment de dribble (control vs body).
    void evaluate_segment();

    uint32_t total_segments_    = 3;     // Nombre de segments a traverser
    uint32_t current_segment_   = 0;     // Segment courant
    uint32_t successful_dodges_ = 0;     // Nombre d'esquives reussies
    float    progress_          = 0.f;   // Progression dans le segment [0, 1]
    float    defender_speed_    = 5.f;   // Vitesse du defenseur
    uint32_t attacker_control_  = 50;    // Stat control de l'attaquant
    uint32_t defender_body_     = 50;    // Stat body du defenseur
    Element  attacker_element_  = Element::None;
    Element  defender_element_  = Element::None;
    bool     is_dodging_        = false;
};

} // namespace game
