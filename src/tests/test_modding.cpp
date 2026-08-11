/// @file test_modding.cpp
/// Tests GTest pour le module modding (scanner, conflits, profils, config, steam, installer).

#include <gtest/gtest.h>

#include "iecode/modding/config_manager.h"
#include "iecode/modding/mod_conflict_detector.h"
#include "iecode/modding/mod_installer.h"
#include "iecode/modding/mod_scanner.h"
#include "iecode/modding/profile_manager.h"
#include "iecode/modding/steam_helper.h"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using namespace iecode::modding;

// ── Helpers ──────────────────────────────────────────────────────────

/// Dossier temporaire unique par test, nettoye automatiquement.
class TempDir {
public:
    TempDir() {
        static int counter = 0;
        path_ = fs::temp_directory_path() /
                ("iecode_test_modding_" + std::to_string(++counter) + "_" +
                 std::to_string(std::chrono::steady_clock::now()
                                    .time_since_epoch()
                                    .count()));
        fs::create_directories(path_);
    }

    ~TempDir() {
        std::error_code ec;
        fs::remove_all(path_, ec);
    }

    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    [[nodiscard]] const fs::path& path() const noexcept { return path_; }

private:
    fs::path path_;
};

/// Cree un fichier avec le contenu donne.
static void write_file(const fs::path& path, const std::string& content) {
    fs::create_directories(path.parent_path());
    std::ofstream f(path, std::ios::trunc);
    ASSERT_TRUE(f.good()) << "impossible de creer " << path;
    f << content;
}

/// Cree un mod factice dans mods_dir/name/ avec un mod_data.json optionnel.
static fs::path create_mock_mod(const fs::path& mods_dir,
                                const std::string& name,
                                const nlohmann::json& metadata = {}) {
    const auto mod_dir = mods_dir / name;
    fs::create_directories(mod_dir);

    if (!metadata.empty()) {
        write_file(mod_dir / "mod_data.json", metadata.dump(2));
    }

    return mod_dir;
}

/// Cree un fichier factice dans le sous-dossier data/ d'un mod.
static void create_mod_data_file(const fs::path& mod_dir,
                                 const std::string& relative_path) {
    write_file(mod_dir / "data" / relative_path, "contenu factice");
}

// ══════════════════════════════════════════════════════════════════════
//  ModScanner
// ══════════════════════════════════════════════════════════════════════

TEST(ModScanner, ScanEmptyDir) {
    TempDir tmp;
    auto mods = scan_mods(tmp.path());
    EXPECT_TRUE(mods.empty());
}

TEST(ModScanner, ScanNonExistentDir) {
    auto mods = scan_mods(fs::temp_directory_path() / "inexistant_dir_xyz");
    EXPECT_TRUE(mods.empty());
}

TEST(ModScanner, ScanFindsSubdirectories) {
    TempDir tmp;
    create_mock_mod(tmp.path(), "mod_a");
    create_mock_mod(tmp.path(), "mod_b");

    // Fichier a la racine — ne doit pas etre un mod
    write_file(tmp.path() / "readme.txt", "ignore");

    auto mods = scan_mods(tmp.path());
    EXPECT_EQ(mods.size(), 2u);
    // Tri par nom
    EXPECT_EQ(mods[0].name, "mod_a");
    EXPECT_EQ(mods[1].name, "mod_b");
}

TEST(ModScanner, ScanLoadsMetadata) {
    TempDir tmp;
    nlohmann::json meta = {
        {"Name", "Mon Mod"},
        {"Author", "Auteur"},
        {"ModVersion", "1.2.3"},
        {"GameVersion", "5.00"},
        {"ModLink", "https://example.com"}};
    create_mock_mod(tmp.path(), "test_mod", meta);

    auto mods = scan_mods(tmp.path());
    ASSERT_EQ(mods.size(), 1u);
    EXPECT_EQ(mods[0].metadata.display_name, "Mon Mod");
    EXPECT_EQ(mods[0].metadata.author, "Auteur");
    EXPECT_EQ(mods[0].metadata.mod_version, "1.2.3");
    EXPECT_EQ(mods[0].metadata.game_version, "5.00");
    EXPECT_EQ(mods[0].metadata.mod_link, "https://example.com");
}

