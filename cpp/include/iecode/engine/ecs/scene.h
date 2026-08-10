#pragma once

/// @file scene.h
/// Scene ECS — ensemble d'Actors avec acces O(1) aux composants drawables.
/// Inspire d'OvCore::SceneSystem::Scene (Overload Engine).
///
/// Le pattern FastAccessComponents permet au SceneRenderer d'iterer
/// directement sur les ModelRenderers / Cameras / Lights sans parcourir
/// la totalite des Actors a chaque frame.

#include "actor.h"
#include "component.h"

#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <vector>

namespace lives::ecs {

/// Vecteurs categorises pour acces O(1) aux composants critiques du rendu.
/// Chaque vecteur est tenu a jour par les callbacks on_component_added /
/// on_component_removed declenches par l'Actor.
struct FastAccessComponents {
    std::vector<Component*> model_renderers;
    std::vector<Component*> cameras;
    std::vector<Component*> lights;
    std::vector<Component*> soccer_players;
    std::vector<Component*> npcs;
};

/// Scene = container d'Actors.
/// Reproduit OvCore::SceneSystem::Scene avec les conventions iecode.
class Scene {
public:
    Scene();
    ~Scene();

    Scene(const Scene&)            = delete;
    Scene& operator=(const Scene&) = delete;
    Scene(Scene&&)                 = delete;
    Scene& operator=(Scene&&)      = delete;

    // ── Cycle de vie (propage a tous les Actors actifs) ─────────────

    /// Reveille tous les Actors (appelle Actor::awake).
    void awake();

    /// Demarre tous les Actors (appelle Actor::start).
    void start();

    /// Met a jour tous les Actors actifs.
    void update(float dt);

    /// Mise a jour tardive de tous les Actors actifs.
    void late_update(float dt);

    /// Detruit tous les Actors marques pour suppression.
    void collect_garbage();

    // ── Gestion des Actors ───────────────────────────────────────────

    /// Cree un Actor possede par la Scene et retourne une reference.
    /// L'Actor est automatiquement lie a la Scene (Actor::scene() == this).
    [[nodiscard]] Actor& create_actor(const std::string& name = "Actor");

    /// Marque un Actor pour destruction (effective au prochain collect_garbage).
    /// @return true si l'Actor appartenait a la Scene.
    bool destroy_actor(Actor& target);

    /// Vue read-only sur tous les Actors de la Scene.
    [[nodiscard]] std::span<const std::unique_ptr<Actor>> actors() const noexcept {
        return actors_;
    }

    /// Trouve le premier Actor par nom (parcours lineaire — O(n)).
    [[nodiscard]] Actor* find_actor_by_name(std::string_view name) const noexcept;

    /// Trouve le premier Actor par tag (parcours lineaire — O(n)).
    [[nodiscard]] Actor* find_actor_by_tag(std::string_view tag) const noexcept;

    /// Trouve un Actor par son ID stable (CRC32 de son nom — compatible avec
    /// les conventions Lua nie.exe ou les actor_id sont des hashes 32 bits).
    /// Parcours lineaire — O(n).
    [[nodiscard]] Actor* find_actor(uint32_t actor_id) const noexcept;

    // ── FastAccessComponents (acces O(1) pour le rendu) ─────────────

    /// Vue read-only sur les vecteurs de composants categorises.
    [[nodiscard]] const FastAccessComponents& fast_access() const noexcept {
        return fast_access_;
    }

    /// Callback appele par Actor quand un composant est attache.
    /// Public pour permettre l'attachement manuel d'Actors externes.
    void on_component_added(Component& component);

    /// Callback appele par Actor quand un composant va etre detache.
    void on_component_removed(Component& component);

    /// Recherche la premiere camera disponible (categorie CAMERA).
    /// Retourne nullptr si aucune camera n'est enregistree.
    [[nodiscard]] Component* main_camera() const noexcept;

    // ── Etat ─────────────────────────────────────────────────────────

    /// Indique si la Scene est en cours d'execution (apres start()).
    [[nodiscard]] bool is_playing() const noexcept { return playing_; }

private:
    std::vector<std::unique_ptr<Actor>> actors_;
    std::vector<Actor*>                 pending_destroy_;
    FastAccessComponents                fast_access_;
    bool                                playing_ = false;
};

} // namespace lives::ecs
