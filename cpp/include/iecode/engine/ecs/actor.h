#pragma once

/// @file actor.h
/// Acteur ECS du moteur Level-5 (lives::ecs::Actor).
/// Entite dans le monde, possede des Components et forme un arbre hierarchique.
/// Inspire d'Overload Engine, adapte a l'architecture RTTI de nie.exe.

#include "../core/object.h"
#include "component.h"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <cassert>
#include <memory>
#include <span>
#include <string>
#include <typeindex>
#include <utility>
#include <vector>

namespace lives::ecs {

class Scene; // Declaration anticipee — Scene observe les Components via callbacks.

/// Transform local d'un Actor (position, rotation, echelle).
struct Transform {
    glm::vec3 position = glm::vec3(0.0f);
    glm::quat rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f); // identite
    glm::vec3 scale    = glm::vec3(1.0f);
};

/// Acteur = entite dans le monde du jeu.
/// Herite de CObject pour s'integrer au systeme RTTI Level-5.
/// Possede un vecteur de Components et gere un arbre parent/enfants
/// similaire a CMenuObject dans nie.exe.
class Actor : public CObject {
public:
    /// Constructeur avec nom optionnel.
    explicit Actor(const std::string& name = "Actor");

    ~Actor() override;

    // Non-copiable, deplacable
    Actor(const Actor&) = delete;
    Actor& operator=(const Actor&) = delete;
    Actor(Actor&&) noexcept;
    Actor& operator=(Actor&&) noexcept;

    // ── CObject overrides ────────────────────────────────────────────

    [[nodiscard]] std::string_view get_class_name() const override {
        return "Actor";
    }

    // ── Cycle de vie ─────────────────────────────────────────────────
    // Appelees par le systeme de scene/monde, propagees aux Components.

    /// Initialise l'Actor et tous ses Components (appelle on_awake).
    void awake();

    /// Demarre l'Actor et tous ses Components (appelle on_start).
    void start();

    /// Met a jour l'Actor et tous ses Components actifs.
    void update(float dt);

    /// Mise a jour tardive apres tous les updates.
    void late_update(float dt);

    /// Detruit l'Actor : enfants d'abord, puis Components.
    void destroy();

    // ── Composants ───────────────────────────────────────────────────

    /// Ajoute un composant de type T, construit en place.
    /// Retourne une reference vers le composant cree.
    /// @pre T doit deriver de Component.
    template<typename T, typename... Args>
        requires std::derived_from<T, Component>
    T& add_component(Args&&... args) {
        auto component = std::make_unique<T>(std::forward<Args>(args)...);
        component->owner_ = this;
        auto& ref = *component;
        components_.push_back(std::move(component));
        notify_component_added(ref);
        return ref;
    }

    /// Cherche le premier composant de type T.
    /// @return Pointeur vers le composant, ou nullptr si absent.
    template<typename T>
        requires std::derived_from<T, Component>
    [[nodiscard]] T* get_component() const noexcept {
        const auto type_id = std::type_index(typeid(T));
        for (const auto& comp : components_) {
            if (comp->component_type_id() == type_id) {
                return static_cast<T*>(comp.get());
            }
        }
        return nullptr;
    }

    /// Verifie si l'Actor possede un composant de type T.
    template<typename T>
        requires std::derived_from<T, Component>
    [[nodiscard]] bool has_component() const noexcept {
        return get_component<T>() != nullptr;
    }

    /// Supprime le premier composant de type T.
    /// @return true si un composant a ete supprime.
    template<typename T>
        requires std::derived_from<T, Component>
    bool remove_component() {
        const auto type_id = std::type_index(typeid(T));
        auto it = std::find_if(components_.begin(), components_.end(),
            [&type_id](const auto& comp) {
                return comp->component_type_id() == type_id;
            });
        if (it == components_.end()) return false;
        notify_component_removed(**it);
        (*it)->on_destroy();
        components_.erase(it);
        return true;
    }

    /// Nombre de composants attaches.
    [[nodiscard]] size_t component_count() const noexcept {
        return components_.size();
    }

    /// Vue read-only sur tous les composants (pour iteration externe).
    [[nodiscard]] std::span<const std::unique_ptr<Component>> components() const noexcept {
        return components_;
    }

    // ── Liaison Scene ────────────────────────────────────────────────

    /// Scene proprietaire (nullptr si l'Actor est detache).
    /// Defini par Scene::create_actor() / Scene::destroy_actor().
    [[nodiscard]] Scene* scene() const noexcept { return scene_; }

    /// Reattache l'Actor a une Scene. Re-enregistre tous les composants
    /// existants dans le nouveau FastAccessComponents (et les desinscrit
    /// de l'ancien si different).
    void set_scene(Scene* scene);

    // ── Hierarchie parent/enfants ────────────────────────────────────

    /// Definit le parent de cet Actor.
    /// Met a jour les listes d'enfants des deux cotes.
    /// Passer nullptr pour detacher du parent actuel.
    void set_parent(Actor* new_parent);

    /// Ajoute un enfant a cet Actor.
    /// Equivalent a child->set_parent(this).
    void add_child(Actor* child);

    /// Retire un enfant de cet Actor.
    /// L'enfant n'est pas detruit, juste detache.
    void remove_child(Actor* child);

    /// Retourne le parent (nullptr si racine).
    [[nodiscard]] Actor* parent() const noexcept { return parent_; }

    /// Vue sur les enfants directs.
    [[nodiscard]] std::span<Actor* const> get_children() const noexcept {
        return children_;
    }

    /// Nombre d'enfants directs.
    [[nodiscard]] size_t child_count() const noexcept {
        return children_.size();
    }

    // ── Etat ─────────────────────────────────────────────────────────

    /// Active ou desactive l'Actor (et ses composants/enfants dans update).
    void set_active(bool active) noexcept { active_ = active; }

    /// Etat actif.
    [[nodiscard]] bool is_active() const noexcept { return active_; }

    // ── Tag ──────────────────────────────────────────────────────────

    /// Tag d'identification (ex: "player", "npc", "ball").
    void set_tag(std::string tag) { tag_ = std::move(tag); }
    [[nodiscard]] const std::string& tag() const noexcept { return tag_; }

    // ── Nom ──────────────────────────────────────────────────────────

    /// Nom de l'Actor (debug/identification).
    void set_name(std::string name) { name_ = std::move(name); }
    [[nodiscard]] const std::string& name() const noexcept { return name_; }

    // ── Transform ────────────────────────────────────────────────────

    /// Acces direct au transform local.
    [[nodiscard]] Transform& transform() noexcept { return transform_; }
    [[nodiscard]] const Transform& transform() const noexcept { return transform_; }

private:
    /// Notifie la Scene proprietaire qu'un composant vient d'etre attache.
    void notify_component_added(Component& component);

    /// Notifie la Scene proprietaire qu'un composant va etre detache.
    void notify_component_removed(Component& component);

    std::string name_;
    std::string tag_;

    Transform transform_;

    bool active_ = true;

    /// Composants possedes (ownership via unique_ptr).
    std::vector<std::unique_ptr<Component>> components_;

    /// Parent dans la hierarchie (non-owning).
    Actor* parent_ = nullptr;

    /// Enfants directs (non-owning — l'ownership est externe).
    std::vector<Actor*> children_;

    /// Scene proprietaire (non-owning, defini par Scene).
    Scene* scene_ = nullptr;
};

} // namespace lives::ecs
