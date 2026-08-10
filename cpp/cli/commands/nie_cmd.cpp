/// @file nie_cmd.cpp
/// Commande CLI 'nie' — indexation et recherche dans nie.c (decompilation Ghidra).
///
/// Sous-commandes :
///   iecode nie index <path>   Genere l'index JSON du fichier nie.c
///   iecode nie search <query> Recherche dans l'index
///   iecode nie stats          Statistiques resumees
///
/// Le parsing utilise mmap pour la performance (~5 sec pour 127 MB).

#include "commands.h"
#include "cli_helpers.h"

#include "decomp/nie_parser.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── nie index — construire l'index JSON ─────────────────────────────

static void cmd_nie_index(const std::string& nie_path,
                          const std::string& output_path) {
    if (!fs::exists(nie_path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", nie_path));
        return;
    }

    spdlog::info("nie index: parsing '{}'...", nie_path);

    auto index = decomp::parse_nie(nie_path);
    if (index.total_lines == 0) {
        emit_error("echec du parsing de nie.c");
        return;
    }

    auto json_str = decomp::index_to_json(index);

    if (!output_path.empty()) {
        // Ecrire dans un fichier
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
            {"output", output_path},
            {"totalFunctions", index.total_functions},
            {"totalGlobals", index.total_globals},
            {"totalStrings", index.total_strings},
            {"rttiClasses", index.rtti_classes.size()},
            {"parseTimeMs", index.parse_time_ms}
        }));
    } else {
        // Ecrire sur stdout
        fmt::print("{}\n", json_str);
    }
}

// ── nie search — rechercher dans l'index ────────────────────────────

