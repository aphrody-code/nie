#pragma once

/// @file lua_parser.h
/// Parser statique Lua via tree-sitter-lua.
///
/// Analyse les scripts Lua decompiles du jeu pour extraire les donnees
/// (tables, fonctions, globals, strings) sans executer le code Lua.
/// Utilise tree-sitter pour construire un AST concret et le requeter.

#include <nlohmann/json.hpp>

#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace iecode::scripting {

// -- Structures de resultat ---------------------------------------------------

/// Variable globale ou locale top-level assignee.
struct LuaGlobal {
    std::string name;
    std::string value_type;  ///< "string", "number", "table", "function", "bool", "other"
    std::string raw_value;   ///< Representation textuelle brute
    uint32_t line = 0;
};

/// Champ d'une table Lua.
struct LuaTableField {
    std::string key;         ///< Cle du champ (vide si indexe numeriquement)
    std::string value_type;  ///< "string", "number", "table", "function", "bool", "other"
    std::string raw_value;   ///< Valeur brute
};

/// Table Lua nommee (variable globale contenant un table_constructor).
struct LuaTable {
    std::string name;        ///< Nom de la variable
    std::vector<LuaTableField> fields;
    uint32_t line = 0;
};

/// Fonction Lua declaree au top-level.
struct LuaFunction {
    std::string name;
    std::vector<std::string> params;
    uint32_t start_line = 0;
    uint32_t end_line = 0;
};

/// Element d'interface utilisateur detecte dans un script Lua.
struct LuaUiElement {
    std::string name;       ///< Nom interne (ex: "win07_01_chara_filter_list")
    std::string category;   ///< "window", "component", "icon", "button", "path", "other"
    std::string raw_value;  ///< Valeur brute (pour les chemins de texture, etc.)
};

/// Resultat du parsing d'un seul fichier Lua.
struct LuaFileResult {
    std::string path;
    bool ok = false;
    std::string error;
    std::vector<LuaGlobal> globals;
    std::vector<LuaTable> tables;
    std::vector<LuaFunction> functions;
    /// Strings interessantes (longueur > 3, pas juste des nombres)
    std::vector<std::string> strings;
    /// Strings passees a CRC32() — pattern (upval.CRC32)("string") et CRC32("string")
    std::vector<std::string> crc32_strings;
    /// Elements d'interface utilisateur detectes
    std::vector<LuaUiElement> ui_elements;
};

/// Resultat du parsing batch d'un repertoire.
struct LuaBatchResult {
    uint32_t total_files = 0;
    uint32_t ok_files = 0;
    uint32_t error_files = 0;
    double parse_time_ms = 0;
    std::vector<LuaFileResult> results;
};

// -- Parser -------------------------------------------------------------------

/// Parser statique Lua utilisant tree-sitter-lua.
///
/// Thread-safe pour les appels const (chaque parse cree son propre TSParser).
/// Le TSLanguage est charge une seule fois a la construction.
class LuaParser {
public:
    LuaParser();
    ~LuaParser();

    LuaParser(const LuaParser&) = delete;
    LuaParser& operator=(const LuaParser&) = delete;
    LuaParser(LuaParser&&) noexcept;
    LuaParser& operator=(LuaParser&&) noexcept;

    /// Parse un seul fichier Lua.
    [[nodiscard]] LuaFileResult parse_file(const std::string& path) const;

    /// Parse tous les .lua d'un repertoire (recursif).
    [[nodiscard]] LuaBatchResult parse_directory(
        const std::string& dir,
        const std::string& glob_pattern = "*.lua") const;

    /// Cherche un keyword dans les resultats batch.
    /// @return Paires (fichier, contexte) ou le keyword apparait.
    [[nodiscard]] std::vector<std::pair<std::string, std::string>>
    search(const LuaBatchResult& batch, const std::string& keyword) const;

    /// Serialise un LuaFileResult en JSON.
    [[nodiscard]] static nlohmann::json to_json(const LuaFileResult& r);

    /// Serialise un LuaBatchResult en JSON.
    [[nodiscard]] static nlohmann::json to_json(const LuaBatchResult& r);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace iecode::scripting
