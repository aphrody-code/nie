/// @file test_project.cpp
/// Tests du format de projet .iecode (creation, chargement, sauvegarde).

#include <gtest/gtest.h>

#include "iecode/editor/project.h"

#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;
using iecode::editor::Project;
using iecode::editor::ProjectSettings;

namespace {

/// Cree un repertoire temporaire unique pour chaque test.
class ProjectTest : public ::testing::Test {
protected:
    void SetUp() override
    {
        temp_dir_ = fs::temp_directory_path() / "iecode_test_project";
        fs::create_directories(temp_dir_);
    }

    void TearDown() override
    {
        std::error_code ec;
        fs::remove_all(temp_dir_, ec);
    }

    fs::path temp_dir_;
};

} // namespace

// ── Tests de creation ───────────────────────────────────────────────

TEST_F(ProjectTest, CreateWritesValidJsonFile)
{
    const auto path = temp_dir_ / "test.iecode";
    const ProjectSettings settings{
        .name = "Mon Projet",
        .game_data_path = "data",
        .game_install_path = "C:/Program Files/Steam/steamapps/common/IEVR",
        .last_open_file = "",
        .recent_files = {},
    };

    ASSERT_TRUE(Project::create(path, settings));
    EXPECT_TRUE(fs::exists(path));

    // Verifier que le fichier est du JSON valide
    std::ifstream file(path);
    ASSERT_TRUE(file.is_open());
    const auto json = nlohmann::json::parse(file, nullptr, false);
    EXPECT_FALSE(json.is_discarded());
    EXPECT_EQ(json["name"], "Mon Projet");
}

TEST_F(ProjectTest, CreateCreatesParentDirectories)
{
    const auto path = temp_dir_ / "sub" / "dir" / "deep.iecode";
    const ProjectSettings settings{.name = "Deep Project"};

    ASSERT_TRUE(Project::create(path, settings));
    EXPECT_TRUE(fs::exists(path));
}

// ── Tests de chargement ─────────────────────────────────────────────

TEST_F(ProjectTest, LoadReturnsSettingsFromValidFile)
{
    const auto path = temp_dir_ / "load_test.iecode";
    const ProjectSettings original{
        .name = "Test Load",
        .game_data_path = "/data/path",
        .game_install_path = "/install/path",
        .last_open_file = "file.g4tx",
        .recent_files = {"a.bin", "b.g4tx", "c.cfg.bin"},
    };

    ASSERT_TRUE(Project::create(path, original));

    const auto loaded = Project::load(path);
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->name, "Test Load");
    EXPECT_EQ(loaded->game_data_path, "/data/path");
    EXPECT_EQ(loaded->game_install_path, "/install/path");
    EXPECT_EQ(loaded->last_open_file, "file.g4tx");
    ASSERT_EQ(loaded->recent_files.size(), 3u);
    EXPECT_EQ(loaded->recent_files[0], "a.bin");
    EXPECT_EQ(loaded->recent_files[2], "c.cfg.bin");
}

TEST_F(ProjectTest, LoadReturnsNulloptForMissingFile)
{
    const auto result = Project::load(temp_dir_ / "inexistant.iecode");
    EXPECT_FALSE(result.has_value());
}

TEST_F(ProjectTest, LoadReturnsNulloptForInvalidJson)
{
    const auto path = temp_dir_ / "invalid.iecode";
    {
        std::ofstream file(path);
        file << "ceci n'est pas du JSON {{{";
    }

    const auto result = Project::load(path);
    EXPECT_FALSE(result.has_value());
}

// ── Tests de sauvegarde ─────────────────────────────────────────────

TEST_F(ProjectTest, SaveOverwritesExistingFile)
{
    const auto path = temp_dir_ / "overwrite.iecode";
    ProjectSettings v1{.name = "Version 1"};
    ProjectSettings v2{.name = "Version 2"};

    ASSERT_TRUE(Project::create(path, v1));
    ASSERT_TRUE(Project::save(path, v2));

    const auto loaded = Project::load(path);
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->name, "Version 2");
}

// ── Tests de fichiers recents ───────────────────────────────────────

TEST_F(ProjectTest, AddRecentFilePutsFileFirst)
{
    ProjectSettings settings{.recent_files = {"old.bin"}};
    Project::add_recent_file(settings, "new.g4tx");

    ASSERT_EQ(settings.recent_files.size(), 2u);
    EXPECT_EQ(settings.recent_files[0], "new.g4tx");
    EXPECT_EQ(settings.recent_files[1], "old.bin");
}

TEST_F(ProjectTest, AddRecentFileRemovesDuplicate)
{
    ProjectSettings settings{.recent_files = {"a.bin", "b.bin", "c.bin"}};
    Project::add_recent_file(settings, "b.bin");

    ASSERT_EQ(settings.recent_files.size(), 3u);
    EXPECT_EQ(settings.recent_files[0], "b.bin");
    EXPECT_EQ(settings.recent_files[1], "a.bin");
    EXPECT_EQ(settings.recent_files[2], "c.bin");
}

TEST_F(ProjectTest, AddRecentFileTruncatesAt20)
{
    ProjectSettings settings;
    for (int i = 0; i < 25; ++i) {
        Project::add_recent_file(settings,
                                 "file_" + std::to_string(i) + ".bin");
    }

    EXPECT_EQ(settings.recent_files.size(), 20u);
    EXPECT_EQ(settings.recent_files[0], "file_24.bin");
}

// ── Test du chemin par defaut ───────────────────────────────────────

TEST_F(ProjectTest, DefaultProjectPathIsNotEmpty)
{
    const auto path = Project::default_project_path();
    EXPECT_FALSE(path.empty());
    // Le chemin doit se terminer par "iecode/projects"
    EXPECT_TRUE(path.string().find("iecode") != std::string::npos);
}

// ── Test roundtrip JSON ─────────────────────────────────────────────

TEST_F(ProjectTest, RoundtripPreservesAllFields)
{
    const auto path = temp_dir_ / "roundtrip.iecode";
    const ProjectSettings original{
        .name = "Roundtrip Test",
        .game_data_path = "data",
        .game_install_path = "C:\\Games\\IEVR",
        .last_open_file = "test.cfg.bin",
        .recent_files = {"1.bin", "2.g4tx", "3.g4mg"},
    };

    ASSERT_TRUE(Project::create(path, original));
    const auto loaded = Project::load(path);
    ASSERT_TRUE(loaded.has_value());

    EXPECT_EQ(loaded->name, original.name);
    EXPECT_EQ(loaded->game_data_path, original.game_data_path);
    EXPECT_EQ(loaded->game_install_path, original.game_install_path);
    EXPECT_EQ(loaded->last_open_file, original.last_open_file);
    EXPECT_EQ(loaded->recent_files, original.recent_files);
}
