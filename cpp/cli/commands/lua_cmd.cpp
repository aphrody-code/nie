/// @file lua_cmd.cpp
/// Commande CLI 'lua' — analyse statique des scripts Lua decompiles via tree-sitter.
///
/// Sous-commandes :
///   iecode lua parse <file>                             Parse un fichier Lua, JSON sur stdout
///   iecode lua batch <dir>                              Parse tous les .lua du repertoire (recursif)
///   iecode lua search <dir> <query>                     Cherche un keyword dans tous les fichiers Lua
///   iecode lua extract-ui <file>                        Extrait les elements UI et strings CRC32
///   iecode lua extract-constants <file> [--menu-text]   Extrait les constantes de jeu (raretes, series...)
///
/// Options communes :
///   --out <file>       Ecrire le resultat dans un fichier
///   --pretty / -p      JSON indente (defaut : compact)

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/scripting/lua_parser.h"
#include "iecode/crypto/crc32.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Helpers internes ────────────────────────────────────────────────

namespace {

/// Formate un entier 32 bits en "0xDEADBEEF".
[[nodiscard]] std::string to_hex8(uint32_t v) {
    return fmt::format("0x{:08X}", v);
}

/// Charge menu_text.cfg.bin.json → map crc32_value → texte japonais.
/// Structure attendue : { entries: [ { name, variables: [{value}, {value}, {value}], children: [...] } ] }
[[nodiscard]] std::unordered_map<uint32_t, std::string>
load_menu_text(const std::string& path) {
    std::unordered_map<uint32_t, std::string> dict;
    if (path.empty() || !fs::exists(path)) return dict;

    std::ifstream f(path);
    auto j = json::parse(f, nullptr, /*allow_exceptions=*/false);
    if (j.is_discarded()) {
        spdlog::warn("lua extract-constants: menu_text JSON invalide : '{}'", path);
        return dict;
    }

    // Parcours recursif via pile (evite recursion profonde)
    std::vector<const json*> stack;
    const auto& entries = j.find("entries");
    if (entries != j.end() && entries->is_array()) {
        for (const auto& e : *entries) stack.push_back(&e);
    }

    while (!stack.empty()) {
        const json* node = stack.back();
        stack.pop_back();
        if (!node->is_object()) continue;

        // Extraire TEXT_INFO (mais pas TEXT_INFO_BEGIN)
        const auto& name_it = node->find("name");
        const auto& vars_it = node->find("variables");
        if (name_it != node->end() && vars_it != node->end() &&
            vars_it->is_array() && vars_it->size() >= 3) {
            const auto& name = name_it->get_ref<const std::string&>();
            if (name.rfind("TEXT_INFO", 0) == 0 && name.find("BEGIN") == std::string::npos) {
                try {
                    auto hash_raw = (*vars_it)[0]["value"].get<int64_t>();
                    auto text     = (*vars_it)[2]["value"].get<std::string>();
                    dict[static_cast<uint32_t>(hash_raw)] = std::move(text);
                } catch (...) {}
            }
        }

        // Empiler les enfants
        const auto& children = node->find("children");
        if (children != node->end() && children->is_array()) {
            for (const auto& child : *children) stack.push_back(&child);
        }
    }

    return dict;
}

/// Ecrit du JSON sur stdout ou dans un fichier, avec indentation optionnelle.
void output_json(const json& j,
                 const std::string& output_path,
                 bool pretty) {
    std::string json_str = pretty ? j.dump(2) : j.dump();

    if (!output_path.empty()) {
        fs::create_directories(fs::path(output_path).parent_path());
        std::ofstream out(output_path);
        if (!out) {
            emit_error(fmt::format("impossible d'ecrire '{}'", output_path));
            return;
        }
        out << json_str;
        out.close();

        emit(json::object({
            {"ok", true},
            {"output", output_path}
        }));
    } else {
        fmt::print("{}\n", json_str);
    }
}

} // namespace anonyme

// ── lua parse — parser un seul fichier ──────────────────────────────

