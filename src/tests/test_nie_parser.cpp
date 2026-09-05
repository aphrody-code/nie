/// @file test_nie_parser.cpp
/// Tests du parser nie.c avec un fichier synthetique.

#include <gtest/gtest.h>

#include "decomp/nie_parser.h"

#include <nlohmann/json.hpp>

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;

namespace {

/// Fichier nie.c synthetique pour les tests.
/// Simule la structure reelle : typedefs, globals, fonctions.
constexpr const char* MINI_NIE_C = R"(typedef unsigned char undefined;
typedef unsigned int dword;
typedef long long longlong;

undefined DAT_14000a000;
undefined4 DAT_14000b000;
longlong DAT_14000c000;

void FUN_140001000(void)

{
  return;
}

undefined8 FUN_140002000(int param_1,longlong param_2)

{
  FUN_140001000();
  DAT_14000a000 = 0;
  DAT_14000b000 = 0x1234;
  return 0;
}

void FUN_140003000(void)

{
  char *msg = "hello world";
  char *err = "ErrorCode_None";
  FUN_140001000();
  FUN_140002000(1, 0x5678);
  DAT_14000a000 = 1;
  PTR_vftable = (undefined *)game::CCharaController::vftable;
  DAT_141bfaa40 = lives::CLivesManager::vftable;
}

undefined FUN_140004000(void)

{
  if (DAT_14000c000 == 0) {
    FUN_140001000();
    {
      int x = 0x42;
    }
  }
  return 0;
}

)";

/// Ecrit le contenu dans un fichier temporaire et retourne le chemin.
std::string write_temp_nie(const std::string& content) {
    auto path = fs::temp_directory_path() / "test_nie.c";
    std::ofstream out(path);
    out << content;
    out.close();
    return path.string();
}

/// Version CRLF du meme contenu.
std::string to_crlf(const std::string& content) {
    std::string result;
    result.reserve(content.size() * 2);
    for (char c : content) {
        if (c == '\n') {
            result += '\r';
        }
        result += c;
    }
    return result;
}

} // namespace anonyme

// ── Tests de parsing ────────────────────────────────────────────────

TEST(NieParserTest, ParseMiniNie) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // Nombre total de lignes
    EXPECT_GT(index.total_lines, 0u);

    // 4 fonctions attendues
    EXPECT_EQ(index.total_functions, 4u);

    // 3 globals declares (DAT_14000a000, DAT_14000b000, DAT_14000c000)
    // Note : les refs dans le body ajoutent d'autres globals aussi
    EXPECT_GE(index.total_globals, 3u);

    // Verifier que les fonctions sont bien extraites
    EXPECT_TRUE(index.functions.count("FUN_140001000"));
    EXPECT_TRUE(index.functions.count("FUN_140002000"));
    EXPECT_TRUE(index.functions.count("FUN_140003000"));
    EXPECT_TRUE(index.functions.count("FUN_140004000"));
}

TEST(NieParserTest, FunctionReturnTypes) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    EXPECT_EQ(index.functions["FUN_140001000"].return_type, "void");
    EXPECT_EQ(index.functions["FUN_140002000"].return_type, "undefined8");
    EXPECT_EQ(index.functions["FUN_140003000"].return_type, "void");
    EXPECT_EQ(index.functions["FUN_140004000"].return_type, "undefined");
}

TEST(NieParserTest, FunctionParams) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    EXPECT_EQ(index.functions["FUN_140001000"].params, "(void)");
    EXPECT_EQ(index.functions["FUN_140002000"].params, "(int param_1,longlong param_2)");
}

TEST(NieParserTest, FunctionLineNumbers) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // FUN_140001000 commence a la ligne 6 (apres les 4 typedefs + 3 globals + ligne vide)
    auto& f1 = index.functions["FUN_140001000"];
    EXPECT_GT(f1.start_line, 0u);
    EXPECT_GT(f1.end_line, f1.start_line);

    // FUN_140002000 vient apres FUN_140001000
    auto& f2 = index.functions["FUN_140002000"];
    EXPECT_GT(f2.start_line, f1.end_line);
    EXPECT_GT(f2.end_line, f2.start_line);
}

TEST(NieParserTest, Callees) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // FUN_140002000 appelle FUN_140001000
    auto& f2 = index.functions["FUN_140002000"];
    EXPECT_EQ(f2.callees.size(), 1u);
    EXPECT_EQ(f2.callees[0], "FUN_140001000");

    // FUN_140003000 appelle FUN_140001000 et FUN_140002000
    auto& f3 = index.functions["FUN_140003000"];
    EXPECT_EQ(f3.callees.size(), 2u);
    // Tries par dedup
    EXPECT_TRUE(std::find(f3.callees.begin(), f3.callees.end(), "FUN_140001000") != f3.callees.end());
    EXPECT_TRUE(std::find(f3.callees.begin(), f3.callees.end(), "FUN_140002000") != f3.callees.end());

    // FUN_140004000 appelle FUN_140001000
    auto& f4 = index.functions["FUN_140004000"];
    EXPECT_EQ(f4.callees.size(), 1u);
}

