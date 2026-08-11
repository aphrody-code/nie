#pragma once

/// @file scene_event.h
/// CSceneEvent — scene de cinematiques/evenements.
/// Classe RTTI : game::CSceneEvent.

#include "scene_base.h"
#include "scene_manager.h"
#include <cstdint>

namespace game {

/// Scene d'evenement — cinematiques, dialogues, cutscenes.
/// Pilotee par GDSEventPlayConfig et les scripts Lua associes.
class CSceneEvent : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_draw() override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::Event; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneEvent"; }

    /// Identifiant de l'evenement en cours.
    [[nodiscard]] uint32_t event_id() const { return event_id_; }

    /// Indique si l'evenement peut etre skippe.
    [[nodiscard]] bool is_skippable() const { return skippable_; }

private:
    uint32_t event_id_ = 0;
    bool skippable_ = true;
    bool skip_requested_ = false;
};

} // namespace game
