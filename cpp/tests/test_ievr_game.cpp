/// @file test_ievr_game.cpp
/// Tests unitaires pour IevrGame — facade principale du jeu.
///
/// Utilise un dossier temporaire simulant la structure du jeu
/// pour tester la validation, l'analyse et l'export JSON.

#include <gtest/gtest.h>

#include "iecode/game/ievr_game.h"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using iecode::game::IevrGame;

/// Fixture : cree un dossier temporaire avec la structure minimale du jeu.
class IevrGameTest : public ::testing::Test {
protected:
    fs::path temp_dir_;

    void SetUp() override {
        // Creer un dossier temporaire unique
        temp_dir_ = fs::temp_directory_path() / "iecode_test_ievr_game";
        fs::remove_all(temp_dir_);
        fs::create_directories(temp_dir_);
    }

    void TearDown() override {
        std::error_code ec;
        fs::remove_all(temp_dir_, ec);
    }

    /// Cree la structure minimale valide du jeu.
    void create_valid_structure() {
        fs::create_directories(temp_dir_ / "data" / "packs");
        fs::create_directories(temp_dir_ / "data" / "common" / "system");

        // Creer nie.exe (fichier factice)
        {
            std::ofstream f(temp_dir_ / "nie.exe", std::ios::binary);
            f << "MZ_FAKE_EXE";
        }
    }

    /// Cree des fichiers CPK factices dans data/packs/.
    void create_fake_cpks(int count, size_t size_each = 1024) {
        const auto packs = temp_dir_ / "data" / "packs";
        for (int i = 0; i < count; ++i) {
            std::ofstream f(
                packs / ("test_" + std::to_string(i) + ".cpk"),
                std::ios::binary);
            // Ecrire des octets factices
            const std::string content(size_each, '\0');
            f.write(content.data(), static_cast<std::streamsize>(content.size()));
        }
    }

    /// Cree un cpk_list.cfg.bin factice.
    void create_cpk_list() {
        std::ofstream f(temp_dir_ / "data" / "cpk_list.cfg.bin",
                        std::ios::binary);
        f << "FAKE_CPK_LIST";
    }
};

// ── Tests de construction ───────────────────────────────────────────

TEST_F(IevrGameTest, ConstructWithInvalidPath) {
    IevrGame game(temp_dir_ / "nonexistent");
    EXPECT_FALSE(game.is_valid());
}

TEST_F(IevrGameTest, ConstructWithEmptyDir) {
    // Dossier existe mais sans nie.exe ni data/
    IevrGame game(temp_dir_);
    EXPECT_FALSE(game.is_valid());
}

TEST_F(IevrGameTest, ConstructWithValidStructure) {
    create_valid_structure();
    IevrGame game(temp_dir_);
    EXPECT_TRUE(game.is_valid());
}

TEST_F(IevrGameTest, ConstructWithMissingExe) {
    // data/ existe mais pas nie.exe
    fs::create_directories(temp_dir_ / "data");
    IevrGame game(temp_dir_);
    EXPECT_FALSE(game.is_valid());
}

TEST_F(IevrGameTest, ConstructWithMissingData) {
    // nie.exe existe mais pas data/
    std::ofstream f(temp_dir_ / "nie.exe");
    f << "MZ";
    IevrGame game(temp_dir_);
    EXPECT_FALSE(game.is_valid());
}

// ── Tests des accesseurs de chemins ─────────────────────────────────

TEST_F(IevrGameTest, PathAccessors) {
    create_valid_structure();
    IevrGame game(temp_dir_);

    EXPECT_EQ(game.game_path(), temp_dir_);
    EXPECT_EQ(game.data_path(), temp_dir_ / "data");
    EXPECT_EQ(game.packs_path(), temp_dir_ / "data" / "packs");
    EXPECT_EQ(game.cpk_list_path(), temp_dir_ / "data" / "cpk_list.cfg.bin");
    EXPECT_EQ(game.exe_path(), temp_dir_ / "nie.exe");
    EXPECT_EQ(game.system_config_path(),
              temp_dir_ / "data" / "common" / "system");
}

// ── Tests des constantes ────────────────────────────────────────────

TEST_F(IevrGameTest, Constants) {
    EXPECT_EQ(IevrGame::CRI_KEY, 0x1717E18Eu);
    EXPECT_EQ(IevrGame::STEAM_APP_ID, 2799860u);
    EXPECT_EQ(IevrGame::EXE_NAME, "nie.exe");
}

// ── Tests d'analyse ─────────────────────────────────────────────────

TEST_F(IevrGameTest, AnalyzeEmptyPacks) {
    create_valid_structure();
    IevrGame game(temp_dir_);

    const auto info = game.analyze();
    EXPECT_EQ(info.cpk_count, 0);
    EXPECT_EQ(info.total_cpk_size, 0);
    EXPECT_FALSE(info.has_cpk_list);
    EXPECT_GT(info.exe_size, 0); // nie.exe factice contient "MZ_FAKE_EXE"
    EXPECT_FALSE(info.analyzed_at.empty());
}