TEST(ModScanner, ScanHandlesInvalidJson) {
    TempDir tmp;
    auto mod_dir = create_mock_mod(tmp.path(), "bad_json");
    write_file(mod_dir / "mod_data.json", "{invalid json content!!!}");

    auto mods = scan_mods(tmp.path());
    ASSERT_EQ(mods.size(), 1u);
    // Metadonnees vides mais mod detecte
    EXPECT_EQ(mods[0].name, "bad_json");
    EXPECT_TRUE(mods[0].metadata.display_name.empty());
}

TEST(ModScanner, ScanHandlesMissingModDataJson) {
    TempDir tmp;
    create_mock_mod(tmp.path(), "no_metadata"); // pas de mod_data.json

    auto mods = scan_mods(tmp.path());
    ASSERT_EQ(mods.size(), 1u);
    EXPECT_TRUE(mods[0].metadata.display_name.empty());
}

TEST(ModScanner, LoadModMetadataCaseInsensitive) {
    TempDir tmp;
    // Cles en casse mixte — json_get_ci doit les trouver
    nlohmann::json meta = {
        {"NAME", "Test"},
        {"AUTHOR", "Dev"},
    };
    auto mod_dir = create_mock_mod(tmp.path(), "ci_test", meta);

    auto metadata = load_mod_metadata(mod_dir);
    EXPECT_EQ(metadata.display_name, "Test");
    EXPECT_EQ(metadata.author, "Dev");
}

TEST(ModScanner, ModTouchesPacksTrue) {
    TempDir tmp;
    auto mod_dir = create_mock_mod(tmp.path(), "packs_mod");
    create_mod_data_file(mod_dir, "packs/abc123.cpk");

    ModInfo info;
    info.name = "packs_mod";
    info.path = mod_dir;
    EXPECT_TRUE(mod_touches_packs(info));
}

TEST(ModScanner, ModTouchesPacksFalseNoData) {
    TempDir tmp;
    auto mod_dir = create_mock_mod(tmp.path(), "no_data_mod");

    ModInfo info;
    info.name = "no_data_mod";
    info.path = mod_dir;
    EXPECT_FALSE(mod_touches_packs(info));
}

TEST(ModScanner, ModTouchesPacksFalseNoPacks) {
    TempDir tmp;
    auto mod_dir = create_mock_mod(tmp.path(), "other_mod");
    create_mod_data_file(mod_dir, "common/textures/face.g4tx");

    ModInfo info;
    info.name = "other_mod";
    info.path = mod_dir;
    EXPECT_FALSE(mod_touches_packs(info));
}

// ── DiffScans ────────────────────────────────────────────────────────

TEST(ModScanner, DiffScansEmpty) {
    auto diff = diff_scans({}, {});
    EXPECT_FALSE(diff.has_changes());
}

TEST(ModScanner, DiffScansDetectsAdded) {
    std::vector<ModInfo> prev;
    std::vector<ModInfo> curr;

    ModInfo mod;
    mod.name = "new_mod";
    curr.push_back(mod);

    auto diff = diff_scans(prev, curr);
    EXPECT_TRUE(diff.has_changes());
    ASSERT_EQ(diff.added.size(), 1u);
    EXPECT_EQ(diff.added[0].name, "new_mod");
    EXPECT_TRUE(diff.removed.empty());
}

TEST(ModScanner, DiffScansDetectsRemoved) {
    std::vector<ModInfo> prev;
    ModInfo mod;
    mod.name = "old_mod";
    prev.push_back(mod);

    auto diff = diff_scans(prev, {});
    EXPECT_TRUE(diff.has_changes());
    ASSERT_EQ(diff.removed.size(), 1u);
    EXPECT_EQ(diff.removed[0].name, "old_mod");
}

TEST(ModScanner, DiffScansDetectsModified) {
    ModInfo prev_mod;
    prev_mod.name = "shared";
    prev_mod.metadata.display_name = "V1";

    ModInfo curr_mod;
    curr_mod.name = "shared";
    curr_mod.metadata.display_name = "V2";

    auto diff = diff_scans({prev_mod}, {curr_mod});
    EXPECT_TRUE(diff.has_changes());
    EXPECT_TRUE(diff.added.empty());
    EXPECT_TRUE(diff.removed.empty());
    ASSERT_EQ(diff.modified.size(), 1u);
    EXPECT_EQ(diff.modified[0].metadata.display_name, "V2");
}

TEST(ModScanner, DiffScansNoChange) {
    ModInfo mod;
    mod.name = "stable";
    mod.metadata.display_name = "Same";
    mod.metadata.mod_version = "1.0";

    auto diff = diff_scans({mod}, {mod});
    EXPECT_FALSE(diff.has_changes());
}