static void cmd_lua_parse(const std::string& file_path,
                          const std::string& output_path,
                          bool pretty) {
    if (!fs::exists(file_path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", file_path));
        return;
    }

    spdlog::info("lua parse: analyse de '{}'...", file_path);

    scripting::LuaParser parser;
    auto result = parser.parse_file(file_path);

    auto j = scripting::LuaParser::to_json(result);
    output_json(j, output_path, pretty);
}

// ── lua batch — parser un repertoire entier ─────────────────────────

static void cmd_lua_batch(const std::string& dir_path,
                          const std::string& glob_pattern,
                          const std::string& output_path,
                          bool pretty) {
    if (!fs::exists(dir_path) || !fs::is_directory(dir_path)) {
        emit_error(fmt::format("repertoire introuvable : '{}'", dir_path));
        return;
    }

    spdlog::info("lua batch: analyse de '{}' (pattern: {})...", dir_path, glob_pattern);

    scripting::LuaParser parser;
    auto batch = parser.parse_directory(dir_path, glob_pattern);

    spdlog::info("lua batch: {} fichiers traites ({} ok, {} erreurs) en {:.1f} ms",
                 batch.total_files, batch.ok_files, batch.error_files, batch.parse_time_ms);

    auto j = scripting::LuaParser::to_json(batch);
    output_json(j, output_path, pretty);
}

// ── lua search — recherche par keyword ──────────────────────────────

static void cmd_lua_search(const std::string& dir_path,
                           const std::string& query,
                           const std::string& glob_pattern,
                           const std::string& output_path,
                           bool pretty,
                           int limit) {
    if (!fs::exists(dir_path) || !fs::is_directory(dir_path)) {
        emit_error(fmt::format("repertoire introuvable : '{}'", dir_path));
        return;
    }

    spdlog::info("lua search: '{}' dans '{}'...", query, dir_path);

    scripting::LuaParser parser;
    auto batch = parser.parse_directory(dir_path, glob_pattern);
    auto results = parser.search(batch, query);

    // Limiter les resultats
    if (limit > 0 && static_cast<int>(results.size()) > limit) {
        results.resize(static_cast<size_t>(limit));
    }

    json j;
    j["ok"] = true;
    j["query"] = query;
    j["directory"] = dir_path;
    j["totalResults"] = results.size();
    j["parseTimeMs"] = batch.parse_time_ms;
    j["results"] = json::array();

    for (const auto& [file, context] : results) {
        j["results"].push_back(json::object({
            {"file", file},
            {"context", context}
        }));
    }

    output_json(j, output_path, pretty);
}

// ── lua extract-ui — extraction elements UI et strings CRC32 ────────

static void cmd_lua_extract_ui(const std::string& file_path,
                               const std::string& output_path,
                               bool pretty) {
    if (!fs::exists(file_path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", file_path));
        return;
    }

    spdlog::info("lua extract-ui: analyse de '{}'...", file_path);

    scripting::LuaParser parser;
    auto result = parser.parse_file(file_path);

    if (!result.ok) {
        emit_error(fmt::format("echec du parsing : {}", result.error));
        return;
    }

    // Construire le JSON de sortie specifique extract-ui
    json j;
    j["ok"] = true;
    j["path"] = result.path;
    j["crc32Strings"] = result.crc32_strings;

    j["uiElements"] = json::array();
    for (const auto& ui : result.ui_elements) {
        j["uiElements"].push_back({
            {"name", ui.name},
            {"category", ui.category},
            {"rawValue", ui.raw_value}
        });
    }

    output_json(j, output_path, pretty);
}

// ── lua extract-constants — extraction des constantes de jeu ────────
//
// Meme logique que packages/inagle/src/scripts/analyze/extract-game-constants.ts :
// lit les strings passees a CRC32(), calcule leur hash, resout via menu_text,
// puis categorise par prefixe (series, raretes, elements, postes...).

static void cmd_lua_extract_constants(const std::string& file_path,
                                      const std::string& menu_text_path,
                                      const std::string& output_path,
                                      bool pretty) {
    if (!fs::exists(file_path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", file_path));
        return;
    }

    // Charger le dictionnaire CRC32 → texte japonais
    auto dict = load_menu_text(menu_text_path);
    spdlog::info("lua extract-constants: {} entrees menu_text chargees", dict.size());

    // Parser le fichier Lua
    scripting::LuaParser parser;
    auto result = parser.parse_file(file_path);
    if (!result.ok) {
        emit_error(fmt::format("echec du parsing : {}", result.error));
        return;
    }

    spdlog::info("lua extract-constants: {} strings CRC32 extraites", result.crc32_strings.size());

    // Helper : construire une entree JSON pour une string (hash + label resolu)
    auto make_entry = [&](const std::string& s) -> json {
        uint32_t hash = iecode::crypto::crc32_compute(s);
        json e;
        e["name"]  = s;
        e["crc32"] = to_hex8(hash);
        auto it = dict.find(hash);
        if (it != dict.end()) e["label"] = it->second;
        return e;
    };

    // Categorisation par prefixe — prefixes identifies dans chara_filter_menu
    std::unordered_map<std::string, json> cats;
    for (const auto& cat : { "tabs", "series", "positions", "elements", "rarities",
                               "genders", "bodyTypes", "buildTypes", "roles", "other" }) {
        cats[cat] = json::array();
    }

    for (const auto& s : result.crc32_strings) {
        if (s.find("_dmy") != std::string::npos) continue;  // dummy UI slots

        auto e = make_entry(s);

        if      (s.rfind("chara_filter_menu_tab_text_",   0) == 0) cats["tabs"].push_back(e);
        else if (s.rfind("chara_series_",                 0) == 0) cats["series"].push_back(e);
        else if (s.rfind("icon_cmd_position",             0) == 0) cats["positions"].push_back(e);
        else if (s.rfind("chara_filter_menu_element_",    0) == 0) cats["elements"].push_back(e);
        else if (s.rfind("gtxt_rarity",                   0) == 0) cats["rarities"].push_back(e);
        else if (s.rfind("chara_filter_menu_gender_",     0) == 0) cats["genders"].push_back(e);
        else if (s.rfind("chara_filter_menu_body_category_", 0) == 0) cats["bodyTypes"].push_back(e);
        else if (s.rfind("team_build_type_",              0) == 0) cats["buildTypes"].push_back(e);
        else if (s.rfind("chara_filter_menu_build_",      0) == 0) cats["roles"].push_back(e);
        else                                                         cats["other"].push_back(e);
    }

    json out;
    out["ok"]               = true;
    out["path"]             = result.path;
    out["menuTextEntries"]  = dict.size();
    out["crc32StringsTotal"] = result.crc32_strings.size();

    for (auto& [cat, arr] : cats) {
        out[cat] = std::move(arr);
    }

    output_json(out, output_path, pretty);
}

// ── Etats pour les callbacks (shared_ptr, pas de references pendantes) ──

struct LuaParseState {
    std::string file_path;
    std::string output;
    bool pretty = false;
};

struct LuaBatchState {
    std::string dir_path;
    std::string glob = "*.lua";
    std::string output;
    bool pretty = false;
};

struct LuaSearchState {
    std::string dir_path;
    std::string query;
    std::string glob = "*.lua";
    std::string output;
    bool pretty = false;
    int limit = 200;
};

struct LuaExtractUiState {
    std::string file_path;
    std::string output;
    bool pretty = false;
};

struct LuaExtractConstantsState {
    std::string file_path;
    std::string menu_text_path;
    std::string output;
    bool pretty = false;
};

// ── Enregistrement ──────────────────────────────────────────────────

void register_lua_command(CLI::App& app) {
    auto* lua = app.add_subcommand("lua",
        "Analyse statique des scripts Lua decompiles via tree-sitter");

    // ── lua parse ───────────────────────────────────────────────
    {
        auto* cmd = lua->add_subcommand("parse", "Parse un fichier Lua et affiche le JSON");

        auto state = std::make_shared<LuaParseState>();

        cmd->add_option("file", state->file_path, "Chemin vers le fichier .lua")
            ->required()
            ->check(CLI::ExistingFile);

        cmd->add_option("-o,--out", state->output,
                        "Fichier de sortie JSON (stdout si omis)");

        cmd->add_flag("--pretty,-p", state->pretty,
                      "JSON indente (defaut : compact)");

        cmd->callback([state]() {
            cmd_lua_parse(state->file_path, state->output, state->pretty);
        });
    }

    // ── lua batch ───────────────────────────────────────────────
    {
        auto* cmd = lua->add_subcommand("batch", "Parse tous les .lua d'un repertoire");

        auto state = std::make_shared<LuaBatchState>();

        cmd->add_option("dir", state->dir_path, "Repertoire a analyser")
            ->required()
            ->check(CLI::ExistingDirectory);

        cmd->add_option("--glob,-g", state->glob,
                        "Glob pattern pour filtrer les fichiers")
            ->default_val("*.lua");

        cmd->add_option("-o,--out", state->output,
                        "Fichier de sortie JSON (stdout si omis)");

        cmd->add_flag("--pretty,-p", state->pretty,
                      "JSON indente (defaut : compact)");

        cmd->callback([state]() {
            cmd_lua_batch(state->dir_path, state->glob, state->output, state->pretty);
        });
    }

    // ── lua search ──────────────────────────────────────────────
    {
        auto* cmd = lua->add_subcommand("search",
            "Cherche un keyword dans tous les fichiers Lua d'un repertoire");

        auto state = std::make_shared<LuaSearchState>();

        cmd->add_option("dir", state->dir_path, "Repertoire a analyser")
            ->required()
            ->check(CLI::ExistingDirectory);

        cmd->add_option("query", state->query, "Terme de recherche")
            ->required();

        cmd->add_option("--glob,-g", state->glob,
                        "Glob pattern pour filtrer les fichiers")
            ->default_val("*.lua");

        cmd->add_option("-o,--out", state->output,
                        "Fichier de sortie JSON (stdout si omis)");

        cmd->add_flag("--pretty,-p", state->pretty,
                      "JSON indente (defaut : compact)");

        cmd->add_option("--limit,-l", state->limit, "Nombre max de resultats")
            ->default_val(200);

        cmd->callback([state]() {
            cmd_lua_search(state->dir_path, state->query, state->glob,
                           state->output, state->pretty, state->limit);
        });
    }

    // ── lua extract-ui ──────────────────────────────────────────
    {
        auto* cmd = lua->add_subcommand("extract-ui",
            "Extrait les elements UI et strings CRC32 d'un fichier Lua");

        auto state = std::make_shared<LuaExtractUiState>();

        cmd->add_option("file", state->file_path, "Chemin vers le fichier .lua")
            ->required()
            ->check(CLI::ExistingFile);

        cmd->add_option("-o,--out", state->output,
                        "Fichier de sortie JSON (stdout si omis)");

        cmd->add_flag("--pretty,-p", state->pretty,
                      "JSON indente (defaut : compact)");

        cmd->callback([state]() {
            cmd_lua_extract_ui(state->file_path, state->output, state->pretty);
        });
    }

    // ── lua extract-constants ───────────────────────────────────────
    {
        auto* cmd = lua->add_subcommand("extract-constants",
            "Extrait les constantes de jeu (raretes, series, elements, postes...) d'un script Lua decompile");

        auto state = std::make_shared<LuaExtractConstantsState>();

        cmd->add_option("file", state->file_path, "Fichier Lua decompile (ex: chara_filter_menu_*.lua)")
            ->required()
            ->check(CLI::ExistingFile);

        cmd->add_option("--menu-text,-m", state->menu_text_path,
                        "menu_text.cfg.bin.json pour resoudre les labels japonais (optionnel)");

        cmd->add_option("-o,--out", state->output,
                        "Fichier de sortie JSON (stdout si omis)");

        cmd->add_flag("--pretty,-p", state->pretty,
                      "JSON indente (defaut : compact)");

        cmd->callback([state]() {
            cmd_lua_extract_constants(state->file_path, state->menu_text_path,
                                      state->output, state->pretty);
        });
    }
}

} // namespace iecode::cli
