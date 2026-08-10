#pragma once

/// @file scene_soccer.h
/// CSceneSoccer — scene de match soccer.
/// CSceneSoccerTraining — scene d'entrainement soccer.
/// Classes RTTI : game::CSceneSoccer, game::CSceneSoccerTraining.

#include "scene_base.h"
#include "scene_manager.h"
#include <cstdint>

namespace game {

/// Scene de match soccer — matchs complets (11v11).
/// Contient CSoccerStateMachine, CSoccerCtrl, BallComponent.
/// Stride par joueur : 0x570 (1392 bytes), max 58 joueurs.
class CSceneSoccer : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_draw() override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::Soccer; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneSoccer"; }

    /// Stride memoire par joueur.
    static constexpr uint32_t PLAYER_STRIDE = 0x570;

    /// Nombre max de joueurs geres.
    static constexpr uint32_t MAX_PLAYERS = 58;

    /// Stride memoire par equipe.
    static constexpr uint32_t TEAM_STRIDE = 0x1028;

private:
    uint32_t match_id_ = 0;
};

/// Scene d'entrainement soccer — mode libre pour pratiquer.
class CSceneSoccerTraining : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_draw() override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::SoccerTraining; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneSoccerTraining"; }

private:
    uint32_t training_type_ = 0;
};

} // namespace game