// ══════════════════════════════════════════════════════════════════════
//  ModConflictDetector
// ══════════════════════════════════════════════════════════════════════

TEST(ModConflictDetector, NoConflictsWithSingleMod) {
    TempDir tmp;
    auto mod_dir = create_mock_mod(tmp.path(), "solo");
    create_mod_data_file(mod_dir, "textures/face.g4tx");

    ModInfo info;
    info.name = "solo";
    info.path = mod_dir;

    auto report = detect_conflicts({info});
    EXPECT_FALSE(report.has_conflicts());
    EXPECT_EQ(report.count(), 0u);
}

TEST(ModConflictDetector, DetectsOverlappingFiles) {
    TempDir tmp;
    auto mod_a = create_mock_mod(tmp.path(), "mod_a");
    auto mod_b = create_mock_mod(tmp.path(), "mod_b");
    create_mod_data_file(mod_a, "textures/shared.g4tx");
    create_mod_data_file(mod_b, "textures/shared.g4tx");

    ModInfo info_a{.name = "mod_a", .path = mod_a};
    ModInfo info_b{.name = "mod_b", .path = mod_b};

    auto report = detect_conflicts({info_a, info_b});
    EXPECT_TRUE(report.has_conflicts());
    EXPECT_EQ(report.count(), 1u);

    auto it = report.conflicts.find("textures/shared.g4tx");
    ASSERT_NE(it, report.conflicts.end());
    EXPECT_EQ(it->second.size(), 2u);
}

TEST(ModConflictDetector, NoConflictsNonOverlapping) {
    TempDir tmp;
    auto mod_a = create_mock_mod(tmp.path(), "mod_a");
    auto mod_b = create_mock_mod(tmp.path(), "mod_b");
    create_mod_data_file(mod_a, "textures/file_a.g4tx");
    create_mod_data_file(mod_b, "textures/file_b.g4tx");

    ModInfo info_a{.name = "mod_a", .path = mod_a};
    ModInfo info_b{.name = "mod_b", .path = mod_b};

    auto report = detect_conflicts({info_a, info_b});
    EXPECT_FALSE(report.has_conflicts());
}

TEST(ModConflictDetector, ExcludesCpkListCfgBin) {
    TempDir tmp;
    auto mod_a = create_mock_mod(tmp.path(), "mod_a");
    auto mod_b = create_mock_mod(tmp.path(), "mod_b");
    // cpk_list.cfg.bin est genere automatiquement — ne doit pas etre un conflit
    create_mod_data_file(mod_a, "cpk_list.cfg.bin");
    create_mod_data_file(mod_b, "cpk_list.cfg.bin");

    ModInfo info_a{.name = "mod_a", .path = mod_a};
    ModInfo info_b{.name = "mod_b", .path = mod_b};

    auto report = detect_conflicts({info_a, info_b});
    EXPECT_FALSE(report.has_conflicts());
}

TEST(ModConflictDetector, IgnoresDisabledMods) {
    TempDir tmp;
    auto mod_a = create_mock_mod(tmp.path(), "mod_a");
    auto mod_b = create_mock_mod(tmp.path(), "mod_b");
    create_mod_data_file(mod_a, "textures/shared.g4tx");
    create_mod_data_file(mod_b, "textures/shared.g4tx");

    ModInfo info_a{.name = "mod_a", .path = mod_a, .enabled = true};
    ModInfo info_b{.name = "mod_b", .path = mod_b, .enabled = false};

    auto report = detect_conflicts({info_a, info_b});
    EXPECT_FALSE(report.has_conflicts());
}

TEST(ModConflictDetector, ModsWithoutDataDir) {
    TempDir tmp;
    auto mod_a = create_mock_mod(tmp.path(), "mod_a");
    // Pas de sous-dossier data/

    ModInfo info_a{.name = "mod_a", .path = mod_a};

    auto report = detect_conflicts({info_a});
    EXPECT_FALSE(report.has_conflicts());
}

// ══════════════════════════════════════════════════════════════════════
//  ProfileManager
// ══════════════════════════════════════════════════════════════════════

