#pragma once

/// @file service_locator.h
/// Localisateur de services type-safe pour le moteur Level-5.
/// Permet l'injection de dependances sans couplage direct.
// iecode abstraction — no RTTI counterpart in nie.exe

#include <any>
#include <stdexcept>
#include <string>
#include <typeindex>
#include <unordered_map>

namespace lives {

/// Registre global de services type-safe.
/// Chaque service est enregistre par son type et recupere par cast.
class ServiceLocator {
public:
    ServiceLocator() = delete;

    /// Enregistre un service (non-owning, le caller gere la duree de vie).
    template <typename T>
    static void provide(T* service) {
        services_[std::type_index(typeid(T))] = service;
    }

    /// Recupere un service. Lance std::runtime_error si absent.
    template <typename T>
    [[nodiscard]] static T& get() {
        auto it = services_.find(std::type_index(typeid(T)));
        if (it == services_.end()) {
            throw std::runtime_error(
                "Service non enregistre: " + std::string(typeid(T).name()));
        }
        return *std::any_cast<T*>(it->second);
    }

    /// Recupere un service ou nullptr si absent.
    template <typename T>
    [[nodiscard]] static T* try_get() noexcept {
        auto it = services_.find(std::type_index(typeid(T)));
        if (it == services_.end()) return nullptr;
        return std::any_cast<T*>(it->second);
    }

    /// Teste si un service est enregistre.
    template <typename T>
    [[nodiscard]] static bool has() noexcept {
        return services_.contains(std::type_index(typeid(T)));
    }

    /// Retire un service du registre.
    template <typename T>
    static void remove() noexcept {
        services_.erase(std::type_index(typeid(T)));
    }

    /// Vide tous les services enregistres.
    static void clear() noexcept { services_.clear(); }

    // ── Alias style Overload (OvCore::Global::ServiceLocator) ──────────
    // Permet d'ecrire ServiceLocator::Provide(svc) / ServiceLocator::Get<T>()
    // pour rester compatible avec les patterns d'inspiration Overload.

    /// Enregistre un service par reference (style Overload).
    template <typename T>
    static void Provide(T& service) noexcept {
        services_[std::type_index(typeid(T))] = &service;
    }

    /// Recupere un service (style Overload). Comportement indefini si absent.
    template <typename T>
    [[nodiscard]] static T& Get() {
        return get<T>();
    }

private:
    inline static std::unordered_map<std::type_index, std::any> services_;
};

} // namespace lives

/// Macro d'acces rapide style Overload (`OVSERVICE(Type)`).
/// Equivalent a `lives::ServiceLocator::Get<Type>()`.
#define IECODE_SERVICE(Type) ::lives::ServiceLocator::get<Type>()
