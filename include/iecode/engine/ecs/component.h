#pragma once

/// @file component.h
/// Composant ECS du moteur Level-5 (lives::ecs::Component).
/// Bloc de donnees/comportement attachable a un Actor.
/// Inspire d'Overload Engine, adapte a l'architecture RTTI de nie.exe.

#include <cstdint>
#include <string_view>
#include <typeindex>

namespace lives::ecs {

// Declaration anticipee — Actor possede des Components.
class Actor;

/// Categorie de composant pour le routage rapide vers FastAccessComponents.
/// Permet d'eviter dynamic_cast dans le hot path d'enregistrement.
/// Les composants polyvalents (Behaviour, scripts) restent en GENERIC.
enum class ComponentKind : uint8_t {
    GENERIC        = 0,  ///< Pas de routage rapide
    MODEL_RENDERER = 1,  ///< Drawable mesh (gmdCObjModel...)
    CAMERA         = 2,  ///< Camera (lives::CCamera)
    LIGHT          = 3,  ///< Source de lumiere
    SOCCER_PLAYER  = 4,  ///< Joueur de foot (game::CSoccerPlayer)
    NPC            = 5,  ///< Personnage NPC (game::CNpc...)
};

/// Composant attachable a un Actor.
/// Fournit des callbacks de cycle de vie virtuels que les sous-classes
/// specialisent pour ajouter des comportements specifiques.
class Component {
public:
    Component() = default;
    virtual ~Component() = default;

    // Non-copiable, deplacable
    Component(const Component&) = delete;
    Component& operator=(const Component&) = delete;
    Component(Component&&) noexcept = default;
    Component& operator=(Component&&) noexcept = default;

    // ── Cycle de vie ─────────────────────────────────────────────────
    // Callbacks appeles par l'Actor proprietaire dans l'ordre :
    //   on_awake -> on_start -> on_update/on_late_update (boucle) -> on_destroy

    /// Appele une seule fois a la creation, avant on_start().
    virtual void on_awake() {}

    /// Appele une seule fois apres on_awake(), avant la premiere frame.
    virtual void on_start() {}

    /// Appele chaque frame (dt = delta time en secondes).
    virtual void on_update(float /*dt*/) {}

    /// Appele chaque frame apres tous les on_update().
    virtual void on_late_update(float /*dt*/) {}

    /// Appele a la destruction de l'Actor ou du Component.
    virtual void on_destroy() {}

    /// Appele quand le composant est active.
    virtual void on_enable() {}

    /// Appele quand le composant est desactive.
    virtual void on_disable() {}

    // ── Accesseurs ───────────────────────────────────────────────────

    /// Retourne l'Actor proprietaire (jamais nul apres attachement).
    [[nodiscard]] Actor* owner() const noexcept { return owner_; }

    /// Etat actif du composant.
    [[nodiscard]] bool is_enabled() const noexcept { return enabled_; }

    /// Active ou desactive le composant avec notification.
    void set_enabled(bool enabled) {
        if (enabled_ == enabled) return;
        enabled_ = enabled;
        if (enabled_) {
            on_enable();
        } else {
            on_disable();
        }
    }

    /// Identifiant de type runtime pour eviter dynamic_cast dans les hot paths.
    [[nodiscard]] virtual std::type_index component_type_id() const {
        return {typeid(*this)};
    }

    /// Categorie pour FastAccessComponents (routage O(1) cote Scene).
    /// Surcharger dans les sous-classes "drawables" (model, camera, light...).
    [[nodiscard]] virtual ComponentKind component_kind() const noexcept {
        return ComponentKind::GENERIC;
    }

    /// Nom lisible du type (debug/logging).
    [[nodiscard]] virtual std::string_view component_name() const {
        return "Component";
    }

private:
    friend class Actor; // Actor gere owner_ a l'attachement.

    Actor* owner_   = nullptr;
    bool   enabled_ = true;
};

} // namespace lives::ecs