TEST(ProfileManager, CreateAndLoadProfile) {
    TempDir tmp;
    ProfileManager mgr(tmp.path());

    ModProfile profile;
    profile.name = "test_profile";
    profile.created_at = "2025-01-01T00:00:00Z";
    profile.selected_cpk_name = "custom.cpk";
    profile.mods.push_back(ModProfileEntry{.name = "mod_a", .enabled = true});

    EXPECT_TRUE(mgr.save_profile(profile));
    EXPECT_TRUE(mgr.profile_exists("test_profile"));

    auto loaded = mgr.load_profile("test_profile");
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->name, "test_profile");
    EXPECT_EQ(loaded->created_at, "2025-01-01T00:00:00Z");
    EXPECT_EQ(loaded->selected_cpk_name, "custom.cpk");
    ASSERT_EQ(loaded->mods.size(), 1u);
    EXPECT_EQ(loaded->mods[0].name, "mod_a");
    EXPECT_TRUE(loaded->mods[0].enabled);
    // last_modified doit avoir ete mis a jour automatiquement
    EXPECT_FALSE(loaded->last_modified.empty());
}

TEST(ProfileManager, LoadNonExistentProfile) {
    TempDir tmp;
    ProfileManager mgr(tmp.path());
    EXPECT_FALSE(mgr.load_profile("inexistant").has_value());
    EXPECT_FALSE(mgr.profile_exists("inexistant"));
}

TEST(ProfileManager, DeleteProfile) {
    TempDir tmp;
    ProfileManager mgr(tmp.path());

    ModProfile profile;
    profile.name = "to_delete";
    EXPECT_TRUE(mgr.save_profile(profile));
    EXPECT_TRUE(mgr.profile_exists("to_delete"));

    EXPECT_TRUE(mgr.delete_profile("to_delete"));
    EXPECT_FALSE(mgr.profile_exists("to_delete"));
}

TEST(ProfileManager, ListProfiles) {
    TempDir tmp;
    ProfileManager mgr(tmp.path());

    ModProfile p1;
    p1.name = "alpha";
    EXPECT_TRUE(mgr.save_profile(p1));

    ModProfile p2;
    p2.name = "beta";
    EXPECT_TRUE(mgr.save_profile(p2));

    auto profiles = mgr.list_profiles();
    EXPECT_EQ(profiles.size(), 2u);
}

TEST(ProfileManager, ListProfilesEmptyDir) {
    TempDir tmp;
    ProfileManager mgr(tmp.path());
    auto profiles = mgr.list_profiles();
    EXPECT_TRUE(profiles.empty());
}

TEST(ProfileManager, ListProfilesNonExistentDir) {
    ProfileManager mgr(fs::temp_directory_path() / "non_existent_profiles_xyz");
    auto profiles = mgr.list_profiles();
    EXPECT_TRUE(profiles.empty());
}

TEST(ProfileManager, SanitizeFilenameSpecialChars) {
    TempDir tmp;
    ProfileManager mgr(tmp.path());

    // Un nom avec des caracteres interdits doit quand meme fonctionner
    ModProfile profile;
    profile.name = "test<>:\"profile";
    EXPECT_TRUE(mgr.save_profile(profile));
    EXPECT_TRUE(mgr.profile_exists("test<>:\"profile"));

    auto loaded = mgr.load_profile("test<>:\"profile");
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->name, "test<>:\"profile");
}

TEST(ProfileManager, OverwriteExistingProfile) {
    TempDir tmp;
    ProfileManager mgr(tmp.path());

    ModProfile v1;
    v1.name = "evolving";
    v1.selected_cpk_name = "old.cpk";
    EXPECT_TRUE(mgr.save_profile(v1));

    ModProfile v2;
    v2.name = "evolving";
    v2.selected_cpk_name = "new.cpk";
    EXPECT_TRUE(mgr.save_profile(v2));

    auto loaded = mgr.load_profile("evolving");
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->selected_cpk_name, "new.cpk");
}

// ══════════════════════════════════════════════════════════════════════
//  ConfigManager
// ══════════════════════════════════════════════════════════════════════

TEST(ConfigManager, LoadCreatesDefaultIfMissing) {
    TempDir tmp;
    const auto config_path = tmp.path() / "config.json";
    ConfigManager mgr(config_path);

    auto config = mgr.load();
    // Les valeurs par defaut doivent etre presentes
    EXPECT_EQ(config.mods_dir, fs::path("mods"));
    EXPECT_EQ(config.profiles_dir, fs::path("profiles"));
    // Le fichier doit avoir ete cree
    EXPECT_TRUE(fs::exists(config_path));
}

