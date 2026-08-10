#pragma once

/// @file gdd_save.h
/// Sauvegarde GDD haut niveau : equipe, inventaire, journal de quetes.
/// Wrappers JSON-friendly utilises par le systeme de save runtime de l'editeur
/// et de la CLI. Distinct des CGDD* (qui modelisent le format binaire de nie.exe)
/// — ces types-la sont nos containers serialisables vers nlohmann::json.

#include <nlohmann/json.hpp>

#include <array>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace game {

/// Equipe active du joueur (16 slots max, capitaine et compteur actif).
struct GDDParty {
    std::array<uint32_t, 16> player_ids{};
    uint32_t active_count = 0;
    uint32_t captain_id   = 0;

    [[nodiscard]] static GDDParty from_json(const nlohmann::json& j);
    [[nodiscard]] nlohmann::json  to_json() const;
};

/// Inventaire d'objets (item_id -> quantite) + or.
struct GDDInventory {
    std::unordered_map<uint32_t, uint32_t> items;
    uint32_t gold = 0;

    void add_item(uint32_t id, uint32_t count = 1);
    /// Retire `count` instances de `id`. Renvoie false si quantite insuffisante.
    bool remove_item(uint32_t id, uint32_t count = 1);

    [[nodiscard]] static GDDInventory from_json(const nlohmann::json& j);
    [[nodiscard]] nlohmann::json     to_json() const;
};

/// Journal de quetes (id, statut, etape).
struct GDDQuestLog {
    enum class Status : uint8_t {
        NOT_STARTED = 0,
        IN_PROGRESS = 1,
        COMPLETED   = 2,
        FAILED      = 3,
    };

    struct Quest {
        uint32_t id     = 0;
        Status   status = Status::NOT_STARTED;
        uint32_t step   = 0;
    };

    std::vector<Quest> quests;

    void start_quest(uint32_t id);
    void advance_quest(uint32_t id);
    void complete_quest(uint32_t id);

    [[nodiscard]] static GDDQuestLog from_json(const nlohmann::json& j);
    [[nodiscard]] nlohmann::json     to_json() const;
};

/// Sauvegarde complete (regroupe tous les sous-systemes GDD).
struct GDDSave {
    GDDParty     party;
    GDDInventory inventory;
    GDDQuestLog  quests;
    uint32_t     chapter = 0;
    std::string  save_name;

    [[nodiscard]] bool save_to_file(const std::filesystem::path& path) const;
    [[nodiscard]] static std::optional<GDDSave> load_from_file(const std::filesystem::path& path);
};

} // namespace game
