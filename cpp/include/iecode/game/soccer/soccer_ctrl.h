#pragma once

/// @file soccer_ctrl.h
/// CSoccerCtrlBase — base du controleur de match soccer.
/// CSoccerCtrl — controleur principal du match.
/// Classes RTTI : game::CSoccerCtrlBase, game::CSoccerCtrl.

#include <cstdint>
#include <string_view>

namespace game {

/// Actions possibles d'un joueur de foot.
enum class SoccerAction : uint8_t {
    NONE    = 0,
    PASS    = 1,   // Passe
    SHOOT   = 2,   // Tir
    DRIBBLE = 3,   // Dribble
    TACKLE  = 4,   // Tacle
    CROSS   = 5,   // Centre
    LOB     = 6,   // Lob
    SPRINT  = 7,   // Sprint
    THROUGH = 8,   // Passe en profondeur
};

/// Retourne le nom lisible d'une action.
[[nodiscard]] constexpr std::string_view soccer_action_name(SoccerAction action) {
    switch (action) {
    case SoccerAction::NONE:    return "None";
    case SoccerAction::PASS:    return "Pass";
    case SoccerAction::SHOOT:   return "Shoot";
    case SoccerAction::DRIBBLE: return "Dribble";
    case SoccerAction::TACKLE:  return "Tackle";
    case SoccerAction::CROSS:   return "Cross";
    case SoccerAction::LOB:     return "Lob";
    case SoccerAction::SPRINT:  return "Sprint";
    case SoccerAction::THROUGH: return "Through";
    }
    return "Unknown";
}

/// Nombre max de slots d'action par joueur (stride 0x120).
inline constexpr uint32_t MAX_ACTION_SLOTS = 32;

/// Base du controleur de match — interface commune pour le joueur et l'IA.
struct CSoccerCtrlBase {
    virtual ~CSoccerCtrlBase() = default;

    /// Mise a jour du controleur.
    virtual void update(float /*dt*/) {}

    /// Indique si le controleur est actif.
    [[nodiscard]] virtual bool is_active() const { return active_; }

    /// Nom de la classe (pour debug/logging).
    [[nodiscard]] virtual std::string_view class_name() const { return "CSoccerCtrlBase"; }

    uint32_t team_id_    = 0;
    bool     active_     = false;
};

/// Controleur principal du match — gere l'input joueur et
/// les commandes de jeu (passe, tir, dribble, tacle, etc.).
struct CSoccerCtrl : CSoccerCtrlBase {
    void update(float dt) override;
    [[nodiscard]] std::string_view class_name() const override { return "CSoccerCtrl"; }

    /// Selectionne un personnage par son ID.
    void select_chara(uint32_t chara_id);

    /// Execute une action de jeu.
    void execute_action(SoccerAction action);

    /// Verifie si le joueur est dans la zone de tir (pres du but adverse).
    [[nodiscard]] bool is_in_shoot_zone() const;

    /// Verifie si le joueur est dans la zone de penalty.
    [[nodiscard]] bool is_in_penalty_zone() const;

    uint32_t     selected_chara_id_ = 0;   // ID du personnage selectionne
    uint32_t     target_chara_id_   = 0;   // ID de la cible (passe)
    SoccerAction current_action_    = SoccerAction::NONE;
    bool         is_sprinting_      = false;
    bool         is_tackling_       = false;

    /// Position du joueur selectionne (mise a jour par le systeme).
    float player_x_ = 0.f;
    float player_z_ = 0.f;

    /// Dimensions du terrain (demi-longueur et demi-largeur).
    float field_half_length_ = 52.5f;
    float field_half_width_  = 34.f;
};

} // namespace game