TEST(ConfigManager, SaveAndLoadRoundtrip) {
    TempDir tmp;
    const auto config_path = tmp.path() / "config.json";
    ConfigManager mgr(config_path);

    AppConfig config;
    config.game_path = "C:/Games/IEVR";
    config.mods_dir = "my_mods";
    config.profiles_dir = "my_profiles";
    config.selected_cpk_name = "custom.cpk";
    config.show_technical_logs = true;
    config.game_version = "5.00.24.00";
    config.mods.push_back(ModConfig{.name = "mod_a", .enabled = true, .order = 0});
    config.mods.push_back(ModConfig{.name = "mod_b", .enabled = false, .order = 1});

    EXPECT_TRUE(mgr.save(config));

    auto loaded = mgr.load();
    EXPECT_EQ(loaded.game_path, fs::path("C:/Games/IEVR"));
    EXPECT_EQ(loaded.mods_dir, fs::path("my_mods"));
    EXPECT_EQ(loaded.selected_cpk_name, "custom.cpk");
    EXPECT_TRUE(loaded.show_technical_logs);
    EXPECT_EQ(loaded.game_version, "5.00.24.00");
    ASSERT_EQ(loaded.mods.size(), 2u);
    EXPECT_EQ(loaded.mods[0].name, "mod_a");
    EXPECT_TRUE(loaded.mods[0].enabled);
    EXPECT_EQ(loaded.mods[1].name, "mod_b");
    EXPECT_FALSE(loaded.mods[1].enabled);
}

TEST(ConfigManager, AtomicWriteDoesNotCorrupt) {
    TempDir tmp;
    const auto config_path = tmp.path() / "config.json";
    ConfigManager mgr(config_path);

    // Premiere sauvegarde
    AppConfig c1;
    c1.game_path = "path_v1";
    c1.mods_dir = "mods";
    c1.profiles_dir = "profiles";
    EXPECT_TRUE(mgr.save(c1));

    // Deuxieme sauvegarde
    AppConfig c2;
    c2.game_path = "path_v2";
    c2.mods_dir = "mods";
    c2.profiles_dir = "profiles";
    EXPECT_TRUE(mgr.save(c2));

    // Le fichier temp ne doit pas subsister
    EXPECT_FALSE(fs::exists(fs::path(config_path.string() + ".tmp")));

    auto loaded = mgr.load();
    EXPECT_EQ(loaded.game_path, fs::path("path_v2"));
}

TEST(ConfigManager, ApplySavedStateOrder) {
    std::vector<ModInfo> mods;
    ModInfo m1; m1.name = "alpha"; m1.enabled = true;
    ModInfo m2; m2.name = "beta";  m2.enabled = true;
    ModInfo m3; m3.name = "gamma"; m3.enabled = true;
    mods = {m1, m2, m3};

    // L'etat sauvegarde a un ordre different et beta est desactive
    std::vector<ModConfig> saved = {
        {.name = "gamma", .enabled = true, .order = 0},
        {.name = "alpha", .enabled = true, .order = 1},
        {.name = "beta",  .enabled = false, .order = 2},
    };

    ConfigManager::apply_saved_state(mods, saved);

    // Ordre doit etre gamma, alpha, beta
    ASSERT_EQ(mods.size(), 3u);
    EXPECT_EQ(mods[0].name, "gamma");
    EXPECT_EQ(mods[1].name, "alpha");
    EXPECT_EQ(mods[2].name, "beta");
    // beta doit etre desactive
    EXPECT_FALSE(mods[2].enabled);
}

TEST(ConfigManager, ApplySavedStateNewModsAtEnd) {
    std::vector<ModInfo> mods;
    ModInfo m1; m1.name = "known"; m1.enabled = true;
    ModInfo m2; m2.name = "new_mod"; m2.enabled = true;
    mods = {m1, m2};

    std::vector<ModConfig> saved = {
        {.name = "known", .enabled = true, .order = 5},
    };

    ConfigManager::apply_saved_state(mods, saved);
    // known garde son ordre, new_mod doit etre apres
    EXPECT_EQ(mods[0].name, "known");
    EXPECT_EQ(mods[1].name, "new_mod");
    EXPECT_TRUE(mods[1].enabled); // nouveau mod = enabled par defaut
}

