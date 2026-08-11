/// @file nie_parser.cpp
/// Implementation du parser nie.c — indexation par mmap + scan lineaire.
///
/// Strategie :
/// - mmap le fichier (127 MB) pour zero-copy
/// - Scan ligne par ligne avec pointeur dans le mmap
/// - Detection des fonctions par pattern matching manuel (pas de regex)
/// - Compteur de braces pour trouver la fin de chaque fonction
/// - Extraction des callees/strings/hex/DAT par scan dans le body
/// - Support CRLF (terminaisons \r\n typiques de Ghidra sur Windows)
///
/// Performance : < 5 secondes pour 4.15M lignes (127 MB)

#include "decomp/nie_parser.h"

#include <fmt/format.h>
#include <fmt/ranges.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <mio.hpp>

#include <algorithm>
#include <chrono>
#include <cstring>
#include <fstream>
#include <regex>

namespace iecode::decomp {

// ── Helpers internes ────────────────────────────────────────────────

namespace {

/// Avance le pointeur jusqu'a la fin de la ligne courante.
/// Retourne un string_view sur la ligne (sans \r\n).
inline std::string_view next_line(const char*& ptr, const char* end) {
    const char* start = ptr;
    while (ptr < end && *ptr != '\n') {
        ++ptr;
    }
    const char* line_end = ptr;
    // Gerer CRLF
    if (line_end > start && *(line_end - 1) == '\r') {
        --line_end;
    }
    // Passer le \n
    if (ptr < end) {
        ++ptr;
    }
    return {start, static_cast<size_t>(line_end - start)};
}

/// Verifie si un caractere est un identifiant C.
inline bool is_ident_char(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
           (c >= '0' && c <= '9') || c == '_';
}

/// Verifie si c est un chiffre hexadecimal.
inline bool is_hex_char(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

/// Cherche le pattern "FUN_14" dans une ligne et extrait le nom complet.
/// @param line La ligne a scanner
/// @param results Vecteur ou ajouter les noms trouves
void extract_fun_refs(std::string_view line, std::vector<std::string>& results) {
    size_t pos = 0;
    while (pos < line.size()) {
        auto found = line.find("FUN_14", pos);
        if (found == std::string_view::npos) break;

        // Verifier que c'est un debut de token (pas au milieu d'un identifiant)
        if (found > 0 && is_ident_char(line[found - 1])) {
            pos = found + 6;
            continue;
        }

        // Extraire le nom complet FUN_14XXXXXXX
        size_t end = found + 6;
        while (end < line.size() && is_hex_char(line[end])) {
            ++end;
        }
        // Verifier que ce n'est pas suivi d'un caractere identifiant (pas un faux positif)
        if (end < line.size() && is_ident_char(line[end]) && !is_hex_char(line[end])) {
            pos = end;
            continue;
        }

        results.emplace_back(line.substr(found, end - found));
        pos = end;
    }
}

/// Cherche le pattern "DAT_14" dans une ligne et extrait les noms complets.
void extract_dat_refs(std::string_view line, std::vector<std::string>& results) {
    size_t pos = 0;
    while (pos < line.size()) {
        auto found = line.find("DAT_14", pos);
        if (found == std::string_view::npos) break;

        if (found > 0 && is_ident_char(line[found - 1])) {
            pos = found + 6;
            continue;
        }

        size_t end = found + 6;
        while (end < line.size() && is_hex_char(line[end])) {
            ++end;
        }
        if (end < line.size() && is_ident_char(line[end]) && !is_hex_char(line[end])) {
            pos = end;
            continue;
        }

        results.emplace_back(line.substr(found, end - found));
        pos = end;
    }
}

/// Extrait les string literals ("...") d'une ligne.
void extract_strings(std::string_view line, std::vector<std::string>& results) {
    size_t pos = 0;
    while (pos < line.size()) {
        auto quote_start = line.find('"', pos);
        if (quote_start == std::string_view::npos) break;

        size_t quote_end = quote_start + 1;
        while (quote_end < line.size()) {
            if (line[quote_end] == '\\' && quote_end + 1 < line.size()) {
                quote_end += 2; // Skip escaped char
                continue;
            }
            if (line[quote_end] == '"') break;
            ++quote_end;
        }
        if (quote_end >= line.size()) break;

        auto content = line.substr(quote_start + 1, quote_end - quote_start - 1);
        if (!content.empty()) {
            results.emplace_back(content);
        }
        pos = quote_end + 1;
    }
}

/// Extrait les constantes hexadecimales (0x...) d'une ligne.
void extract_hex_constants(std::string_view line, std::vector<std::string>& results) {
    size_t pos = 0;
    while (pos < line.size()) {
        auto found = line.find("0x", pos);
        if (found == std::string_view::npos) break;

        // Verifier que 0x n'est pas au milieu d'un identifiant
        if (found > 0 && is_ident_char(line[found - 1])) {
            pos = found + 2;
            continue;
        }

        size_t end = found + 2;
        while (end < line.size() && is_hex_char(line[end])) {
            ++end;
        }
        // Au moins un chiffre hex apres 0x
        if (end > found + 2) {
            results.emplace_back(line.substr(found, end - found));
        }
        pos = end;
    }
}

/// Extrait les classes RTTI depuis les references game::*, lives::*, etc.
void extract_rtti_class(std::string_view token, std::unordered_set<std::string>& classes) {
    // Patterns RTTI : game::*, lives::*, gmdC*, CMenu*, CChara*, CScene*
    static const std::string_view prefixes[] = {
        "game::", "lives::", "gmdC", "CMenu", "CChara", "CScene",
        "GDS", "CMng", "CBase", "CUI_", "CNet", "CLives"
    };

    for (auto prefix : prefixes) {
        size_t pos = 0;
        while (pos < token.size()) {
            auto found = token.find(prefix, pos);
            if (found == std::string_view::npos) break;

            // Trouver la fin du nom de classe (jusqu'a un non-identifiant ou ::vftable)
            size_t end = found + prefix.size();
            while (end < token.size() && (is_ident_char(token[end]) || token[end] == ':')) {
                ++end;
            }
            // Enlever ::vftable a la fin si present
            auto class_name = std::string(token.substr(found, end - found));
            const std::string vft_suffix = "::vftable";
            if (class_name.size() > vft_suffix.size() &&
                class_name.compare(class_name.size() - vft_suffix.size(),
                                   vft_suffix.size(), vft_suffix) == 0) {
                class_name.erase(class_name.size() - vft_suffix.size());
            }
            // Supprimer aussi les :: finaux
            while (class_name.size() >= 2 &&
                   class_name[class_name.size() - 1] == ':' &&
                   class_name[class_name.size() - 2] == ':') {
                class_name.erase(class_name.size() - 2);
            }
            if (!class_name.empty() && class_name.size() > prefix.size() - 1) {
                classes.insert(std::move(class_name));
            }
            pos = end;
        }
    }
}

/// Detecte si une ligne est une definition de fonction.
/// Pattern : <return_type> FUN_14XXXXXXX(<params>)
/// Retourne true si c'est une definition, et remplit les champs.
bool detect_function_def(std::string_view line,
                         std::string_view& return_type,
                         std::string_view& name,
                         std::string_view& params) {
    // Chercher FUN_14 dans la ligne
    auto fun_pos = line.find("FUN_14");
    if (fun_pos == std::string_view::npos) return false;

    // Verifier que FUN_14 n'est pas au milieu d'un identifiant
    if (fun_pos > 0 && is_ident_char(line[fun_pos - 1]) && line[fun_pos - 1] != ' ' && line[fun_pos - 1] != '\t' && line[fun_pos - 1] != '*') {
        return false;
    }

    // Extraire le nom complet
    size_t name_end = fun_pos + 6;
    while (name_end < line.size() && is_hex_char(line[name_end])) {
        ++name_end;
    }
    name = line.substr(fun_pos, name_end - fun_pos);

    // Chercher la parenthese ouvrante apres le nom
    size_t paren_start = line.find('(', name_end);
    if (paren_start == std::string_view::npos) return false;

    // Chercher la parenthese fermante
    size_t paren_end = line.find(')', paren_start);
    if (paren_end == std::string_view::npos) return false;

    params = line.substr(paren_start, paren_end - paren_start + 1);

    // Le type de retour est tout ce qui precede FUN_14, trim
    auto rt = line.substr(0, fun_pos);
    // Trim trailing whitespace
    while (!rt.empty() && (rt.back() == ' ' || rt.back() == '\t')) {
        rt.remove_suffix(1);
    }
    // Trim leading whitespace
    while (!rt.empty() && (rt.front() == ' ' || rt.front() == '\t')) {
        rt.remove_prefix(1);
    }
    if (rt.empty()) return false;

    return_type = rt;

    // La ligne doit etre au top-level (pas indentee — pas un appel dans un body)
    // Verifier qu'il n'y a pas d'indentation (espaces/tabs au debut)
    if (!line.empty() && (line[0] == ' ' || line[0] == '\t')) {
        return false;
    }

    return true;
}

/// Dedup un vecteur de strings en place.
void dedup_vector(std::vector<std::string>& v) {
    std::sort(v.begin(), v.end());
    v.erase(std::unique(v.begin(), v.end()), v.end());
}

} // namespace anonyme

// ── Parsing principal ───────────────────────────────────────────────

NieIndex parse_nie(const std::string& path) {
    NieIndex index;

    auto t_start = std::chrono::steady_clock::now();

    // mmap le fichier via mio (cross-platform : POSIX mmap / Windows CreateFileMapping)
    mio::mmap_source mapped;
    std::error_code ec;
    mapped.map(path, ec);
    if (ec) {
        spdlog::error("nie_parser: impossible de mapper '{}' : {}", path, ec.message());
        return index;
    }

    spdlog::info("nie_parser: fichier mappe ({} MB)", mapped.size() / (1024 * 1024));

    const char* ptr = mapped.data();
    const char* end = mapped.data() + mapped.size();
    uint32_t line_num = 0;

    // Ensemble pour dedup les RTTI
    std::unordered_set<std::string> rtti_set;

    // Phase 1 : scanner toutes les lignes
    // On detecte les definitions de fonctions et les globals
    // Pour chaque fonction, on scanne son body

    // Etat du parser
    bool in_function = false;
    int brace_depth = 0;
    NieFunction* current_func = nullptr;
    std::string current_func_name;

    // Temporaires pour les extractions dans le body
    std::vector<std::string> tmp_funs, tmp_dats, tmp_strings, tmp_hex;

    while (ptr < end) {
        auto line = next_line(ptr, end);
        ++line_num;

        if (in_function) {
            // On est dans le body d'une fonction — compter les braces
            for (size_t i = 0; i < line.size(); ++i) {
                char c = line[i];
                if (c == '"') {
                    // Skip string literals pour ne pas compter les { } dedans
                    ++i;
                    while (i < line.size()) {
                        if (line[i] == '\\' && i + 1 < line.size()) {
                            i += 2;
                            continue;
                        }
                        if (line[i] == '"') break;
                        ++i;
                    }
                    continue;
                }
                if (c == '\'') {
                    // Skip char literals
                    ++i;
                    while (i < line.size()) {
                        if (line[i] == '\\' && i + 1 < line.size()) {
                            i += 2;
                            continue;
                        }
                        if (line[i] == '\'') break;
                        ++i;
                    }
                    continue;
                }
                if (c == '{') ++brace_depth;
                else if (c == '}') {
                    --brace_depth;
                    if (brace_depth == 0) {
                        // Fin de la fonction
                        current_func->end_line = line_num;
                        in_function = false;

                        // Dedup les vecteurs extraits
                        dedup_vector(current_func->callees);
                        dedup_vector(current_func->dat_refs);
                        // Pas de dedup pour strings (on veut les doublons pour le comptage)

                        current_func = nullptr;
                        break;
                    }
                }
            }

            // Extraire les references dans le body (meme si on vient de fermer)
            if (current_func) {
                // Callees (FUN_14*)
                tmp_funs.clear();
                extract_fun_refs(line, tmp_funs);
                for (auto& f : tmp_funs) {
                    // Ne pas s'auto-reference
                    if (f != current_func_name) {
                        current_func->callees.push_back(std::move(f));
                    }
                }

                // DAT refs
                tmp_dats.clear();
                extract_dat_refs(line, tmp_dats);
                for (auto& d : tmp_dats) {
                    // Compter les references globales AVANT le move
                    index.globals[d].ref_count++;
                    current_func->dat_refs.push_back(std::move(d));
                }

                // Strings
                tmp_strings.clear();
                extract_strings(line, tmp_strings);
                for (auto& s : tmp_strings) {
                    current_func->strings.push_back(s);
                    index.all_strings[s].push_back(current_func_name);
                }

                // Hex constants
                tmp_hex.clear();
                extract_hex_constants(line, tmp_hex);
                for (auto& h : tmp_hex) {
                    current_func->hex_constants.push_back(h);
                    index.hex_constants[h]++;
                }

                // RTTI dans la ligne entiere
                extract_rtti_class(line, rtti_set);
            }
        } else {
            // Hors fonction — chercher une definition de fonction ou une globale

            // Definition de fonction ?
            std::string_view ret_type, func_name, func_params;
            if (detect_function_def(line, ret_type, func_name, func_params)) {
                // Nouvelle fonction trouvee
                current_func_name = std::string(func_name);
                auto& func = index.functions[current_func_name];
                func.name = current_func_name;
                func.return_type = std::string(ret_type);
                func.params = std::string(func_params);
                func.start_line = line_num;
                current_func = &func;

                // La brace ouvrante peut etre sur cette ligne ou la suivante
                // Compter les braces dans cette ligne
                brace_depth = 0;
                for (size_t i = 0; i < line.size(); ++i) {
                    if (line[i] == '{') {
                        ++brace_depth;
                        in_function = true;
                    }
                    else if (line[i] == '}') --brace_depth;
                }

                if (!in_function) {
                    // La brace ouvrante est sur une ligne suivante
                    // On reste en attente — on va chercher le { sur les prochaines lignes
                    // via un petit lookahead integre dans la boucle principale
                    // Marquer qu'on attend le debut du body
                    in_function = false; // reste false, on attend le {
                    // On va gerer ca dans un etat special
                    // Parcourir les prochaines lignes pour trouver le {
                    while (ptr < end) {
                        auto next = next_line(ptr, end);
                        ++line_num;
                        // Chercher le premier {
                        bool found_brace = false;
                        for (size_t i = 0; i < next.size(); ++i) {
                            if (next[i] == '{') {
                                ++brace_depth;
                                found_brace = true;
                                in_function = true;
                            }
                            else if (next[i] == '}') {
                                --brace_depth;
                            }
                        }
                        if (found_brace) break;
                        // Ligne vide ou continuation des params — on continue
                        // Mais si c'est une ligne non-vide sans {, on concatene les params
                        if (!next.empty()) {
                            // Peut etre la suite des parametres (multi-ligne)
                            auto paren = next.find(')');
                            if (paren != std::string_view::npos) {
                                // On a trouve la fin des params
                                func.params += std::string(next.substr(0, paren + 1));
                            }
                        }
                    }
                }

                if (brace_depth == 0 && in_function) {
                    // Fonction ouverte et fermee sur la meme ligne (inline)
                    func.end_line = line_num;
                    in_function = false;
                    current_func = nullptr;
                }

                continue;
            }

            // Declaration de globale ? Pattern: <type> DAT_14XXXXXXX;
            // Seulement dans la zone pre-fonctions (avant la premiere definition de fonction)
            if (line.find("DAT_14") != std::string_view::npos) {
                // Verifier le pattern : type suivi de DAT_14XXXX et terminant par ;
                auto dat_pos = line.find("DAT_14");
                if (dat_pos != std::string_view::npos && !line.empty() &&
                    line[0] != ' ' && line[0] != '\t') {
                    // Extraire le type (tout avant DAT_14)
                    auto type_sv = line.substr(0, dat_pos);
                    while (!type_sv.empty() && (type_sv.back() == ' ' || type_sv.back() == '\t')) {
                        type_sv.remove_suffix(1);
                    }
                    // Extraire le nom
                    size_t name_end = dat_pos + 6;
                    while (name_end < line.size() && is_hex_char(line[name_end])) {
                        ++name_end;
                    }
                    auto dat_name = std::string(line.substr(dat_pos, name_end - dat_pos));
                    // Verifier que c'est une declaration (se termine par ;)
                    if (line.find(';') != std::string_view::npos && !type_sv.empty()) {
                        auto& g = index.globals[dat_name];
                        if (g.type.empty()) {
                            g.type = std::string(type_sv);
                        }
                    }
                }
            }

            // RTTI dans les zones hors-fonction aussi
            extract_rtti_class(line, rtti_set);
        }
    }

    // Si on est encore dans une fonction (fichier tronque), fermer
    if (in_function && current_func) {
        current_func->end_line = line_num;
        dedup_vector(current_func->callees);
        dedup_vector(current_func->dat_refs);
        spdlog::warn("nie_parser: fonction '{}' non fermee a la fin du fichier",
                     current_func_name);
    }

    // Finaliser l'index
    index.total_lines = line_num;
    index.total_functions = static_cast<uint32_t>(index.functions.size());
    index.total_globals = static_cast<uint32_t>(index.globals.size());
    index.total_strings = static_cast<uint32_t>(index.all_strings.size());

    // Trier les RTTI
    index.rtti_classes.assign(rtti_set.begin(), rtti_set.end());
    std::sort(index.rtti_classes.begin(), index.rtti_classes.end());

    // Dedup les strings dans all_strings (une fonction peut apparaitre plusieurs fois)
    for (auto& [str, funcs] : index.all_strings) {
        dedup_vector(funcs);
    }

    // Dedup les hex constants dans les fonctions
    for (auto& [name, func] : index.functions) {
        dedup_vector(func.hex_constants);
        // Dedup strings aussi
        dedup_vector(func.strings);
    }

    auto t_end = std::chrono::steady_clock::now();
    index.parse_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();

    spdlog::info("nie_parser: {} fonctions, {} globals, {} strings uniques, {} classes RTTI en {:.1f} ms",
                 index.total_functions, index.total_globals, index.total_strings,
                 index.rtti_classes.size(), index.parse_time_ms);

    return index;
}

// ── Recherche ───────────────────────────────────────────────────────

std::vector<NieSearchResult> search_nie(
    const NieIndex& index,
    const std::string& query,
    const std::string& scope,
    bool use_regex) {

    std::vector<NieSearchResult> results;

    // Construire le regex si demande
    std::regex re;
    if (use_regex) {
        try {
            re = std::regex(query, std::regex::icase | std::regex::optimize);
        } catch (const std::regex_error& e) {
            spdlog::error("nie_parser: regex invalide '{}' : {}", query, e.what());
            return results;
        }
    }

    auto matches = [&](const std::string& text) -> bool {
        if (use_regex) {
            return std::regex_search(text, re);
        }
        // Substring match case-insensitive
        auto it = std::search(
            text.begin(), text.end(),
            query.begin(), query.end(),
            [](char a, char b) {
                return std::tolower(static_cast<unsigned char>(a)) ==
                       std::tolower(static_cast<unsigned char>(b));
            });
        return it != text.end();
    };

    // Recherche dans les fonctions
    if (scope == "all" || scope == "functions") {
        for (const auto& [name, func] : index.functions) {
            if (matches(name)) {
                NieSearchResult r;
                r.name = name;
                r.type = "function";
                r.detail = fmt::format("{} {} {}", func.return_type, name, func.params);
                r.line = func.start_line;
                results.push_back(std::move(r));
            }
        }
    }

    // Recherche dans les globals
    if (scope == "all" || scope == "globals") {
        for (const auto& [name, global] : index.globals) {
            if (matches(name)) {
                NieSearchResult r;
                r.name = name;
                r.type = "global";
                r.detail = fmt::format("{} ({} refs)", global.type, global.ref_count);
                results.push_back(std::move(r));
            }
        }
    }

    // Recherche dans les strings
    if (scope == "all" || scope == "strings") {
        for (const auto& [str, funcs] : index.all_strings) {
            if (matches(str)) {
                NieSearchResult r;
                r.name = str;
                r.type = "string";
                if (funcs.size() <= 5) {
                    r.detail = fmt::format("dans {} fonctions : {}",
                                           funcs.size(), fmt::join(funcs, ", "));
                } else {
                    r.detail = fmt::format("dans {} fonctions : {}, ... (+{})",
                                           funcs.size(),
                                           fmt::join(funcs.begin(), funcs.begin() + 5, ", "),
                                           funcs.size() - 5);
                }
                results.push_back(std::move(r));
            }
        }
    }

    // Recherche dans les hex constants
    if (scope == "all" || scope == "hex") {
        for (const auto& [hex, count] : index.hex_constants) {
            if (matches(hex)) {
                NieSearchResult r;
                r.name = hex;
                r.type = "hex";
                r.detail = fmt::format("{} occurrences", count);
                results.push_back(std::move(r));
            }
        }
    }

    // Recherche dans les RTTI
    if (scope == "all" || scope == "rtti") {
        for (const auto& cls : index.rtti_classes) {
            if (matches(cls)) {
                NieSearchResult r;
                r.name = cls;
                r.type = "rtti";
                r.detail = "classe RTTI";
                results.push_back(std::move(r));
            }
        }
    }

    // Trier par nom pour un output deterministe
    std::sort(results.begin(), results.end(),
              [](const NieSearchResult& a, const NieSearchResult& b) {
                  return a.name < b.name;
              });

    return results;
}

// ── Serialisation JSON ──────────────────────────────────────────────

std::string index_to_json(const NieIndex& index) {
    nlohmann::json j;

    j["totalLines"] = index.total_lines;
    j["totalFunctions"] = index.total_functions;
    j["totalGlobals"] = index.total_globals;
    j["totalStrings"] = index.total_strings;
    j["parseTimeMs"] = index.parse_time_ms;

    // Fonctions
    auto& jfuncs = j["functions"];
    jfuncs = nlohmann::json::object();
    for (const auto& [name, func] : index.functions) {
        auto& jf = jfuncs[name];
        jf["name"] = func.name;
        jf["returnType"] = func.return_type;
        jf["params"] = func.params;
        jf["startLine"] = func.start_line;
        jf["endLine"] = func.end_line;
        jf["callees"] = func.callees;
        jf["strings"] = func.strings;
        jf["hexConstants"] = func.hex_constants;
        jf["datRefs"] = func.dat_refs;
    }

    // Globals
    auto& jglobs = j["globals"];
    jglobs = nlohmann::json::object();
    for (const auto& [name, global] : index.globals) {
        auto& jg = jglobs[name];
        jg["type"] = global.type;
        jg["refs"] = global.ref_count;
    }

    // allStrings
    j["allStrings"] = index.all_strings;

    // hexConstants
    j["hexConstants"] = index.hex_constants;

    // RTTI classes
    j["rttiClasses"] = index.rtti_classes;

    return j.dump();
}

} // namespace iecode::decomp
