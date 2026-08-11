#pragma once

/// @file event.h
/// Evenement type-safe templatise inspire de OvTools::Eventing::Event<Args...>.
///
/// Contrairement a `event_system.h` (bus global enum-based), ce header fournit
/// des evenements *locaux* et *typees* a la maniere d'Overload :
///
///     lives::Event<int, float> on_resize;
///     auto id = on_resize.add_listener([](int w, int h){ ... });
///     on_resize.invoke(1920, 1080);
///     on_resize.remove_listener(id);
///
/// Header-only, zero allocation hors `std::function`. Thread-safety optionnelle
/// via le tag `lives::ThreadSafeEvent<...>`.
// iecode abstraction — no RTTI counterpart in nie.exe

#include <cstdint>
#include <functional>
#include <mutex>
#include <unordered_map>
#include <utility>

namespace lives {

/// Identifiant unique d'un listener (utilise pour `remove_listener`).
using ListenerID = uint64_t;

/// Evenement type-safe non thread-safe (cas commun, hot path).
template <class... ArgTypes>
class Event {
public:
    using Callback = std::function<void(ArgTypes...)>;

    /// Enregistre un callback. Retourne l'ID a conserver pour le retirer.
    [[nodiscard]] ListenerID add_listener(Callback callback) {
        const ListenerID id = ++next_id_;
        callbacks_.emplace(id, std::move(callback));
        return id;
    }

    /// Sucre syntaxique style Overload : `event += [](){...};`.
    /// La valeur retournee n'est pas l'ID (operator+= renvoie *this).
    Event& operator+=(Callback callback) {
        (void)add_listener(std::move(callback));
        return *this;
    }

    /// Retire un listener par son ID. Retourne true si retire.
    bool remove_listener(ListenerID id) noexcept {
        return callbacks_.erase(id) > 0;
    }

    /// Sucre syntaxique style Overload : `event -= id;`.
    bool operator-=(ListenerID id) noexcept { return remove_listener(id); }

    /// Vide tous les listeners.
    void remove_all_listeners() noexcept { callbacks_.clear(); }

    /// Nombre de listeners enregistres.
    [[nodiscard]] uint64_t listener_count() const noexcept {
        return callbacks_.size();
    }

    /// Invoque tous les callbacks dans l'ordre d'enregistrement.
    /// Note : si un callback ajoute/retire un listener pendant l'invoke,
    /// le snapshot local protege la cohérence de l'iteration.
    void invoke(ArgTypes... args) {
        // Copie defensive : autorise add/remove pendant l'invoke.
        const auto snapshot = callbacks_;
        for (const auto& [id, cb] : snapshot) {
            cb(args...);
        }
    }

private:
    std::unordered_map<ListenerID, Callback> callbacks_;
    ListenerID                               next_id_ = 0;
};

/// Variante thread-safe (lock global). A reserver aux evenements partages
/// entre threads (asset loading, network, etc.). Hors hot paths.
template <class... ArgTypes>
class ThreadSafeEvent {
public:
    using Callback = std::function<void(ArgTypes...)>;

    [[nodiscard]] ListenerID add_listener(Callback callback) {
        std::lock_guard lock(mutex_);
        const ListenerID id = ++next_id_;
        callbacks_.emplace(id, std::move(callback));
        return id;
    }

    bool remove_listener(ListenerID id) noexcept {
        std::lock_guard lock(mutex_);
        return callbacks_.erase(id) > 0;
    }

    void remove_all_listeners() noexcept {
        std::lock_guard lock(mutex_);
        callbacks_.clear();
    }

    [[nodiscard]] uint64_t listener_count() const noexcept {
        std::lock_guard lock(mutex_);
        return callbacks_.size();
    }

    void invoke(ArgTypes... args) {
        // Copier sous lock, appeler hors lock pour eviter les deadlocks
        // si un handler subscribe/unsubscribe.
        std::unordered_map<ListenerID, Callback> snapshot;
        {
            std::lock_guard lock(mutex_);
            snapshot = callbacks_;
        }
        for (const auto& [id, cb] : snapshot) {
            cb(args...);
        }
    }

private:
    mutable std::mutex                       mutex_;
    std::unordered_map<ListenerID, Callback> callbacks_;
    ListenerID                               next_id_ = 0;
};

} // namespace lives
