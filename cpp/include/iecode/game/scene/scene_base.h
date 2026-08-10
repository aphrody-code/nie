#pragma once

/// @file scene_base.h
/// Classe de base CScene — cycle de vie virtuel pour toutes les scenes.
/// Classe RTTI : game::CScene.

#include <cstdint>
#include <string_view>

namespace game {

/// Forward declarations (evite inclusion circulaire avec scene_manager.h).
enum class SceneId : uint32_t;

/// Classe de base abstraite pour toutes les scenes du jeu.
/// Chaque scene concrete (Title, Soccer, RPG, etc.) herite de CScene.
class CScene {
public:
    virtual ~CScene() = default;

    /// Initialisation de la scene (chargement ressources, setup).
    virtual void on_enter() {}

    /// Mise a jour par frame.
    virtual void on_update(float /*dt*/) {}

    /// Rendu de la scene.
    virtual void on_draw() {}

    /// Nettoyage avant destruction ou depilage.
    virtual void on_exit() {}

    /// Pause (quand une autre scene est empilee par-dessus).
    virtual void on_pause() {}

    /// Reprise (quand la scene au-dessus est depilee).
    virtual void on_resume() {}

    /// Identifiant de la scene.
    [[nodiscard]] virtual SceneId scene_id() const = 0;

    /// Nom RTTI de la scene.
    [[nodiscard]] virtual std::string_view scene_name() const = 0;

    /// Indique si la scene est active (entre on_enter et on_exit).
    [[nodiscard]] bool is_active() const { return active_; }

    /// Phase interne courante (interpretation specifique a chaque scene).
    [[nodiscard]] uint32_t current_phase() const { return phase_; }

    /// Change la phase interne. Les sous-classes peuvent surcharger on_phase_changed().
    void set_phase(uint32_t new_phase);

protected:
    /// Callback appelee quand la phase change (avant mise a jour du champ).
    virtual void on_phase_changed(uint32_t /*old_phase*/, uint32_t /*new_phase*/) {}

    bool active_ = false;
    float elapsed_time_ = 0.f;
    uint32_t phase_ = 0;
};

} // namespace game
