#pragma once

/// @file rpg_target_manager.h
/// CRpgTargetManager — gestionnaire de cibles dans les combats RPG.
/// Classe RTTI : game::CRpgTargetManager.

#include <cstdint>

namespace game {

/// Gestionnaire de cibles — selection et gestion des cibles de combat.
struct CRpgTargetManager {
    virtual ~CRpgTargetManager() = default;

    /// Selectionne la cible suivante.
    virtual void select_next();

    /// Selectionne la cible precedente.
    virtual void select_prev();

    /// Confirme la cible selectionnee.
    virtual void confirm();

    uint32_t target_count_     = 0;       // Nombre de cibles disponibles
    uint32_t selected_index_   = 0;       // Index de la cible selectionnee
    uint32_t selected_chara_id_ = 0;      // ID du personnage cible
    bool     has_selection_    = false;
};

} // namespace game
