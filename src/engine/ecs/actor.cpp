/// @file actor.cpp
/// Implementation de lives::ecs::Actor.

#include <iecode/engine/ecs/actor.h>
#include <iecode/engine/ecs/scene.h>

#include <algorithm>
#include <cassert>

namespace lives::ecs {

Actor::Actor(const std::string& name) : name_(name) {}

Actor::~Actor() {
    // Desinscrire les composants de la Scene proprietaire si encore lie.
    if (scene_ != nullptr) {
        for (auto& comp : components_) {
            scene_->on_component_removed(*comp);
        }
        scene_ = nullptr;
    }

    // Detacher du parent si present.
    if (parent_ != nullptr) {
        parent_->remove_child(this);
    }

    // Detacher tous les enfants (sans les detruire — on ne possede pas).
    for (auto* child : children_) {
        child->parent_ = nullptr;
    }
    children_.clear();
}

Actor::Actor(Actor&& other) noexcept
    : CObject(std::move(other)),
      name_(std::move(other.name_)),
      tag_(std::move(other.tag_)),
      transform_(other.transform_),
      active_(other.active_),
      components_(std::move(other.components_)),
      parent_(other.parent_),
      children_(std::move(other.children_)) {
    // Mettre a jour les pointeurs owner_ des composants deplaces.
    for (auto& comp : components_) {
        comp->owner_ = this;
    }

    // Mettre a jour le pointeur parent_ des enfants deplaces.
    for (auto* child : children_) {
        child->parent_ = this;
    }

    // Remplacer la reference dans le parent si present.
    if (parent_ != nullptr) {
        auto it = std::find(parent_->children_.begin(),
                            parent_->children_.end(), &other);
        if (it != parent_->children_.end()) {
            *it = this;
        }
    }

    other.parent_ = nullptr;
}

Actor& Actor::operator=(Actor&& other) noexcept {
    if (this == &other) return *this;

    // Nettoyer l'etat actuel
    if (parent_ != nullptr) {
        parent_->remove_child(this);
    }
    for (auto* child : children_) {
        child->parent_ = nullptr;
    }

    CObject::operator=(std::move(other));
    name_ = std::move(other.name_);
    tag_ = std::move(other.tag_);
    transform_ = other.transform_;
    active_ = other.active_;
    components_ = std::move(other.components_);
    parent_ = other.parent_;
    children_ = std::move(other.children_);

    for (auto& comp : components_) {
        comp->owner_ = this;
    }
    for (auto* child : children_) {
        child->parent_ = this;
    }
    if (parent_ != nullptr) {
        auto it = std::find(parent_->children_.begin(),
                            parent_->children_.end(), &other);
        if (it != parent_->children_.end()) {
            *it = this;
        }
    }

    other.parent_ = nullptr;
    return *this;
}

// ── Cycle de vie ─────────────────────────────────────────────────────

void Actor::awake() {
    for (auto& comp : components_) {
        comp->on_awake();
    }
}

void Actor::start() {
    for (auto& comp : components_) {
        if (comp->is_enabled()) {
            comp->on_start();
        }
    }
}

void Actor::update(float dt) {
    if (!active_) return;

    for (auto& comp : components_) {
        if (comp->is_enabled()) {
            comp->on_update(dt);
        }
    }
}

void Actor::late_update(float dt) {
    if (!active_) return;

    for (auto& comp : components_) {
        if (comp->is_enabled()) {
            comp->on_late_update(dt);
        }
    }
}

void Actor::destroy() {
    // Detruire les enfants recursivement (copie du vecteur car
    // destroy() modifie children_ via le destructeur).
    auto children_copy = children_;
    for (auto* child : children_copy) {
        child->destroy();
    }

    // Detruire les composants (on_destroy puis liberation).
    for (auto& comp : components_) {
        comp->on_destroy();
    }
    components_.clear();
}

// ── Hierarchie parent/enfants ────────────────────────────────────────

void Actor::set_parent(Actor* new_parent) {
    // Eviter la boucle infinie (on ne peut pas etre son propre parent).
    if (new_parent == this) return;

    // Detacher du parent actuel si present.
    if (parent_ != nullptr) {
        parent_->remove_child(this);
    }

    parent_ = new_parent;

    // S'ajouter aux enfants du nouveau parent.
    if (new_parent != nullptr) {
        // Verifier qu'on n'est pas deja dans la liste.
        auto& siblings = new_parent->children_;
        if (std::find(siblings.begin(), siblings.end(), this) == siblings.end()) {
            siblings.push_back(this);
        }
    }
}

void Actor::add_child(Actor* child) {
    if (child == nullptr || child == this) return;
    child->set_parent(this);
}

// ── Liaison Scene ────────────────────────────────────────────────────

void Actor::set_scene(Scene* scene) {
    if (scene_ == scene) return;

    // Desinscrire les composants existants de l'ancienne Scene.
    if (scene_ != nullptr) {
        for (auto& comp : components_) {
            scene_->on_component_removed(*comp);
        }
    }

    scene_ = scene;

    // Reinscrire dans la nouvelle Scene.
    if (scene_ != nullptr) {
        for (auto& comp : components_) {
            scene_->on_component_added(*comp);
        }
    }
}

void Actor::notify_component_added(Component& component) {
    if (scene_ != nullptr) {
        scene_->on_component_added(component);
    }
}

void Actor::notify_component_removed(Component& component) {
    if (scene_ != nullptr) {
        scene_->on_component_removed(component);
    }
}

void Actor::remove_child(Actor* child) {
    if (child == nullptr) return;

    auto it = std::find(children_.begin(), children_.end(), child);
    if (it != children_.end()) {
        children_.erase(it);
        child->parent_ = nullptr;
    }
}

} // namespace lives::ecs
