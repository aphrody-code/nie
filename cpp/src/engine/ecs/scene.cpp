/// @file scene.cpp
/// Implementation de lives::ecs::Scene et FastAccessComponents.

#include <iecode/crypto/crc32.h>
#include <iecode/engine/ecs/scene.h>

#include <algorithm>

namespace lives::ecs {

namespace {

/// Selectionne le bucket FastAccessComponents pour une categorie donnee.
[[nodiscard]] std::vector<Component*>* bucket_for(FastAccessComponents& fac,
                                                  ComponentKind kind) noexcept {
    switch (kind) {
        case ComponentKind::MODEL_RENDERER: return &fac.model_renderers;
        case ComponentKind::CAMERA:         return &fac.cameras;
        case ComponentKind::LIGHT:          return &fac.lights;
        case ComponentKind::SOCCER_PLAYER:  return &fac.soccer_players;
        case ComponentKind::NPC:            return &fac.npcs;
        case ComponentKind::GENERIC:        return nullptr;
    }
    return nullptr;
}

} // namespace

Scene::Scene() = default;

Scene::~Scene() {
    // Detacher tous les Actors AVANT que fast_access_ ne soit detruit.
    // Sinon ~Actor() appellerait on_component_removed() sur des vecteurs
    // deja liberes (ordre de destruction des membres : fast_access_ avant
    // actors_), provoquant "vector erase iterator outside range".
    for (auto& actor : actors_) {
        if (actor) actor->set_scene(nullptr);
    }
    pending_destroy_.clear();
}

// ── Cycle de vie ─────────────────────────────────────────────────────

void Scene::awake() {
    for (auto& actor : actors_) {
        actor->awake();
    }
}

void Scene::start() {
    playing_ = true;
    for (auto& actor : actors_) {
        actor->start();
    }
}

void Scene::update(float dt) {
    for (auto& actor : actors_) {
        if (actor->is_active()) {
            actor->update(dt);
        }
    }
}

void Scene::late_update(float dt) {
    for (auto& actor : actors_) {
        if (actor->is_active()) {
            actor->late_update(dt);
        }
    }
}

void Scene::collect_garbage() {
    if (pending_destroy_.empty()) return;

    for (auto* dead : pending_destroy_) {
        // Detacher de la Scene en premier pour eviter les notifications
        // de removal sur des buckets deja en cours de purge.
        dead->set_scene(nullptr);
        dead->destroy();
    }

    actors_.erase(
        std::remove_if(actors_.begin(), actors_.end(),
                       [this](const std::unique_ptr<Actor>& a) {
                           return std::find(pending_destroy_.begin(),
                                            pending_destroy_.end(),
                                            a.get()) != pending_destroy_.end();
                       }),
        actors_.end());

    pending_destroy_.clear();
}

// ── Gestion des Actors ───────────────────────────────────────────────

Actor& Scene::create_actor(const std::string& name) {
    auto actor = std::make_unique<Actor>(name);
    auto& ref  = *actor;
    actors_.push_back(std::move(actor));
    ref.set_scene(this);
    return ref;
}

bool Scene::destroy_actor(Actor& target) {
    auto it = std::find_if(actors_.begin(), actors_.end(),
                           [&target](const std::unique_ptr<Actor>& a) {
                               return a.get() == &target;
                           });
    if (it == actors_.end()) return false;

    // Marque pour purge differee — protege l'iteration en cours.
    if (std::find(pending_destroy_.begin(), pending_destroy_.end(),
                  it->get()) == pending_destroy_.end()) {
        pending_destroy_.push_back(it->get());
    }
    return true;
}

Actor* Scene::find_actor_by_name(std::string_view name) const noexcept {
    for (const auto& actor : actors_) {
        if (actor->name() == name) return actor.get();
    }
    return nullptr;
}

Actor* Scene::find_actor_by_tag(std::string_view tag) const noexcept {
    for (const auto& actor : actors_) {
        if (actor->tag() == tag) return actor.get();
    }
    return nullptr;
}

Actor* Scene::find_actor(uint32_t actor_id) const noexcept {
    for (const auto& actor : actors_) {
        if (iecode::crypto::crc32_compute(actor->name()) == actor_id) {
            return actor.get();
        }
    }
    return nullptr;
}

// ── FastAccessComponents ─────────────────────────────────────────────

void Scene::on_component_added(Component& component) {
    auto* bucket = bucket_for(fast_access_, component.component_kind());
    if (bucket == nullptr) return;
    // Eviter les doublons (re-attachement d'Actor).
    if (std::find(bucket->begin(), bucket->end(), &component) == bucket->end()) {
        bucket->push_back(&component);
    }
}

void Scene::on_component_removed(Component& component) {
    auto* bucket = bucket_for(fast_access_, component.component_kind());
    if (bucket == nullptr) return;
    bucket->erase(std::remove(bucket->begin(), bucket->end(), &component),
                  bucket->end());
}

Component* Scene::main_camera() const noexcept {
    if (fast_access_.cameras.empty()) return nullptr;
    return fast_access_.cameras.front();
}

} // namespace lives::ecs
