/// @file lua_parser.cpp
/// Implementation du parser statique Lua via tree-sitter-lua.
///
/// Extrait globals, tables, fonctions et strings des scripts Lua
/// decompiles sans les executer.

#include "iecode/scripting/lua_parser.h"

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <utility>

// tree-sitter headers
#include <tree_sitter/api.h>

// Declaration externe de la grammaire Lua
extern "C" const TSLanguage* tree_sitter_lua();

namespace fs = std::filesystem;

namespace iecode::scripting {

// -- Helpers internes ---------------------------------------------------------

namespace {

/// Lit un fichier complet en string.
[[nodiscard]] std::string read_file_text(const std::string& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) return {};
    const auto size = file.tellg();
    if (size <= 0) return {};
    std::string content(static_cast<size_t>(size), '\0');
    file.seekg(0);
    file.read(content.data(), size);
    return content;
}

/// Extrait le texte d'un noeud TSNode depuis la source.
[[nodiscard]] std::string node_text(TSNode node, const std::string& source) {
    auto start = ts_node_start_byte(node);
    auto end = ts_node_end_byte(node);
    if (end > source.size()) end = static_cast<uint32_t>(source.size());
    if (start >= end) return {};
    return source.substr(start, end - start);
}

/// Determine le type de valeur d'un noeud expression.
[[nodiscard]] std::string classify_value_type(TSNode node) {
    std::string_view type = ts_node_type(node);
    if (type == "string" || type == "string_content") return "string";
    if (type == "number") return "number";
    if (type == "true" || type == "false") return "bool";
    if (type == "table_constructor" || type == "table") return "table";
    if (type == "function_definition" || type == "function_call") return "function";
    if (type == "nil") return "nil";
    return "other";
}

/// Matching glob simple (supporte * et ?).
[[nodiscard]] bool glob_match(std::string_view pattern, std::string_view text) {
    size_t pi = 0;
    size_t ti = 0;
    size_t star_pi = std::string_view::npos;
    size_t star_ti = 0;

    while (ti < text.size()) {
        if (pi < pattern.size() && (pattern[pi] == '?' || pattern[pi] == text[ti])) {
            ++pi;
            ++ti;
        } else if (pi < pattern.size() && pattern[pi] == '*') {
            star_pi = pi;
            star_ti = ti;
            ++pi;
        } else if (star_pi != std::string_view::npos) {
            pi = star_pi + 1;
            ++star_ti;
            ti = star_ti;
        } else {
            return false;
        }
    }

    while (pi < pattern.size() && pattern[pi] == '*') ++pi;
    return pi == pattern.size();
}

/// Verifie si une string est "interessante" (pas triviale).
[[nodiscard]] bool is_interesting_string(std::string_view s) {
    if (s.size() <= 3) return false;
    // Enlever les quotes
    if (s.size() >= 2 && (s.front() == '"' || s.front() == '\'')) {
        s = s.substr(1, s.size() - 2);
    }
    if (s.size() <= 3) return false;
    // Pas juste des chiffres
    bool all_digits = std::all_of(s.begin(), s.end(), [](char c) {
        return c >= '0' && c <= '9';
    });
    return !all_digits;
}

/// Supprime les quotes autour d'une string litterale.
[[nodiscard]] std::string strip_quotes(std::string_view s) {
    if (s.size() >= 2) {
        if ((s.front() == '"' && s.back() == '"') ||
            (s.front() == '\'' && s.back() == '\'')) {
            return std::string(s.substr(1, s.size() - 2));
        }
        // Long strings [[ ... ]]
        if (s.size() >= 4 && s.substr(0, 2) == "[[" && s.substr(s.size() - 2) == "]]") {
            return std::string(s.substr(2, s.size() - 4));
        }
    }
    return std::string(s);
}

/// Verifie si une string ressemble a un nom de ressource UI.
/// Criteres : contient '_', longueur > 5, pas que des chiffres, pas d'espaces.
[[nodiscard]] bool is_ui_resource_name(std::string_view s) {
    if (s.size() <= 5) return false;
    if (s.find(' ') != std::string_view::npos) return false;
    if (s.find('_') == std::string_view::npos && s.find('#') == std::string_view::npos)
        return false;
    // Pas juste des chiffres et underscores
    bool has_alpha = std::any_of(s.begin(), s.end(), [](char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    });
    return has_alpha;
}

/// Categorise une string UI en fonction de son prefixe/contenu.
/// @return Categorie ou chaine vide si pas un element UI identifiable.
[[nodiscard]] std::string categorize_ui_element(std::string_view name) {
    if (name.substr(0, 3) == "win") return "window";
    if (name.substr(0, 3) == "cmn") return "component";
    if (name.substr(0, 5) == "icon_") return "icon";
    if (name.find("_button") != std::string_view::npos) return "button";
    if (name.substr(0, 3) == "btn") return "button";
    if (name.find("#/") != std::string_view::npos) return "path";
    return "other";
}

/// Parcours recursif complet de l'AST pour extraire les appels CRC32.
/// Capture les patterns : CRC32("string"), (upval.CRC32)("string"),
/// et toute function_call dont le texte contient "CRC32".
void extract_crc32_calls(TSNode node,
                         const std::string& source,
                         std::vector<std::string>& crc32_strings) {
    std::string_view node_type = ts_node_type(node);

    if (node_type == "function_call") {
        // Verifier si le texte du noeud de la fonction appelée contient "CRC32"
        std::string call_text = node_text(node, source);
        if (call_text.find("CRC32") != std::string::npos) {
            // Chercher le premier argument string dans les enfants
            uint32_t child_count = ts_node_child_count(node);
            for (uint32_t i = 0; i < child_count; ++i) {
                TSNode child = ts_node_child(node, i);
                std::string_view ct = ts_node_type(child);

                // arguments node contient les parametres
                if (ct == "arguments") {
                    uint32_t arg_count = ts_node_named_child_count(child);
                    for (uint32_t j = 0; j < arg_count; ++j) {
                        TSNode arg = ts_node_named_child(child, j);
                        std::string_view at = ts_node_type(arg);
                        if (at == "string") {
                            std::string val = strip_quotes(node_text(arg, source));
                            if (!val.empty()) {
                                crc32_strings.push_back(std::move(val));
                            }
                            return; // On ne prend que le premier argument string
                        }
                    }
                }

                // Pattern direct : la string peut etre un enfant direct (certaines grammaires)
                if (ct == "string") {
                    std::string val = strip_quotes(node_text(child, source));
                    if (!val.empty()) {
                        crc32_strings.push_back(std::move(val));
                    }
                    return;
                }
            }
        }
    }

    // Descendre recursivement dans tous les enfants
    uint32_t child_count = ts_node_child_count(node);
    for (uint32_t i = 0; i < child_count; ++i) {
        extract_crc32_calls(ts_node_child(node, i), source, crc32_strings);
    }
}

/// Parcourt recursivement un noeud pour extraire les champs d'une table.
void extract_table_fields(TSNode table_node,
                          const std::string& source,
                          std::vector<LuaTableField>& fields) {
    uint32_t child_count = ts_node_named_child_count(table_node);
    for (uint32_t i = 0; i < child_count; ++i) {
        TSNode child = ts_node_named_child(table_node, i);
        std::string_view child_type = ts_node_type(child);

        if (child_type == "field") {
            LuaTableField field;
            // Un champ peut avoir un name (cle) et une value
            TSNode name_node = ts_node_child_by_field_name(child, "name", 4);
            TSNode value_node = ts_node_child_by_field_name(child, "value", 5);

            if (!ts_node_is_null(name_node)) {
                field.key = node_text(name_node, source);
            }
            if (!ts_node_is_null(value_node)) {
                field.value_type = classify_value_type(value_node);
                field.raw_value = node_text(value_node, source);
            } else {
                // Champ positionnel — la valeur est le premier enfant nomme
                TSNode val = ts_node_named_child(child, 0);
                if (!ts_node_is_null(val)) {
                    field.value_type = classify_value_type(val);
                    field.raw_value = node_text(val, source);
                }
            }
            fields.push_back(std::move(field));
        }
    }
}

} // namespace anonyme

