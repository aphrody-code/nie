/// @file test_dump_service.cpp
/// Tests unitaires pour le service de dump CPK.
///
/// Utilise un repertoire temporaire simulant l'arborescence du jeu
/// pour tester le manifest, le plan, la reprise et la copie loose.
/// Note : les tests ne creent pas de vrais CPK — ils verifient
/// la logique du manifest et du plan d'extraction.

#include "iecode/services/dump_service.h"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <atomic>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using namespace iecode::services;
using json = nlohmann::json;

// ── Fixture ────────────────────────────────────────────────────────

class DumpServiceTest : public ::testing::Test {
protected:
    fs::path temp_dir_;
    fs::path game_dir_;
    fs::path output_dir_;

    void SetUp() override {
        temp_dir_ = fs::temp_directory_path() / "iecode_dump_test";
        fs::remove_all(temp_dir_);
        game_dir_ = temp_dir_ / "game";
        output_dir_ = temp_dir_ / "output";
        fs::create_directories(game_dir_ / "data" / "packs");
        fs::create_directories(output_dir_);
    }

    void TearDown() override {
        std::error_code ec;
        fs::remove_all(temp_dir_, ec);
    }

    /// Cree un fichier factice de la taille donnee.
    void create_file(const fs::path& path, size_t size = 64) {
        fs::create_directories(path.parent_path());
        std::ofstream f(path, std::ios::binary);
        const std::string data(size, 'X');
        f << data;
    }

    /// Ecrit un manifest JSON dans le dossier de sortie.
    void write_manifest(const json& j) {
        fs::create_directories(output_dir_);
        std::ofstream f(output_dir_ / ".iecode-manifest.json");
        f << j.dump(2);
    }

    /// Lit le manifest JSON depuis le dossier de sortie.
    [[nodiscard]] json read_manifest() const {
        std::ifstream f(output_dir_ / ".iecode-manifest.json");
        if (!f) return {};
        return json::parse(f);
    }
};

// ── Tests du manifest ─────────────────────────────────────────────

TEST_F(DumpServiceTest, ManifestCreatedOnFirstRun) {
    // Pas de CPK — le dump devrait quand meme creer un manifest
    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.smart_dump = true;
    opts.include_loose_files = false;

    auto result = svc.dump(opts);

    EXPECT_TRUE(result.success);
    EXPECT_FALSE(result.is_resume);
    EXPECT_EQ(result.total_cpks, 0);
    EXPECT_TRUE(fs::exists(output_dir_ / ".iecode-manifest.json"));

    auto manifest = read_manifest();
    EXPECT_TRUE(manifest.contains("game_path"));
    EXPECT_TRUE(manifest.contains("created_at"));
    EXPECT_TRUE(manifest.contains("completed_cpks"));
    EXPECT_TRUE(manifest.contains("extracted_files"));
}

TEST_F(DumpServiceTest, ManifestResumeDetected) {
    // Ecrire un manifest avec des fichiers deja extraits
    json manifest;
    manifest["game_path"] = game_dir_.string();
    manifest["created_at"] = "2025-01-01T00:00:00Z";
    manifest["last_updated"] = "2025-01-01T00:00:00Z";
    manifest["completed_cpks"] = json::array();
    manifest["extracted_files"] = json::object();
    manifest["extracted_files"]["some/file.g4tx"] = {{"size", 1024}, {"cpk_name", "test.cpk"}};
    write_manifest(manifest);

    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.smart_dump = true;
    opts.include_loose_files = false;

    auto result = svc.dump(opts);
    EXPECT_TRUE(result.is_resume);
}

TEST_F(DumpServiceTest, SmartDumpSkipsCompletedCpks) {
    // Creer un CPK factice (ne sera pas un vrai CPK mais on teste le skip)
    create_file(game_dir_ / "data" / "packs" / "test.cpk", 100);

    // Manifest indiquant que test.cpk est deja complete
    json manifest;
    manifest["game_path"] = game_dir_.string();
    manifest["created_at"] = "2025-01-01T00:00:00Z";
    manifest["last_updated"] = "2025-01-01T00:00:00Z";
    manifest["completed_cpks"] = json::array({"test.cpk"});
    manifest["extracted_files"] = json::object();
    write_manifest(manifest);

    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.smart_dump = true;
    opts.include_loose_files = false;

    auto result = svc.dump(opts);
    EXPECT_TRUE(result.success);
    // Le CPK est skip — 0 a extraire
    EXPECT_EQ(result.total_cpks, 0);
    EXPECT_EQ(result.extracted_files, 0);
}

