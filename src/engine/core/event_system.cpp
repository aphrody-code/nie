#include "iecode/engine/core/event_system.h"

namespace lives {

EventHandlerId EventSystem::subscribe(EventType type, EventHandler handler) {
    std::lock_guard lock(mutex_);
    auto id = next_id_++;
    listeners_[type].push_back({.id = id, .handler = std::move(handler)});
    return id;
}

void EventSystem::unsubscribe(EventType type, EventHandlerId id) {
    std::lock_guard lock(mutex_);
    auto it = listeners_.find(type);
    if (it == listeners_.end()) return;

    auto& vec = it->second;
    std::erase_if(vec, [id](const Listener& l) { return l.id == id; });
}

void EventSystem::fire(EventType type, const EventData& data) {
    // Copier les handlers sous lock, puis appeler hors lock
    // pour eviter les deadlocks si un handler subscribe/unsubscribe.
    std::vector<EventHandler> handlers;
    {
        std::lock_guard lock(mutex_);
        auto it = listeners_.find(type);
        if (it == listeners_.end()) return;

        handlers.reserve(it->second.size());
        for (const auto& listener : it->second) {
            handlers.push_back(listener.handler);
        }
    }

    for (const auto& handler : handlers) {
        handler(data);
    }
}

void EventSystem::clear() {
    std::lock_guard lock(mutex_);
    listeners_.clear();
    next_id_ = 1;
}

} // namespace lives