// -- Impl (pimpl) ------------------------------------------------------------

struct LuaParser::Impl {
    const TSLanguage* language = nullptr;

    Impl() : language(tree_sitter_lua()) {}
};

// -- Constructeurs / destructeur ---------------------------------------------

LuaParser::LuaParser() : impl_(std::make_unique<Impl>()) {}

LuaParser::~LuaParser() = default;

LuaParser::LuaParser(LuaParser&&) noexcept = default;

LuaParser& LuaParser::operator=(LuaParser&&) noexcept = default;

// -- parse_file ---------------------------------------------------------------

LuaFileResult LuaParser::parse_file(const std::string& path) const {
    LuaFileResult result;
    result.path = path;

    // Lire le fichier
    std::string source = read_file_text(path);
    if (source.empty()) {
        result.error = fmt::format("impossible de lire '{}'", path);
        return result;
    }

    // Creer le parser tree-sitter
    TSParser* parser = ts_parser_new();
    if (!parser) {
        result.error = "echec de creation du parser tree-sitter";
        return result;
    }

    if (!ts_parser_set_language(parser, impl_->language)) {
        result.error = "echec de l'assignation de la grammaire Lua";
        ts_parser_delete(parser);
        return result;
    }

    // Parser le source
    TSTree* tree = ts_parser_parse_string(parser, nullptr,
                                          source.c_str(),
                                          static_cast<uint32_t>(source.size()));
    if (!tree) {
        result.error = "echec du parsing tree-sitter";
        ts_parser_delete(parser);
        return result;
    }

    TSNode root = ts_tree_root_node(tree);

    // Verifier les erreurs de parsing (mais continuer quand meme)
    if (ts_node_has_error(root)) {
        spdlog::debug("lua_parser: erreurs de syntaxe dans '{}', extraction partielle", path);
    }

    // On marque ok = true meme avec des erreurs (extraction partielle)
    result.ok = true;

    // Parcours iteratif de l'AST avec un cursor
    TSTreeCursor cursor = ts_tree_cursor_new(root);

    // Parcours DFS de tout l'arbre
    bool descend = true;
    do {
        TSNode node = ts_tree_cursor_current_node(&cursor);
        std::string_view node_type = ts_node_type(node);

        // -- Assignments top-level : identifier = expression
        if (node_type == "assignment_statement") {
            // variable_list = expression_list
            TSNode var_list = ts_node_child_by_field_name(node, "variables", 9);
            TSNode expr_list = ts_node_child_by_field_name(node, "values", 6);

            // Fallback : chercher par position des enfants nommes
            if (ts_node_is_null(var_list)) {
                // L'assignation dans tree-sitter-lua peut avoir des noeuds differents
                // Parcourir les enfants nommes
                uint32_t named_count = ts_node_named_child_count(node);
                for (uint32_t i = 0; i < named_count; ++i) {
                    TSNode child = ts_node_named_child(node, i);
                    std::string_view ct = ts_node_type(child);
                    if (ct == "variable_list") var_list = child;
                    else if (ct == "expression_list") expr_list = child;
                }
            }

            if (!ts_node_is_null(var_list) && !ts_node_is_null(expr_list)) {
                uint32_t var_count = ts_node_named_child_count(var_list);
                uint32_t expr_count = ts_node_named_child_count(expr_list);
                uint32_t pairs = std::min(var_count, expr_count);

                for (uint32_t i = 0; i < pairs; ++i) {
                    TSNode var_node = ts_node_named_child(var_list, i);
                    TSNode val_node = ts_node_named_child(expr_list, i);
                    std::string var_name = node_text(var_node, source);
                    std::string val_type = classify_value_type(val_node);
                    std::string raw_val = node_text(val_node, source);
                    uint32_t line = ts_node_start_point(node).row + 1;

                    // Si c'est une table, l'extraire en detail
                    if (val_type == "table") {
                        LuaTable table;
                        table.name = var_name;
                        table.line = line;
                        extract_table_fields(val_node, source, table.fields);
                        result.tables.push_back(std::move(table));
                    }

                    LuaGlobal global;
                    global.name = std::move(var_name);
                    global.value_type = std::move(val_type);
                    global.raw_value = std::move(raw_val);
                    global.line = line;
                    result.globals.push_back(std::move(global));
                }
            }
            descend = false; // pas besoin de descendre dans les enfants
        }

        // -- Variable declarations : local x = ...
        else if (node_type == "variable_declaration") {
            uint32_t named_count = ts_node_named_child_count(node);
            // Chercher assignment_statement ou variable_list + expression_list
            TSNode name_list{};
            TSNode val_list{};

            for (uint32_t i = 0; i < named_count; ++i) {
                TSNode child = ts_node_named_child(node, i);
                std::string_view ct = ts_node_type(child);
                if (ct == "variable_list") name_list = child;
                else if (ct == "expression_list") val_list = child;
                else if (ct == "assignment_statement") {
                    // Parfois tree-sitter-lua wrappe dans un assignment_statement
                    uint32_t asc = ts_node_named_child_count(child);
                    for (uint32_t j = 0; j < asc; ++j) {
                        TSNode ac = ts_node_named_child(child, j);
                        std::string_view act = ts_node_type(ac);
                        if (act == "variable_list") name_list = ac;
                        else if (act == "expression_list") val_list = ac;
                    }
                }
            }

            if (!ts_node_is_null(name_list) && !ts_node_is_null(val_list)) {
                uint32_t nc = ts_node_named_child_count(name_list);
                uint32_t vc = ts_node_named_child_count(val_list);
                uint32_t pairs = std::min(nc, vc);

                for (uint32_t i = 0; i < pairs; ++i) {
                    TSNode n = ts_node_named_child(name_list, i);
                    TSNode v = ts_node_named_child(val_list, i);
                    std::string name = node_text(n, source);
                    std::string vt = classify_value_type(v);
                    std::string rv = node_text(v, source);
                    uint32_t line = ts_node_start_point(node).row + 1;

                    if (vt == "table") {
                        LuaTable table;
                        table.name = name;
                        table.line = line;
                        extract_table_fields(v, source, table.fields);
                        result.tables.push_back(std::move(table));
                    }

                    LuaGlobal global;
                    global.name = std::move(name);
                    global.value_type = std::move(vt);
                    global.raw_value = std::move(rv);
                    global.line = line;
                    result.globals.push_back(std::move(global));
                }
            }
            descend = false;
        }

        // -- Fonctions globales : function name(...) ... end
        else if (node_type == "function_declaration" || node_type == "function_statement") {
            LuaFunction func;
            // Chercher le nom de la fonction
            TSNode name_node = ts_node_child_by_field_name(node, "name", 4);
            if (!ts_node_is_null(name_node)) {
                func.name = node_text(name_node, source);
            } else {
                // Fallback : premier enfant nomme de type identifier ou function_name
                uint32_t nc = ts_node_named_child_count(node);
                for (uint32_t i = 0; i < nc; ++i) {
                    TSNode c = ts_node_named_child(node, i);
                    std::string_view ct = ts_node_type(c);
                    if (ct == "identifier" || ct == "function_name" ||
                        ct == "function_name_field" || ct == "dot_index_expression") {
                        func.name = node_text(c, source);
                        break;
                    }
                }
            }

            // Chercher les parametres
            TSNode params_node = ts_node_child_by_field_name(node, "parameters", 10);
            if (ts_node_is_null(params_node)) {
                // Fallback : chercher un noeud parameters
                uint32_t nc = ts_node_named_child_count(node);
                for (uint32_t i = 0; i < nc; ++i) {
                    TSNode c = ts_node_named_child(node, i);
                    if (std::string_view(ts_node_type(c)) == "parameters") {
                        params_node = c;
                        break;
                    }
                }
            }
            if (!ts_node_is_null(params_node)) {
                uint32_t pc = ts_node_named_child_count(params_node);
                for (uint32_t i = 0; i < pc; ++i) {
                    TSNode p = ts_node_named_child(params_node, i);
                    func.params.push_back(node_text(p, source));
                }
            }

            func.start_line = ts_node_start_point(node).row + 1;
            func.end_line = ts_node_end_point(node).row + 1;
            result.functions.push_back(std::move(func));
            descend = false;
        }

        // -- Strings litterales
        else if (node_type == "string" || node_type == "string_content") {
            std::string text = node_text(node, source);
            if (is_interesting_string(text)) {
                result.strings.push_back(strip_quotes(text));
            }
            descend = false;
        }

        // Pour les autres noeuds, descendre dans les enfants
        else {
            descend = true;
        }

        // Navigation DFS
        if (descend && ts_tree_cursor_goto_first_child(&cursor)) {
            continue;
        }
        descend = true;
        if (ts_tree_cursor_goto_next_sibling(&cursor)) {
            continue;
        }
        // Remonter jusqu'a trouver un frere
        while (ts_tree_cursor_goto_parent(&cursor)) {
            if (ts_tree_cursor_goto_next_sibling(&cursor)) {
                break;
            }
        }
    } while (ts_tree_cursor_current_node(&cursor).id != root.id ||
             ts_tree_cursor_goto_next_sibling(&cursor));

    // Dedupliquer les strings
    std::sort(result.strings.begin(), result.strings.end());
    auto last = std::unique(result.strings.begin(), result.strings.end());
    result.strings.erase(last, result.strings.end());

    ts_tree_cursor_delete(&cursor);

    // ── Deuxieme passe : extraction des appels CRC32 (parcours complet) ──
    extract_crc32_calls(root, source, result.crc32_strings);

    // Dedupliquer les crc32_strings
    std::sort(result.crc32_strings.begin(), result.crc32_strings.end());
    auto crc_last = std::unique(result.crc32_strings.begin(), result.crc32_strings.end());
    result.crc32_strings.erase(crc_last, result.crc32_strings.end());

    // ── Troisieme passe : collecte de TOUTES les strings de l'AST ──
    // Le DFS principal s'arrete aux fonctions (descend=false), donc les strings
    // a l'interieur des corps de fonctions ne sont jamais capturees.
    // On fait un parcours recursif complet pour les extraire.
    std::vector<std::string> all_strings;
    {
        // Fonction lambda recursive via pile (evite recursion profonde)
        std::vector<TSNode> stack;
        stack.push_back(root);
        while (!stack.empty()) {
            TSNode n = stack.back();
            stack.pop_back();
            std::string_view nt = ts_node_type(n);
            if (nt == "string") {
                std::string text = node_text(n, source);
                if (is_interesting_string(text)) {
                    all_strings.push_back(strip_quotes(text));
                }
                continue; // pas besoin de descendre dans les enfants d'une string
            }
            uint32_t cc = ts_node_child_count(n);
            for (uint32_t i = 0; i < cc; ++i) {
                stack.push_back(ts_node_child(n, i));
            }
        }
    }

    // Dedupliquer all_strings
    std::sort(all_strings.begin(), all_strings.end());
    auto all_last = std::unique(all_strings.begin(), all_strings.end());
    all_strings.erase(all_last, all_strings.end());

    // ── Detection des elements UI ──
    // On collecte les elements UI a partir de toutes les strings + crc32_strings
    {
        // Combiner toutes les strings candidates (strings completes + crc32)
        std::vector<std::string_view> candidates;
        candidates.reserve(all_strings.size() + result.crc32_strings.size());
        for (const auto& s : all_strings) {
            candidates.emplace_back(s);
        }
        for (const auto& s : result.crc32_strings) {
            candidates.emplace_back(s);
        }

        // Set pour eviter les doublons
        std::vector<std::string> seen;

        for (const auto& sv : candidates) {
            if (!is_ui_resource_name(sv)) continue;

            std::string category = categorize_ui_element(sv);
            std::string name_str(sv);

            // Eviter les doublons
            if (std::find(seen.begin(), seen.end(), name_str) != seen.end()) continue;
            seen.push_back(name_str);

            LuaUiElement elem;
            elem.name = name_str;
            elem.category = std::move(category);
            elem.raw_value = name_str;
            result.ui_elements.push_back(std::move(elem));
        }
    }

    ts_tree_delete(tree);
    ts_parser_delete(parser);

    return result;
}

