#pragma once

/// @file nie_parser.h
/// Parser natif pour nie.c (decompilation Ghidra de nie.exe).
///
/// Construit un index complet des fonctions, globals, strings,
/// constantes hex et classes RTTI en parsant le fichier via mmap.
/// Performance cible : < 5 secondes pour 127 MB.

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace iecode::decomp {

// ── Structures d'index ──────────────────────────────────────────────

/// Fonction decompilee (FUN_14*).
struct NieFunction {
    std::string name;
    std::string return_type;
    std::string params;
    uint32_t start_line = 0;
    uint32_t end_line = 0;
    std::vector<std::string> callees;       // FUN_14* appeles dans le body
    std::vector<std::string> strings;       // string literals dans le body
    std::vector<std::string> hex_constants; // 0x* dans le body
    std::vector<std::string> dat_refs;      // DAT_14* references dans le body
};

/// Variable globale (DAT_14*).
struct NieGlobal {
    std::string type;
    uint32_t ref_count = 0;
};

/// Index complet du fichier nie.c.
struct NieIndex {
    uint32_t total_lines = 0;
    uint32_t total_functions = 0;
    uint32_t total_globals = 0;
    uint32_t total_strings = 0;
    double parse_time_ms = 0;

    std::unordered_map<std::string, NieFunction> functions;
    std::unordered_map<std::string, NieGlobal> globals;
    std::unordered_map<std::string, std::vector<std::string>> all_strings; // string -> [fonctions]
    std::unordered_map<std::string, uint32_t> hex_constants;               // hex -> nombre d'occurrences
    std::vector<std::string> rtti_classes;
};

// ── API principale ──────────────────────────────────────────────────

/// Parse nie.c par mmap et construit l'index complet.
/// @param path Chemin vers nie.c
/// @return Index complet (vide si echec, avec total_lines = 0)
[[nodiscard]] NieIndex parse_nie(const std::string& path);

// ── Recherche ───────────────────────────────────────────────────────

/// Resultat de recherche dans l'index.
struct NieSearchResult {
    std::string name;
    std::string type;    // "function", "global", "string", "rtti"
    std::string detail;  // info supplementaire (type retour, nb refs, etc.)
    uint32_t line = 0;
};

/// Recherche dans un index avec un query textuel.
/// @param index Index construit par parse_nie()
/// @param query Terme de recherche (substring match, ou regex si use_regex=true)
/// @param scope Scope de recherche : "all", "functions", "strings", "hex", "globals", "rtti"
/// @param use_regex Si true, query est interprete comme une regex
/// @return Liste des resultats correspondants
[[nodiscard]] std::vector<NieSearchResult> search_nie(
    const NieIndex& index,
    const std::string& query,
    const std::string& scope = "all",
    bool use_regex = false);

/// Serialise l'index en JSON (compatible nie-c-index.json).
/// @param index Index a serialiser
/// @return JSON string
[[nodiscard]] std::string index_to_json(const NieIndex& index);

} // namespace iecode::decomp