TEST(ConfigManager, MigrateDefaultValues) {
    TempDir tmp;
    const auto config_path = tmp.path() / "config.json";

    // Ecrire un JSON minimal (simule une ancienne version sans mods_dir)
    write_file(config_path, R"({"game_path": "C:/test"})");

    ConfigManager mgr(config_path);
    auto config = mgr.load();
    // La migration doit ajouter les chemins par defaut
    EXPECT_EQ(config.mods_dir, fs::path("mods"));
    EXPECT_EQ(config.profiles_dir, fs::path("profiles"));
}

// ══════════════════════════════════════════════════════════════════════
//  SteamHelper
// ══════════════════════════════════════════════════════════════════════

TEST(SteamHelper, ValidateGamePathValid) {
    TempDir tmp;
    // Creer la structure minimale attendue
    write_file(tmp.path() / "nie.exe", "fake");
    fs::create_directories(tmp.path() / "data");

    EXPECT_TRUE(validate_game_path(tmp.path()));
}

TEST(SteamHelper, ValidateGamePathAlternativeExe) {
    TempDir tmp;
    write_file(tmp.path() / "nie1v2.exe", "fake");
    fs::create_directories(tmp.path() / "data");

    EXPECT_TRUE(validate_game_path(tmp.path()));
}

TEST(SteamHelper, ValidateGamePathMissingExe) {
    TempDir tmp;
    fs::create_directories(tmp.path() / "data");
    EXPECT_FALSE(validate_game_path(tmp.path()));
}

TEST(SteamHelper, ValidateGamePathMissingData) {
    TempDir tmp;
    write_file(tmp.path() / "nie.exe", "fake");
    EXPECT_FALSE(validate_game_path(tmp.path()));
}

TEST(SteamHelper, ValidateGamePathNonExistent) {
    EXPECT_FALSE(validate_game_path(
        fs::temp_directory_path() / "non_existent_game_dir_xyz"));
}

TEST(SteamHelper, GetLibraryFoldersNonExistentSteam) {
    auto folders = get_library_folders(
        fs::temp_directory_path() / "fake_steam_xyz");
    EXPECT_TRUE(folders.empty());
}

TEST(SteamHelper, GetLibraryFoldersParsesVdf) {
    TempDir tmp;
    // Simuler une structure Steam minimale
    const auto steamapps = tmp.path() / "steamapps";
    fs::create_directories(steamapps);

    // Ecrire un libraryfolders.vdf minimal
    write_file(steamapps / "libraryfolders.vdf",
               R"("libraryfolders"
{
    "0"
    {
        "path"      ")" + tmp.path().generic_string() + R"("
    }
})");

    auto folders = get_library_folders(tmp.path());
    // Au minimum le dossier steamapps racine doit etre present
    EXPECT_GE(folders.size(), 1u);
}

// ══════════════════════════════════════════════════════════════════════
//  LastInstallManager
// ══════════════════════════════════════════════════════════════════════

TEST(LastInstallManager, SaveAndLoad) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());

    LastInstallRecord record;
    record.game_path = "C:/Games/IEVR";
    record.installed_mods = {"mod_a", "mod_b"};
    record.installed_files = {"data/tex/file.g4tx", "data/mesh/model.g4mg"};
    record.applied_at = "2025-06-01T12:00:00Z";
    record.selected_cpk_name = "test.cpk";

    EXPECT_TRUE(mgr.save(record));

    auto loaded = mgr.load();
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->game_path, fs::path("C:/Games/IEVR"));
    EXPECT_EQ(loaded->installed_mods.size(), 2u);
    EXPECT_EQ(loaded->installed_files.size(), 2u);
    EXPECT_EQ(loaded->applied_at, "2025-06-01T12:00:00Z");
    EXPECT_EQ(loaded->selected_cpk_name, "test.cpk");
}

TEST(LastInstallManager, LoadReturnsNulloptIfAbsent) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());
    EXPECT_FALSE(mgr.load().has_value());
}

TEST(LastInstallManager, ClearRemovesFile) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());

    LastInstallRecord record;
    record.game_path = "C:/test";
    EXPECT_TRUE(mgr.save(record));
    EXPECT_TRUE(mgr.load().has_value());

    EXPECT_TRUE(mgr.clear());
    EXPECT_FALSE(mgr.load().has_value());
}

TEST(LastInstallManager, ClearNonExistentSucceeds) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());
    EXPECT_TRUE(mgr.clear()); // Rien a supprimer = succes
}