// -- parse_directory ----------------------------------------------------------

LuaBatchResult LuaParser::parse_directory(const std::string& dir,
                                          const std::string& glob_pattern) const {
    LuaBatchResult batch;

    if (!fs::exists(dir) || !fs::is_directory(dir)) {
        spdlog::error("lua_parser: repertoire introuvable : '{}'", dir);
        return batch;
    }

    auto t0 = std::chrono::high_resolution_clock::now();

    // Collecter tous les fichiers .lua
    std::vector<std::string> lua_files;
    for (const auto& entry : fs::recursive_directory_iterator(
             dir, fs::directory_options::skip_permission_denied)) {
        if (!entry.is_regular_file()) continue;
        auto filename = entry.path().filename().string();
        if (glob_match(glob_pattern, filename)) {
            lua_files.push_back(entry.path().string());
        }
    }

    std::sort(lua_files.begin(), lua_files.end());

    batch.total_files = static_cast<uint32_t>(lua_files.size());
    batch.results.reserve(lua_files.size());

    for (const auto& file : lua_files) {
        auto result = parse_file(file);
        if (result.ok) {
            ++batch.ok_files;
        } else {
            ++batch.error_files;
        }
        batch.results.push_back(std::move(result));
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    batch.parse_time_ms =
        std::chrono::duration<double, std::milli>(t1 - t0).count();

    return batch;
}

// -- search -------------------------------------------------------------------

std::vector<std::pair<std::string, std::string>>
LuaParser::search(const LuaBatchResult& batch, const std::string& keyword) const {
    std::vector<std::pair<std::string, std::string>> results;

    // Recherche case-insensitive
    std::string lower_keyword = keyword;
    std::transform(lower_keyword.begin(), lower_keyword.end(),
                   lower_keyword.begin(), ::tolower);

    for (const auto& file : batch.results) {
        // Chercher dans les globals
        for (const auto& g : file.globals) {
            std::string lower_name = g.name;
            std::transform(lower_name.begin(), lower_name.end(),
                           lower_name.begin(), ::tolower);
            std::string lower_val = g.raw_value;
            std::transform(lower_val.begin(), lower_val.end(),
                           lower_val.begin(), ::tolower);

            if (lower_name.find(lower_keyword) != std::string::npos ||
                lower_val.find(lower_keyword) != std::string::npos) {
                results.emplace_back(
                    file.path,
                    fmt::format("global '{}' = {} (ligne {})",
                                g.name, g.raw_value, g.line));
            }
        }

        // Chercher dans les tables
        for (const auto& t : file.tables) {
            std::string lower_name = t.name;
            std::transform(lower_name.begin(), lower_name.end(),
                           lower_name.begin(), ::tolower);

            if (lower_name.find(lower_keyword) != std::string::npos) {
                results.emplace_back(
                    file.path,
                    fmt::format("table '{}' ({} champs, ligne {})",
                                t.name, t.fields.size(), t.line));
                continue;
            }

            for (const auto& f : t.fields) {
                std::string lower_key = f.key;
                std::transform(lower_key.begin(), lower_key.end(),
                               lower_key.begin(), ::tolower);
                std::string lower_fval = f.raw_value;
                std::transform(lower_fval.begin(), lower_fval.end(),
                               lower_fval.begin(), ::tolower);

                if (lower_key.find(lower_keyword) != std::string::npos ||
                    lower_fval.find(lower_keyword) != std::string::npos) {
                    results.emplace_back(
                        file.path,
                        fmt::format("table '{}' champ '{}' = {} (ligne {})",
                                    t.name, f.key, f.raw_value, t.line));
                }
            }
        }

        // Chercher dans les fonctions
        for (const auto& fn : file.functions) {
            std::string lower_name = fn.name;
            std::transform(lower_name.begin(), lower_name.end(),
                           lower_name.begin(), ::tolower);

            if (lower_name.find(lower_keyword) != std::string::npos) {
                results.emplace_back(
                    file.path,
                    fmt::format("function '{}' (lignes {}-{})",
                                fn.name, fn.start_line, fn.end_line));
            }
        }

        // Chercher dans les strings
        for (const auto& s : file.strings) {
            std::string lower_s = s;
            std::transform(lower_s.begin(), lower_s.end(),
                           lower_s.begin(), ::tolower);

            if (lower_s.find(lower_keyword) != std::string::npos) {
                results.emplace_back(
                    file.path,
                    fmt::format("string \"{}\"", s));
            }
        }
    }

    return results;
}

// -- Serialisation JSON -------------------------------------------------------

nlohmann::json LuaParser::to_json(const LuaFileResult& r) {
    nlohmann::json j;
    j["path"] = r.path;
    j["ok"] = r.ok;
    if (!r.error.empty()) {
        j["error"] = r.error;
    }

    // Globals
    j["globals"] = nlohmann::json::array();
    for (const auto& g : r.globals) {
        j["globals"].push_back({
            {"name", g.name},
            {"valueType", g.value_type},
            {"rawValue", g.raw_value},
            {"line", g.line}
        });
    }

    // Tables
    j["tables"] = nlohmann::json::array();
    for (const auto& t : r.tables) {
        nlohmann::json jt;
        jt["name"] = t.name;
        jt["line"] = t.line;
        jt["fields"] = nlohmann::json::array();
        for (const auto& f : t.fields) {
            jt["fields"].push_back({
                {"key", f.key},
                {"valueType", f.value_type},
                {"rawValue", f.raw_value}
            });
        }
        j["tables"].push_back(std::move(jt));
    }

    // Fonctions
    j["functions"] = nlohmann::json::array();
    for (const auto& fn : r.functions) {
        j["functions"].push_back({
            {"name", fn.name},
            {"params", fn.params},
            {"startLine", fn.start_line},
            {"endLine", fn.end_line}
        });
    }

    // Strings
    j["strings"] = r.strings;

    // Strings CRC32
    j["crc32Strings"] = r.crc32_strings;

    // Elements UI
    j["uiElements"] = nlohmann::json::array();
    for (const auto& ui : r.ui_elements) {
        j["uiElements"].push_back({
            {"name", ui.name},
            {"category", ui.category},
            {"rawValue", ui.raw_value}
        });
    }

    return j;
}

nlohmann::json LuaParser::to_json(const LuaBatchResult& r) {
    nlohmann::json j;
    j["ok"] = true;
    j["totalFiles"] = r.total_files;
    j["okFiles"] = r.ok_files;
    j["errorFiles"] = r.error_files;
    j["parseTimeMs"] = r.parse_time_ms;

    j["results"] = nlohmann::json::array();
    for (const auto& fr : r.results) {
        j["results"].push_back(to_json(fr));
    }

    return j;
}

} // namespace iecode::scripting