TEST_F(IevrGameTest, AnalyzeWithCpks) {
    create_valid_structure();
    create_fake_cpks(5, 2048);

    IevrGame game(temp_dir_);
    const auto info = game.analyze();

    EXPECT_EQ(info.cpk_count, 5);
    EXPECT_EQ(info.total_cpk_size, 5 * 2048);
}

TEST_F(IevrGameTest, AnalyzeWithCpkList) {
    create_valid_structure();
    create_cpk_list();

    IevrGame game(temp_dir_);
    const auto info = game.analyze();

    EXPECT_TRUE(info.has_cpk_list);
}

TEST_F(IevrGameTest, AnalyzeDateIsIso8601) {
    create_valid_structure();
    IevrGame game(temp_dir_);

    const auto info = game.analyze();
    // Format attendu : YYYY-MM-DDTHH:MM:SSZ
    EXPECT_EQ(info.analyzed_at.size(), 20u);
    EXPECT_EQ(info.analyzed_at[4], '-');
    EXPECT_EQ(info.analyzed_at[7], '-');
    EXPECT_EQ(info.analyzed_at[10], 'T');
    EXPECT_EQ(info.analyzed_at[13], ':');
    EXPECT_EQ(info.analyzed_at[16], ':');
    EXPECT_EQ(info.analyzed_at[19], 'Z');
}

TEST_F(IevrGameTest, AnalyzeIgnoresNonCpkFiles) {
    create_valid_structure();
    create_fake_cpks(3, 1024);

    // Ajouter des fichiers non-CPK
    std::ofstream(temp_dir_ / "data" / "packs" / "readme.txt") << "test";
    std::ofstream(temp_dir_ / "data" / "packs" / "data.bin") << "test";

    IevrGame game(temp_dir_);
    const auto info = game.analyze();

    EXPECT_EQ(info.cpk_count, 3); // Seuls les .cpk sont comptes
}

// ── Tests d'export JSON ─────────────────────────────────────────────

TEST_F(IevrGameTest, ExportInfoJson) {
    create_valid_structure();
    create_fake_cpks(2, 512);
    create_cpk_list();

    IevrGame game(temp_dir_);
    const auto json_str = game.export_info_json();

    // Verifier que c'est du JSON valide
    const auto j = nlohmann::json::parse(json_str);

    EXPECT_TRUE(j.contains("game_path"));
    EXPECT_TRUE(j.contains("exe_path"));
    EXPECT_TRUE(j.contains("exe_size"));
    EXPECT_TRUE(j.contains("cpk_count"));
    EXPECT_TRUE(j.contains("total_cpk_size"));
    EXPECT_TRUE(j.contains("has_cpk_list"));
    EXPECT_TRUE(j.contains("analyzed_at"));

    EXPECT_EQ(j["cpk_count"].get<int>(), 2);
    EXPECT_EQ(j["total_cpk_size"].get<int64_t>(), 2 * 512);
    EXPECT_TRUE(j["has_cpk_list"].get<bool>());
}

// ── Tests du sous-systeme EAC ───────────────────────────────────────

TEST_F(IevrGameTest, EacServiceAccessible) {
    create_valid_structure();
    IevrGame game(temp_dir_);

    // Le service EAC doit etre accessible (meme si le jeu n'a pas
    // de GameBootstrapper.ini dans notre dossier de test)
    [[maybe_unused]] auto& eac = game.eac();
    [[maybe_unused]] const auto& eac_const =
        static_cast<const IevrGame&>(game).eac();
}

// ── Tests de move semantics ─────────────────────────────────────────

TEST_F(IevrGameTest, MoveConstruct) {
    create_valid_structure();
    IevrGame game1(temp_dir_);
    ASSERT_TRUE(game1.is_valid());

    IevrGame game2(std::move(game1));
    EXPECT_TRUE(game2.is_valid());
}

TEST_F(IevrGameTest, MoveAssign) {
    create_valid_structure();
    IevrGame game1(temp_dir_);

    // Creer un second dossier invalide
    IevrGame game2(temp_dir_ / "invalid");
    EXPECT_FALSE(game2.is_valid());

    game2 = std::move(game1);
    EXPECT_TRUE(game2.is_valid());
}

// ── Test detect() — ne peut pas garantir la presence de Steam ───────

TEST_F(IevrGameTest, DetectReturnsOptional) {
    // detect() peut retourner nullopt si Steam n'est pas installe
    // On verifie juste que ca ne crashe pas
    [[maybe_unused]] auto result = IevrGame::detect();
    // Pas d'assertion — resultat depend de l'environnement
}
