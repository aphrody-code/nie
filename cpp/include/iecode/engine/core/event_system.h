#pragma once

/// @file event_system.h
/// Systeme d'evenements type-safe pour le moteur Level-5.
/// Subscribe/unsubscribe/fire avec handlers typees et payload flexible.
// iecode abstraction — no RTTI counterpart in nie.exe

#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace lives {

/// Types d'evenements du moteur Level-5.
enum class EventType : uint32_t {
    // Cycle de vie moteur
    ENGINE_INIT,
    ENGINE_SHUTDOWN,
    ENGINE_TICK,

    // Fenetre / input (SDL)
    SDL_EVENT,
    WINDOW_RESIZE,
    WINDOW_CLOSE,

    // Rendu (13 DrawPass)
    RENDER_BEGIN,
    RENDER_END,
    DRAW_PASS_BEGIN,
    DRAW_PASS_END,

    // Gestion de scenes
    SCENE_LOAD,
    SCENE_UNLOAD,
    SCENE_TRANSITION,

    // Systeme d'assets
    ASSET_LOADED,
    ASSET_UNLOADED,
    ASSET_MODIFIED,

    // Scripting Lua
    LUA_SCRIPT_LOADED,
    LUA_SCRIPT_ERROR,
    LUA_COMMAND_EXECUTED,

    // Editeur
    EDITOR_MODE_CHANGED,
    SELECTION_CHANGED,
    PROPERTY_CHANGED,

    // Modding
    MOD_INSTALLED,
    MOD_UNINSTALLED,
    MOD_CONFLICT_DETECTED,

    COUNT
};

/// Payload flexible pour les evenements.
using EventData = std::variant<
    std::monostate,
    int,
    float,
    void*,
    std::string,
    uint64_t>;

using EventHandler   = std::function<void(EventData)>;
using EventHandlerId = uint64_t;

/// Systeme d'evenements global thread-safe.
/// Les handlers sont copies avant emission pour eviter les deadlocks.
class EventSystem {
public:
    EventSystem() = delete;

    /// Enregistre un handler pour un type d'evenement. Retourne un identifiant unique.
    [[nodiscard]] static EventHandlerId subscribe(EventType type, EventHandler handler);

    /// Retire un handler par son identifiant.
    static void unsubscribe(EventType type, EventHandlerId id);

    /// Emet un evenement. Les handlers sont appeles dans l'ordre d'inscription.
    static void fire(EventType type, const EventData& data = {});

    /// Vide tous les listeners.
    static void clear();

private:
    struct Listener {
        EventHandlerId id;
        EventHandler   handler;
    };

    inline static std::unordered_map<EventType, std::vector<Listener>> listeners_;
    inline static std::mutex                                           mutex_;
    inline static EventHandlerId                                       next_id_ = 1;
};

} // namespace lives

// Helpers inline (pas de macros — cppcoreguidelines-macro-usage)
namespace lives::ie {
inline EventHandlerId subscribe(EventType type, EventHandler handler) {
    return EventSystem::subscribe(type, std::move(handler));
}
inline void fire(EventType type) { EventSystem::fire(type); }
inline void fire(EventType type, const EventData& data) { EventSystem::fire(type, data); }
} // namespace lives::ie
