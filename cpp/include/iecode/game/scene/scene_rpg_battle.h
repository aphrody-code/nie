#pragma once

/// @file scene_rpg_battle.h
/// CSceneRpgBattle — scene de combat RPG (mini-jeux soccer).
/// Classe RTTI : game::CSceneRpgBattle.

#include "scene_base.h"
#include "scene_manager.h"
#include <cstdint>

namespace game {

/// Scene de combat RPG — contient les mini-jeux de type soccer
/// (shoot, dribble, dance, lifting, scramble, etc.).
/// Utilise CRpgBattleStateMachine pour gerer les tours de jeu.
class CSceneRpgBattle : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_draw() override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::RpgBattle; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneRpgBattle"; }

    /// Identifiant du combat en cours.
    [[nodiscard]] uint32_t battle_id() const { return battle_id_; }

    /// Indique si le combat est en cours.
    [[nodiscard]] bool is_battle_active() const { return battle_active_; }

private:
    uint32_t battle_id_ = 0;
    bool battle_active_ = false;
};

} // namespace game