TEST(NieParserTest, DatRefs) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // FUN_140002000 reference DAT_14000a000 et DAT_14000b000
    auto& f2 = index.functions["FUN_140002000"];
    EXPECT_EQ(f2.dat_refs.size(), 2u);
    EXPECT_TRUE(std::find(f2.dat_refs.begin(), f2.dat_refs.end(), "DAT_14000a000") != f2.dat_refs.end());
    EXPECT_TRUE(std::find(f2.dat_refs.begin(), f2.dat_refs.end(), "DAT_14000b000") != f2.dat_refs.end());
}

TEST(NieParserTest, StringLiterals) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // FUN_140003000 contient "hello world" et "ErrorCode_None"
    auto& f3 = index.functions["FUN_140003000"];
    EXPECT_EQ(f3.strings.size(), 2u);
    EXPECT_TRUE(std::find(f3.strings.begin(), f3.strings.end(), "hello world") != f3.strings.end());
    EXPECT_TRUE(std::find(f3.strings.begin(), f3.strings.end(), "ErrorCode_None") != f3.strings.end());

    // all_strings doit mapper "hello world" -> ["FUN_140003000"]
    EXPECT_TRUE(index.all_strings.count("hello world"));
    auto& funcs = index.all_strings["hello world"];
    EXPECT_EQ(funcs.size(), 1u);
    EXPECT_EQ(funcs[0], "FUN_140003000");
}

TEST(NieParserTest, HexConstants) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // FUN_140002000 contient 0x1234
    auto& f2 = index.functions["FUN_140002000"];
    EXPECT_TRUE(std::find(f2.hex_constants.begin(), f2.hex_constants.end(), "0x1234") != f2.hex_constants.end());

    // FUN_140003000 contient 0x5678
    auto& f3 = index.functions["FUN_140003000"];
    EXPECT_TRUE(std::find(f3.hex_constants.begin(), f3.hex_constants.end(), "0x5678") != f3.hex_constants.end());

    // FUN_140004000 contient 0x42
    auto& f4 = index.functions["FUN_140004000"];
    EXPECT_TRUE(std::find(f4.hex_constants.begin(), f4.hex_constants.end(), "0x42") != f4.hex_constants.end());

    // hex_constants global doit avoir 0x1234, 0x5678, 0x42
    EXPECT_TRUE(index.hex_constants.count("0x1234"));
    EXPECT_TRUE(index.hex_constants.count("0x5678"));
    EXPECT_TRUE(index.hex_constants.count("0x42"));
}

TEST(NieParserTest, RttiClasses) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // Doit avoir game::CCharaController et lives::CLivesManager
    EXPECT_GE(index.rtti_classes.size(), 2u);
    EXPECT_TRUE(std::find(index.rtti_classes.begin(), index.rtti_classes.end(),
                          "game::CCharaController") != index.rtti_classes.end());
    EXPECT_TRUE(std::find(index.rtti_classes.begin(), index.rtti_classes.end(),
                          "lives::CLivesManager") != index.rtti_classes.end());
}

TEST(NieParserTest, GlobalDeclarations) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // Les 3 globals declares
    EXPECT_TRUE(index.globals.count("DAT_14000a000"));
    EXPECT_TRUE(index.globals.count("DAT_14000b000"));
    EXPECT_TRUE(index.globals.count("DAT_14000c000"));

    // Types corrects
    EXPECT_EQ(index.globals["DAT_14000a000"].type, "undefined");
    EXPECT_EQ(index.globals["DAT_14000b000"].type, "undefined4");
    EXPECT_EQ(index.globals["DAT_14000c000"].type, "longlong");
}

TEST(NieParserTest, GlobalRefCounts) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // DAT_14000a000 est reference dans FUN_140002000 et FUN_140003000 = 2 refs
    EXPECT_GE(index.globals["DAT_14000a000"].ref_count, 2u);

    // DAT_14000b000 est reference dans FUN_140002000 = 1 ref
    EXPECT_GE(index.globals["DAT_14000b000"].ref_count, 1u);
}

TEST(NieParserTest, NestedBraces) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // FUN_140004000 a des braces imbriquees (if + bloc interne)
    // Le parser doit trouver la bonne fin
    auto& f4 = index.functions["FUN_140004000"];
    EXPECT_GT(f4.end_line, f4.start_line);
    // La fonction doit avoir detecte FUN_140001000 dans le body
    EXPECT_EQ(f4.callees.size(), 1u);
    EXPECT_EQ(f4.callees[0], "FUN_140001000");
}