TEST(LastInstallManager, GetInstalledFiles) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());

    LastInstallRecord record;
    record.installed_files = {"a.txt", "b/c.txt"};
    EXPECT_TRUE(mgr.save(record));

    auto files = mgr.get_installed_files();
    EXPECT_EQ(files.size(), 2u);
}

TEST(LastInstallManager, GetInstalledFilesEmpty) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());
    auto files = mgr.get_installed_files();
    EXPECT_TRUE(files.empty());
}

TEST(LastInstallManager, ModsMatchLastInstall) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());

    LastInstallRecord record;
    record.installed_mods = {"mod_a", "mod_b"};
    EXPECT_TRUE(mgr.save(record));

    // Meme set de mods — doit matcher
    ModInfo m1; m1.name = "mod_a"; m1.enabled = true;
    ModInfo m2; m2.name = "mod_b"; m2.enabled = true;
    EXPECT_TRUE(mgr.mods_match_last_install({m1, m2}));

    // Ordre different — doit quand meme matcher
    EXPECT_TRUE(mgr.mods_match_last_install({m2, m1}));

    // Mod manquant — ne doit pas matcher
    EXPECT_FALSE(mgr.mods_match_last_install({m1}));

    // Mod en plus — ne doit pas matcher
    ModInfo m3; m3.name = "mod_c"; m3.enabled = true;
    EXPECT_FALSE(mgr.mods_match_last_install({m1, m2, m3}));
}

TEST(LastInstallManager, ModsMatchIgnoresDisabled) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());

    LastInstallRecord record;
    record.installed_mods = {"mod_a"};
    EXPECT_TRUE(mgr.save(record));

    ModInfo m1; m1.name = "mod_a"; m1.enabled = true;
    ModInfo m2; m2.name = "mod_b"; m2.enabled = false; // desactive = ignore
    EXPECT_TRUE(mgr.mods_match_last_install({m1, m2}));
}

TEST(LastInstallManager, CpkMatchesLastInstall) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());

    LastInstallRecord record;
    record.selected_cpk_name = "custom.cpk";
    EXPECT_TRUE(mgr.save(record));

    EXPECT_TRUE(mgr.cpk_matches_last_install("custom.cpk"));
    EXPECT_FALSE(mgr.cpk_matches_last_install("other.cpk"));
}

TEST(LastInstallManager, CpkMatchReturnsFalseIfNoRecord) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());
    EXPECT_FALSE(mgr.cpk_matches_last_install("any.cpk"));
}

TEST(LastInstallManager, CleanupObsoleteFiles) {
    TempDir tmp;
    TempDir game_dir;
    LastInstallManager mgr(tmp.path());

    // Sauvegarder un record avec 3 fichiers
    LastInstallRecord record;
    record.installed_files = {"file_a.txt", "file_b.txt", "sub/file_c.txt"};
    EXPECT_TRUE(mgr.save(record));

    // Creer ces fichiers dans le dossier du jeu
    write_file(game_dir.path() / "file_a.txt", "a");
    write_file(game_dir.path() / "file_b.txt", "b");
    write_file(game_dir.path() / "sub" / "file_c.txt", "c");

    // Le nouveau set ne contient que file_a.txt — b et c sont obsoletes
    std::vector<fs::path> current_files = {fs::path("file_a.txt")};
    auto removed = mgr.cleanup_obsolete_files(current_files, game_dir.path());
    EXPECT_EQ(removed, 2u);

    // Les fichiers obsoletes doivent avoir ete supprimes
    EXPECT_TRUE(fs::exists(game_dir.path() / "file_a.txt"));
    EXPECT_FALSE(fs::exists(game_dir.path() / "file_b.txt"));
    EXPECT_FALSE(fs::exists(game_dir.path() / "sub" / "file_c.txt"));
    // Le dossier sub/ vide doit aussi avoir ete supprime
    EXPECT_FALSE(fs::exists(game_dir.path() / "sub"));
}

TEST(LastInstallManager, AtomicWriteNoTempResidue) {
    TempDir tmp;
    LastInstallManager mgr(tmp.path());

    LastInstallRecord record;
    record.game_path = "C:/test";
    EXPECT_TRUE(mgr.save(record));

    // Le fichier .tmp ne doit pas subsister
    const auto json_file = tmp.path() / "last_install.json";
    EXPECT_TRUE(fs::exists(json_file));
    EXPECT_FALSE(fs::exists(fs::path(json_file.string() + ".tmp")));
}
