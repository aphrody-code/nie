/// @file gdd_save.cpp
/// Implementation des wrappers GDD haut niveau (party, inventory, quetes, save).

#include "iecode/game/gdd/gdd_save.h"

#include <spdlog/spdlog.h>

#include <fstream>

namespace game {

// ── GDDParty ────────────────────────────────────────────────────────

GDDParty GDDParty::from_json(const nlohmann::json& j) {
    GDDParty p;
    if (j.contains("player_ids") && j["player_ids"].is_array()) {
        const auto& arr = j["player_ids"];
        const std::size_t n = std::min<std::size_t>(arr.size(), p.player_ids.size());
        for (std::size_t i = 0; i < n; ++i) {
            p.player_ids[i] = arr[i].get<uint32_t>();
        }
    }
    p.active_count = j.value("active_count", 0u);
    p.captain_id   = j.value("captain_id", 0u);
    return p;
}

nlohmann::json GDDParty::to_json() const {
    nlohmann::json j;
    j["player_ids"]   = player_ids;
    j["active_count"] = active_count;
    j["captain_id"]   = captain_id;
    return j;
}

// ── GDDInventory ────────────────────────────────────────────────────

void GDDInventory::add_item(uint32_t id, uint32_t count) {
    if (id == 0 || count == 0) return;
    items[id] += count;
}

bool GDDInventory::remove_item(uint32_t id, uint32_t count) {
    if (id == 0 || count == 0) return false;
    auto it = items.find(id);
    if (it == items.end() || it->second < count) {
        return false;
    }
    it->second -= count;
    if (it->second == 0) {
        items.erase(it);
    }
    return true;
}

GDDInventory GDDInventory::from_json(const nlohmann::json& j) {
    GDDInventory inv;
    if (j.contains("items") && j["items"].is_object()) {
        for (const auto& [key, val] : j["items"].items()) {
            try {
                const auto id    = static_cast<uint32_t>(std::stoul(key));
                const auto count = val.get<uint32_t>();
                inv.items[id] = count;
            } catch (...) {
                spdlog::warn("GDDInventory::from_json: clef invalide '{}'", key);
            }
        }
    }
    inv.gold = j.value("gold", 0u);
    return inv;
}

nlohmann::json GDDInventory::to_json() const {
    nlohmann::json items_obj = nlohmann::json::object();
    for (const auto& [id, count] : items) {
        items_obj[std::to_string(id)] = count;
    }
    nlohmann::json j;
    j["items"] = std::move(items_obj);
    j["gold"]  = gold;
    return j;
}

// ── GDDQuestLog ─────────────────────────────────────────────────────

void GDDQuestLog::start_quest(uint32_t id) {
    for (auto& q : quests) {
        if (q.id == id) {
            if (q.status == Status::NOT_STARTED) {
                q.status = Status::IN_PROGRESS;
                q.step   = 0;
            }
            return;
        }
    }
    quests.push_back(Quest{ id, Status::IN_PROGRESS, 0u });
}

void GDDQuestLog::advance_quest(uint32_t id) {
    for (auto& q : quests) {
        if (q.id == id && q.status == Status::IN_PROGRESS) {
            ++q.step;
            return;
        }
    }
}

void GDDQuestLog::complete_quest(uint32_t id) {
    for (auto& q : quests) {
        if (q.id == id) {
            q.status = Status::COMPLETED;
            return;
        }
    }
    quests.push_back(Quest{ id, Status::COMPLETED, 0u });
}

GDDQuestLog GDDQuestLog::from_json(const nlohmann::json& j) {
    GDDQuestLog log;
    if (j.contains("quests") && j["quests"].is_array()) {
        for (const auto& qj : j["quests"]) {
            Quest q;
            q.id     = qj.value("id", 0u);
            q.status = static_cast<Status>(qj.value("status", 0u));
            q.step   = qj.value("step", 0u);
            log.quests.push_back(q);
        }
    }
    return log;
}

nlohmann::json GDDQuestLog::to_json() const {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& q : quests) {
        nlohmann::json qj;
        qj["id"]     = q.id;
        qj["status"] = static_cast<uint8_t>(q.status);
        qj["step"]   = q.step;
        arr.push_back(std::move(qj));
    }
    nlohmann::json j;
    j["quests"] = std::move(arr);
    return j;
}

// ── GDDSave ─────────────────────────────────────────────────────────

bool GDDSave::save_to_file(const std::filesystem::path& path) const {
    nlohmann::json j;
    j["save_name"] = save_name;
    j["chapter"]   = chapter;
    j["party"]     = party.to_json();
    j["inventory"] = inventory.to_json();
    j["quests"]    = quests.to_json();

    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f) {
        spdlog::error("GDDSave::save_to_file: ouverture impossible '{}'", path.string());
        return false;
    }
    f << j.dump(2);
    return f.good();
}

std::optional<GDDSave> GDDSave::load_from_file(const std::filesystem::path& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) {
        spdlog::error("GDDSave::load_from_file: ouverture impossible '{}'", path.string());
        return std::nullopt;
    }
    nlohmann::json j;
    try {
        f >> j;
    } catch (const std::exception& e) {
        spdlog::error("GDDSave::load_from_file: parse JSON echoue: {}", e.what());
        return std::nullopt;
    }

    GDDSave s;
    s.save_name = j.value("save_name", std::string{});
    s.chapter   = j.value("chapter", 0u);
    if (j.contains("party"))     s.party     = GDDParty::from_json(j["party"]);
    if (j.contains("inventory")) s.inventory = GDDInventory::from_json(j["inventory"]);
    if (j.contains("quests"))    s.quests    = GDDQuestLog::from_json(j["quests"]);
    return s;
}

} // namespace game