TEST(NieParserTest, CrlfSupport) {
    std::string crlf_content = to_crlf(MINI_NIE_C);
    auto path = write_temp_nie(crlf_content);
    auto index = iecode::decomp::parse_nie(path);

    // Le parsing CRLF doit donner les memes resultats
    EXPECT_EQ(index.total_functions, 4u);
    EXPECT_TRUE(index.functions.count("FUN_140001000"));
    EXPECT_TRUE(index.functions.count("FUN_140002000"));
    EXPECT_TRUE(index.functions.count("FUN_140003000"));
    EXPECT_TRUE(index.functions.count("FUN_140004000"));
}

// ── Tests de recherche ──────────────────────────────────────────────

TEST(NieSearchTest, SearchFunctions) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    auto results = iecode::decomp::search_nie(index, "FUN_140001", "functions");
    EXPECT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "FUN_140001000");
    EXPECT_EQ(results[0].type, "function");
}

TEST(NieSearchTest, SearchStrings) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    auto results = iecode::decomp::search_nie(index, "hello", "strings");
    EXPECT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "hello world");
    EXPECT_EQ(results[0].type, "string");
}

TEST(NieSearchTest, SearchGlobals) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    auto results = iecode::decomp::search_nie(index, "DAT_14000a", "globals");
    EXPECT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "DAT_14000a000");
}

TEST(NieSearchTest, SearchRtti) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    auto results = iecode::decomp::search_nie(index, "CChara", "rtti");
    EXPECT_GE(results.size(), 1u);
    EXPECT_EQ(results[0].type, "rtti");
}

TEST(NieSearchTest, SearchAll) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    // Recherche dans tous les scopes
    auto results = iecode::decomp::search_nie(index, "140001", "all");
    EXPECT_GE(results.size(), 1u); // Au moins la fonction
}

TEST(NieSearchTest, SearchRegex) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    auto results = iecode::decomp::search_nie(index, "FUN_14000[12]000", "functions", true);
    EXPECT_EQ(results.size(), 2u);
}

TEST(NieSearchTest, SearchNoResults) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    auto results = iecode::decomp::search_nie(index, "nonexistent_pattern_xyz", "all");
    EXPECT_TRUE(results.empty());
}

// ── Test de serialisation JSON ──────────────────────────────────────

TEST(NieJsonTest, IndexToJson) {
    auto path = write_temp_nie(MINI_NIE_C);
    auto index = iecode::decomp::parse_nie(path);

    auto json_str = iecode::decomp::index_to_json(index);

    // Verifier que c'est du JSON valide
    nlohmann::json j = nlohmann::json::parse(json_str);
    EXPECT_TRUE(j.is_object());
    EXPECT_TRUE(j.contains("totalLines"));
    EXPECT_TRUE(j.contains("totalFunctions"));
    EXPECT_TRUE(j.contains("totalGlobals"));
    EXPECT_TRUE(j.contains("totalStrings"));
    EXPECT_TRUE(j.contains("parseTimeMs"));
    EXPECT_TRUE(j.contains("functions"));
    EXPECT_TRUE(j.contains("globals"));
    EXPECT_TRUE(j.contains("allStrings"));
    EXPECT_TRUE(j.contains("hexConstants"));
    EXPECT_TRUE(j.contains("rttiClasses"));

    // Verifier les valeurs
    uint32_t total_funcs = j["totalFunctions"];
    EXPECT_EQ(total_funcs, 4u);
    uint32_t total_globs = j["totalGlobals"];
    EXPECT_GE(total_globs, 3u);

    // Verifier une fonction
    nlohmann::json& funcs = j["functions"];
    EXPECT_TRUE(funcs.contains("FUN_140001000"));
    EXPECT_EQ(funcs["FUN_140001000"]["returnType"], "void");
}

// ── Test fichier inexistant ─────────────────────────────────────────

TEST(NieParserTest, NonExistentFile) {
    const auto missing =
        fs::temp_directory_path() / "nonexistent_nie_parser_input.c";
    auto index = iecode::decomp::parse_nie(missing.string());
    EXPECT_EQ(index.total_lines, 0u);
    EXPECT_EQ(index.total_functions, 0u);
}

// ── Nettoyage ───────────────────────────────────────────────────────

class NieParserCleanup : public ::testing::Environment {
public:
    ~NieParserCleanup() override = default;
    void TearDown() override {
        auto path = fs::temp_directory_path() / "test_nie.c";
        fs::remove(path);
    }
};

// Enregistrer le nettoyage global
static auto* const cleanup_env =
    ::testing::AddGlobalTestEnvironment(new NieParserCleanup());
