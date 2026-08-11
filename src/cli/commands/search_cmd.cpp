/// @file search_cmd.cpp
/// Commande CLI 'search' — recherche de personnages, skills ou equipes.
///
/// Recherche par substring (case-insensitive) sur les noms FR/EN/JA
/// ou par ID CRC32 hex (format "0x12345678").

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/gamedata/loader.h"
#include "iecode/gamedata/types.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Utilitaires texte ──────────────────────────────────────────────

static std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

static bool contains_ci(const std::string& haystack, const std::string& needle_lower) {
    if (needle_lower.empty() || haystack.empty()) return false;
    auto lower = to_lower(haystack);
    return lower.find(needle_lower) != std::string::npos;
}

/// Verifie si la query est un ID hex valide et correspond a l'identifiant.
static bool match_hex_id(const std::string& query, const std::string& id) {
    if (!query.starts_with("0x") && !query.starts_with("0X")) return false;
    try {
        const auto hex = std::stoul(query, nullptr, 16);
        // Comparer avec l'id (qui est deja au format "0xABCD1234")
        if (!id.starts_with("0x") && !id.starts_with("0X")) return false;
        const auto id_hex = std::stoul(id, nullptr, 16);
        return hex == id_hex;
    } catch (...) {
        return false;
    }
}

// ── Serialisation ──────────────────────────────────────────────────

static json char_to_json(const gamedata::ParsedCharaParam& c) {
    return json{
        {"type", "character"},
        {"id", c.chara_param_id},
        {"baseId", c.chara_base_id},
        {"rarity", static_cast<int>(c.chara_rank)},
        {"position", static_cast<int>(c.main_position)},
        {"element", static_cast<int>(c.element)},
        {"gender", c.gender == gamedata::Gender::Female ? "F" : "M"},
    };
}

static json skill_to_json(const gamedata::ParsedSkill& s) {
    json j{
        {"type", "skill"},
        {"id", s.skill_id},
        {"idStr", s.skill_id_str},
        {"element", static_cast<int>(s.element)},
        {"category", static_cast<int>(s.category)},
        {"tpCost", s.tp_cost},
        {"powerMin", s.power_min},
        {"powerMax", s.power_max},
    };

    json names;
    if (!s.names.en.empty()) names["en"] = s.names.en;
    if (!s.names.fr.empty()) names["fr"] = s.names.fr;
    if (!s.names.ja.empty()) names["ja"] = s.names.ja;
    if (!names.empty()) j["names"] = std::move(names);

    return j;
}

static json team_to_json(const gamedata::ParsedTeam& t) {
    json j{
        {"type", "team"},
        {"id", t.team_id},
    };

    json names;
    if (!t.names.en.empty()) names["en"] = t.names.en;
    if (!t.names.fr.empty()) names["fr"] = t.names.fr;
    if (!t.names.ja.empty()) names["ja"] = t.names.ja;
    if (!names.empty()) j["names"] = std::move(names);

    return j;
}

// ── Commande principale ────────────────────────────────────────────

static void cmd_search(const std::string& query, const std::string& data_root) {
    const fs::path root(data_root);
    if (!fs::exists(root)) {
        emit_error(fmt::format("data root introuvable : '{}'", data_root));
        return;
    }

    if (query.empty()) {
        emit_error("query vide");
        return;
    }

    auto db = gamedata::load_game_database(root, true);
    if (!db) {
        emit_error("echec du chargement de la base de donnees");
        return;
    }

    const auto lower_query = to_lower(query);
    json results = json::array();

    // Recherche dans les personnages (par ID hex uniquement, pas de noms sur ParsedCharaParam)
    for (const auto& c : db->characters) {
        if (match_hex_id(query, c.chara_param_id) ||
            match_hex_id(query, c.chara_base_id)) {
            results.push_back(char_to_json(c));
        }
    }

    // Recherche dans les skills (par nom ou ID)
    for (const auto& s : db->skills) {
        bool match = false;
        if (contains_ci(s.names.fr, lower_query) ||
            contains_ci(s.names.en, lower_query) ||
            contains_ci(s.names.ja, lower_query) ||
            contains_ci(s.skill_id_str, lower_query)) {
            match = true;
        }
        if (!match && match_hex_id(query, s.skill_id)) match = true;
        if (match) results.push_back(skill_to_json(s));
    }

    // Recherche dans les equipes (par nom ou ID)
    for (const auto& t : db->teams) {
        bool match = false;
        if (contains_ci(t.names.fr, lower_query) ||
            contains_ci(t.names.en, lower_query) ||
            contains_ci(t.names.ja, lower_query)) {
            match = true;
        }
        if (!match && match_hex_id(query, t.team_id)) match = true;
        if (match) results.push_back(team_to_json(t));
    }

    emit(json{
        {"ok", true},
        {"query", query},
        {"count", results.size()},
        {"results", std::move(results)},
    });
}

// ── Registration ───────────────────────────────────────────────────

void register_search_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("search", "Search characters, skills, teams by name or CRC32 hex");

    static std::string query;
    static std::string data_root;

    cmd->add_option("query", query, "Search query (name substring or 0xHEX id)")->required();
    cmd->add_option("--data", data_root, "Game data root directory")->default_val("data");

    cmd->callback([]() { cmd_search(query, data_root); });
}

} // namespace iecode::cli