static void cmd_nie_search(const std::string& query,
                           const std::string& scope,
                           const std::string& nie_path,
                           const std::string& index_path,
                           bool use_regex,
                           int limit) {
    decomp::NieIndex index;

    if (!index_path.empty() && fs::exists(index_path)) {
        // Charger l'index depuis un fichier JSON
        spdlog::info("nie search: chargement de l'index '{}'", index_path);
        std::ifstream in(index_path);
        if (!in) {
            emit_error(fmt::format("impossible de lire '{}'", index_path));
            return;
        }
        // On ne deserialise pas l'index complet pour la recherche —
        // c'est plus rapide de re-parser nie.c que de parser 19 MB de JSON.
        // Donc on utilise le chemin --nie si fourni.
        spdlog::warn("nie search: deserialization JSON non implementee, utiliser --nie pour re-parser");
        emit_error("utiliser --nie <path> pour fournir le fichier nie.c directement");
        return;
    }

    if (nie_path.empty()) {
        emit_error("fournir --nie <path> pour le fichier nie.c");
        return;
    }

    if (!fs::exists(nie_path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", nie_path));
        return;
    }

    // Parser nie.c
    index = decomp::parse_nie(nie_path);
    if (index.total_lines == 0) {
        emit_error("echec du parsing de nie.c");
        return;
    }

    // Rechercher
    auto results = decomp::search_nie(index, query, scope, use_regex);

    // Limiter les resultats
    if (limit > 0 && static_cast<int>(results.size()) > limit) {
        results.resize(static_cast<size_t>(limit));
    }

    // Emettre en JSON
    json j;
    j["ok"] = true;
    j["query"] = query;
    j["scope"] = scope;
    j["totalResults"] = results.size();
    j["results"] = json::array();
    for (const auto& r : results) {
        j["results"].push_back(json::object({
            {"name", r.name},
            {"type", r.type},
            {"detail", r.detail},
            {"line", r.line}
        }));
    }
    emit(j);
}

// ── nie stats — statistiques resumees ───────────────────────────────

static void cmd_nie_stats(const std::string& nie_path) {
    if (!fs::exists(nie_path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", nie_path));
        return;
    }

    auto index = decomp::parse_nie(nie_path);
    if (index.total_lines == 0) {
        emit_error("echec du parsing de nie.c");
        return;
    }

    // Calculer quelques stats supplementaires
    uint32_t total_callees = 0;
    uint32_t max_callees = 0;
    std::string max_callees_func;
    uint32_t total_strings_refs = 0;
    uint32_t funcs_with_strings = 0;
    uint64_t total_func_lines = 0;

    for (const auto& [name, func] : index.functions) {
        auto n_callees = static_cast<uint32_t>(func.callees.size());
        total_callees += n_callees;
        if (n_callees > max_callees) {
            max_callees = n_callees;
            max_callees_func = name;
        }
        if (!func.strings.empty()) {
            ++funcs_with_strings;
            total_strings_refs += static_cast<uint32_t>(func.strings.size());
        }
        if (func.end_line > func.start_line) {
            total_func_lines += func.end_line - func.start_line;
        }
    }

    // Top 10 fonctions par nombre de callees
    std::vector<std::pair<std::string, uint32_t>> callee_ranking;
    callee_ranking.reserve(index.functions.size());
    for (const auto& [name, func] : index.functions) {
        callee_ranking.emplace_back(name, static_cast<uint32_t>(func.callees.size()));
    }
    std::partial_sort(callee_ranking.begin(),
                      callee_ranking.begin() + std::min<size_t>(10, callee_ranking.size()),
                      callee_ranking.end(),
                      [](const auto& a, const auto& b) { return a.second > b.second; });

    json top_callees = json::array();
    for (size_t i = 0; i < std::min<size_t>(10, callee_ranking.size()); ++i) {
        top_callees.push_back(json::object({
            {"name", callee_ranking[i].first},
            {"callees", callee_ranking[i].second}
        }));
    }

    // Top 10 fonctions par taille (nombre de lignes)
    std::vector<std::pair<std::string, uint32_t>> size_ranking;
    size_ranking.reserve(index.functions.size());
    for (const auto& [name, func] : index.functions) {
        if (func.end_line > func.start_line) {
            size_ranking.emplace_back(name, func.end_line - func.start_line);
        }
    }
    std::partial_sort(size_ranking.begin(),
                      size_ranking.begin() + std::min<size_t>(10, size_ranking.size()),
                      size_ranking.end(),
                      [](const auto& a, const auto& b) { return a.second > b.second; });

    json top_sizes = json::array();
    for (size_t i = 0; i < std::min<size_t>(10, size_ranking.size()); ++i) {
        top_sizes.push_back(json::object({
            {"name", size_ranking[i].first},
            {"lines", size_ranking[i].second}
        }));
    }

    json j;
    j["ok"] = true;
    j["totalLines"] = index.total_lines;
    j["totalFunctions"] = index.total_functions;
    j["totalGlobals"] = index.total_globals;
    j["totalStrings"] = index.total_strings;
    j["totalRttiClasses"] = index.rtti_classes.size();
    j["totalHexConstants"] = index.hex_constants.size();
    j["parseTimeMs"] = index.parse_time_ms;
    j["avgCalleesPerFunction"] = index.total_functions > 0
        ? static_cast<double>(total_callees) / index.total_functions
        : 0.0;
    j["maxCallees"] = json::object({
        {"function", max_callees_func},
        {"count", max_callees}
    });
    j["functionsWithStrings"] = funcs_with_strings;
    j["totalStringRefs"] = total_strings_refs;
    j["avgLinesPerFunction"] = index.total_functions > 0
        ? static_cast<double>(total_func_lines) / index.total_functions
        : 0.0;
    j["topByCallees"] = top_callees;
    j["topBySize"] = top_sizes;

    emit(j);
}

// ── Etat pour le callback search (evite les captures par reference pendantes) ──

struct SearchState {
    std::string query;
    std::string scope = "all";
    std::string nie_path;
    std::string index_path;
    bool use_regex = false;
    int limit = 100;
};

// ── Enregistrement ──────────────────────────────────────────────────

void register_nie_command(CLI::App& app) {
    auto* nie = app.add_subcommand("nie", "Indexation et recherche dans nie.c (decompilation Ghidra)");

    // ── nie index ───────────────────────────────────────────────
    {
        auto* cmd = nie->add_subcommand("index", "Construit l'index JSON du fichier nie.c");

        auto idx_state = std::make_shared<std::pair<std::string, std::string>>();

        cmd->add_option("path", idx_state->first, "Chemin vers nie.c")
            ->required()
            ->check(CLI::ExistingFile);

        cmd->add_option("-o,--output", idx_state->second, "Fichier de sortie JSON (stdout si omis)");

        cmd->callback([idx_state]() {
            cmd_nie_index(idx_state->first, idx_state->second);
        });
    }

    // ── nie search ──────────────────────────────────────────────
    {
        auto* cmd = nie->add_subcommand("search", "Recherche dans l'index nie.c");

        // Stocker dans des shared_ptr pour eviter les references pendantes
        auto state = std::make_shared<struct SearchState>();

        cmd->add_option("query", state->query, "Terme de recherche")
            ->required();

        cmd->add_option("--scope,-s", state->scope,
                        "Scope : all, functions, strings, hex, globals, rtti")
            ->default_val("all");

        cmd->add_option("--nie,-n", state->nie_path, "Chemin vers nie.c");

        cmd->add_option("--index,-i", state->index_path, "Chemin vers l'index JSON");

        cmd->add_flag("--regex,-r", state->use_regex, "Interpreter le query comme une regex");

        cmd->add_option("--limit,-l", state->limit, "Nombre max de resultats")
            ->default_val(100);

        cmd->callback([state]() {
            cmd_nie_search(state->query, state->scope, state->nie_path,
                           state->index_path, state->use_regex, state->limit);
        });
    }

    // ── nie stats ───────────────────────────────────────────────
    {
        auto* cmd = nie->add_subcommand("stats", "Statistiques resumees de nie.c");

        auto stats_path = std::make_shared<std::string>();

        cmd->add_option("path", *stats_path, "Chemin vers nie.c")
            ->required()
            ->check(CLI::ExistingFile);

        cmd->callback([stats_path]() {
            cmd_nie_stats(*stats_path);
        });
    }
}

} // namespace iecode::cli
