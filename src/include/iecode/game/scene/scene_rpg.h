#pragma once

/// @file scene_rpg.h
/// CSceneRpg — scene RPG avec ses 35 phases connues.
/// Classe RTTI : game::CSceneRpg.
/// Les phases correspondent aux differentes etapes de la progression
/// du mode histoire (Phase010 = debut, Phase910 = fin).

#include "scene_base.h"
#include "scene_manager.h"
#include <cstdint>

namespace game {

/// Phases de la scene RPG.
/// Numerotation extraite des variantes CSceneRpg* dans nie.exe.
/// Les noms Phase0XX correspondent a des etapes de la progression.
enum class RpgScenePhase : uint32_t {
    Phase010 = 10,
    Phase020 = 20,
    Phase025 = 25,
    Phase030 = 30,
    Phase040 = 40,
    Phase070 = 70,
    Phase080 = 80,
    Phase085 = 85,
    Phase090 = 90,
    Phase100 = 100,
    Phase105 = 105,
    Phase110 = 110,
    Phase120 = 120,
    Phase125 = 125,
    Phase130 = 130,
    Phase140 = 140,
    Phase150 = 150,
    Phase160 = 160,
    Phase165 = 165,
    Phase170 = 170,
    Phase175 = 175,
    Phase180 = 180,
    Phase190 = 190,
    Phase200 = 200,
    Phase210 = 210,
    Phase250 = 250,
    Phase300 = 300,
    Phase310 = 310,
    Phase320 = 320,
    Phase900 = 900,
    Phase910 = 910,
    Post100  = 1100,   // Post-jeu phase 100
    Prev100  = 1200,   // Pre-jeu phase 100
};

/// Scene RPG — mode histoire du jeu.
/// Gere la carte du monde, les dialogues, les rencontres PNJ,
/// et les transitions vers les combats (CSceneRpgBattle).
class CSceneRpg : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_draw() override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::Rpg; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneRpg"; }

    /// Phase RPG courante (typee).
    [[nodiscard]] RpgScenePhase rpg_phase() const {
        return static_cast<RpgScenePhase>(phase_);
    }

    /// Change la phase RPG.
    void set_rpg_phase(RpgScenePhase phase);

    /// Identifiant de la carte courante.
    [[nodiscard]] uint32_t current_map_id() const { return current_map_id_; }

protected:
    void on_phase_changed(uint32_t old_phase, uint32_t new_phase) override;

private:
    uint32_t current_map_id_ = 0;
    uint32_t area_id_ = 0;
};

} // namespace game