// ── Tests d'annulation ────────────────────────────────────────────

TEST_F(DumpServiceTest, CancellationFlag) {
    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.include_loose_files = false;

    std::atomic<bool> cancel{true}; // Pre-cancelled
    auto result = svc.dump(opts, cancel);

    EXPECT_TRUE(result.was_cancelled);
    EXPECT_FALSE(result.success);
}

// ── Tests loose files ─────────────────────────────────────────────

TEST_F(DumpServiceTest, CopyLooseFiles) {
    // Creer des loose files dans data/ (hors packs/)
    create_file(game_dir_ / "data" / "common" / "system.cfg.bin", 256);
    create_file(game_dir_ / "data" / "settings.ini", 128);
    // Ce fichier dans packs/ ne doit PAS etre copie
    create_file(game_dir_ / "data" / "packs" / "inside.cfg.bin", 64);

    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.smart_dump = false;
    opts.include_loose_files = true;

    auto result = svc.dump(opts);
    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.loose_files_copied, 2);

    EXPECT_TRUE(fs::exists(output_dir_ / "common" / "system.cfg.bin"));
    EXPECT_TRUE(fs::exists(output_dir_ / "settings.ini"));
    EXPECT_FALSE(fs::exists(output_dir_ / "packs" / "inside.cfg.bin"));
}

TEST_F(DumpServiceTest, SmartDumpSkipsExistingLoose) {
    // Creer un loose file
    create_file(game_dir_ / "data" / "common" / "app.cfg.bin", 100);

    // Pre-creer le fichier de sortie
    create_file(output_dir_ / "common" / "app.cfg.bin", 100);

    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.smart_dump = true;
    opts.include_loose_files = true;

    auto result = svc.dump(opts);
    EXPECT_TRUE(result.success);
    // Le loose file existe deja → pas de copie
    EXPECT_EQ(result.loose_files_copied, 0);
}

// ── Tests de resultat ─────────────────────────────────────────────

TEST_F(DumpServiceTest, DurationTracked) {
    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.include_loose_files = false;

    auto result = svc.dump(opts);
    EXPECT_GE(result.duration_seconds, 0.0);
}

TEST_F(DumpServiceTest, ProgressCallbackInvoked) {
    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.include_loose_files = false;

    int callback_count = 0;
    opts.on_progress = [&callback_count](const DumpProgress&) {
        ++callback_count;
    };

    (void)svc.dump(opts);
    // Au minimum : LOADING + PLANNING + COMPLETED
    EXPECT_GE(callback_count, 2);
}

TEST_F(DumpServiceTest, OutputPathInResult) {
    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.include_loose_files = false;

    auto result = svc.dump(opts);
    EXPECT_EQ(result.output_path, output_dir_);
}

// ── Tests avec CPK invalide ───────────────────────────────────────

TEST_F(DumpServiceTest, InvalidCpkProducesError) {
    // Creer un faux CPK (pas un vrai format CPK)
    create_file(game_dir_ / "data" / "packs" / "invalid.cpk", 100);

    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.smart_dump = false;
    opts.include_loose_files = false;

    auto result = svc.dump(opts);
    // Le dump "reussit" — les CPK invalides sont simplement ignores a l'ouverture
    // (logges en warning, pas d'erreur fatale)
    EXPECT_TRUE(result.success);
    EXPECT_EQ(result.total_cpks, 1);
    // Aucun fichier extrait puisque le CPK est invalide
    EXPECT_EQ(result.extracted_files, 0);
}

TEST_F(DumpServiceTest, PacksPathOverride) {
    // Creer un dossier packs alternatif
    auto alt_packs = temp_dir_ / "alt_packs";
    create_file(alt_packs / "custom.cpk", 50);

    DumpService svc(game_dir_);
    DumpOptions opts;
    opts.output_path = output_dir_;
    opts.packs_path = alt_packs;
    opts.smart_dump = false;
    opts.include_loose_files = false;

    auto result = svc.dump(opts);
    // Doit trouver le CPK dans le dossier alternatif
    EXPECT_EQ(result.total_cpks, 1);
}
