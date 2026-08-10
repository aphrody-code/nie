/// @file test_gamebanana.cpp
/// Tests GTest pour le client GameBanana API et le verificateur de mises a jour.
///
/// Note : les tests qui effectuent de vraies requetes HTTP sont desactives
/// par defaut (DISABLED_) pour ne pas dependre du reseau dans le CI.
/// Les activer manuellement pour tester l'integration.

#include <gtest/gtest.h>

#include "iecode/modding/gamebanana.h"
#include "iecode/modding/update_checker.h"

#include <string>
#include <vector>

using namespace iecode::modding;

// ═══════════════════════════════════════════════════════════════════════
// Tests unitaires (offline, pas de reseau)
// ═══════════════════════════════════════════════════════════════════════

// ── is_newer_version ─────────────────────────────────────────────────

TEST(UpdateChecker, IsNewerVersion_Newer) {
    EXPECT_TRUE(is_newer_version("1.7.0", "1.8.0"));
    EXPECT_TRUE(is_newer_version("1.0.0", "2.0.0"));
    EXPECT_TRUE(is_newer_version("1.7.0", "1.7.1"));
    EXPECT_TRUE(is_newer_version("0.9.9", "1.0.0"));
}

TEST(UpdateChecker, IsNewerVersion_Equal) {
    EXPECT_FALSE(is_newer_version("1.7.0", "1.7.0"));
    EXPECT_FALSE(is_newer_version("2.0.0", "2.0.0"));
}

TEST(UpdateChecker, IsNewerVersion_Older) {
    EXPECT_FALSE(is_newer_version("1.8.0", "1.7.0"));
    EXPECT_FALSE(is_newer_version("2.0.0", "1.9.9"));
}

TEST(UpdateChecker, IsNewerVersion_WithPrefix) {
    EXPECT_TRUE(is_newer_version("v1.7.0", "v1.8.0"));
    EXPECT_TRUE(is_newer_version("V1.7.0", "v1.8.0"));
    EXPECT_FALSE(is_newer_version("v1.8.0", "v1.7.0"));
}

TEST(UpdateChecker, IsNewerVersion_WithSuffix) {
    EXPECT_TRUE(is_newer_version("1.7.0+abc123", "1.8.0+def456"));
    EXPECT_TRUE(is_newer_version("1.7.0-beta", "1.8.0-rc1"));
    EXPECT_FALSE(is_newer_version("1.8.0+abc", "1.7.0+def"));
}

TEST(UpdateChecker, IsNewerVersion_DifferentLengths) {
    EXPECT_TRUE(is_newer_version("1.7", "1.7.1"));
    EXPECT_FALSE(is_newer_version("1.7.1", "1.7"));
    EXPECT_TRUE(is_newer_version("1", "1.0.1"));
}

TEST(UpdateChecker, IsNewerVersion_Empty) {
    EXPECT_FALSE(is_newer_version("", "1.0.0"));
    EXPECT_FALSE(is_newer_version("1.0.0", ""));
    EXPECT_FALSE(is_newer_version("", ""));
}

// ── extract_gamebanana_id ────────────────────────────────────────────

TEST(UpdateChecker, ExtractGameBananaId_DirectNumber) {
    EXPECT_EQ(extract_gamebanana_id("12345"), 12345);
    EXPECT_EQ(extract_gamebanana_id("1"), 1);
    EXPECT_EQ(extract_gamebanana_id("999999"), 999999);
}

TEST(UpdateChecker, ExtractGameBananaId_FullUrl) {
    EXPECT_EQ(extract_gamebanana_id("https://gamebanana.com/mods/12345"), 12345);
    EXPECT_EQ(extract_gamebanana_id("http://gamebanana.com/mods/67890"), 67890);
    EXPECT_EQ(extract_gamebanana_id("https://www.gamebanana.com/mods/42"), 42);
}

TEST(UpdateChecker, ExtractGameBananaId_PartialUrl) {
    EXPECT_EQ(extract_gamebanana_id("gamebanana.com/mods/12345"), 12345);
}

TEST(UpdateChecker, ExtractGameBananaId_Invalid) {
    EXPECT_EQ(extract_gamebanana_id(""), 0);
    EXPECT_EQ(extract_gamebanana_id("not a url"), 0);
    EXPECT_EQ(extract_gamebanana_id("https://example.com/mods/123"), 0);
}

// ── GameBananaMod struct defaults ────────────────────────────────────

TEST(GameBanana, DefaultModValues) {
    GameBananaMod mod;
    EXPECT_EQ(mod.id, 0);
    EXPECT_TRUE(mod.name.empty());
    EXPECT_TRUE(mod.page_url.empty());
    EXPECT_TRUE(mod.download_url.empty());
    EXPECT_TRUE(mod.thumbnail_url.empty());
    EXPECT_EQ(mod.downloads, 0);
}

TEST(GameBanana, DefaultFileValues) {
    GameBananaFile file;
    EXPECT_EQ(file.id, 0);
    EXPECT_TRUE(file.filename.empty());
    EXPECT_TRUE(file.download_url.empty());
    EXPECT_EQ(file.file_size, 0);
    EXPECT_EQ(file.downloads, 0);
}

TEST(GameBanana, DefaultSearchResult) {
    GameBananaSearchResult result;
    EXPECT_TRUE(result.mods.empty());
    EXPECT_EQ(result.page, 1);
    EXPECT_EQ(result.page_size, GAMEBANANA_DEFAULT_PAGE_SIZE);
    EXPECT_FALSE(result.has_more);
}

TEST(GameBanana, DefaultDownloadResult) {
    DownloadResult result;
    EXPECT_FALSE(result.success);
    EXPECT_TRUE(result.output_path.empty());
    EXPECT_TRUE(result.error.empty());
    EXPECT_EQ(result.bytes_downloaded, 0u);
}

// ── GitHubRelease struct defaults ────────────────────────────────────

TEST(UpdateChecker, DefaultGitHubRelease) {
    GitHubRelease release;
    EXPECT_TRUE(release.tag_name.empty());
    EXPECT_TRUE(release.name.empty());
    EXPECT_TRUE(release.body.empty());
    EXPECT_TRUE(release.published_at.empty());
    EXPECT_TRUE(release.assets.empty());
}

TEST(UpdateChecker, DefaultAppUpdateResult) {
    AppUpdateResult result;
    EXPECT_FALSE(result.update_available);
    EXPECT_TRUE(result.current_version.empty());
    EXPECT_TRUE(result.latest_version.empty());
    EXPECT_FALSE(result.release.has_value());
    EXPECT_TRUE(result.error.empty());
}

// ═══════════════════════════════════════════════════════════════════════
// Tests d'integration (reseau requis — desactives par defaut)
// ═══════════════════════════════════════════════════════════════════════

TEST(GameBanana, DISABLED_ListMods) {
    auto result = gamebanana_list_mods(1, 10);
    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->mods.empty());
    EXPECT_EQ(result->page, 1);
    for (const auto& mod : result->mods) {
        EXPECT_GT(mod.id, 0);
        EXPECT_FALSE(mod.name.empty());
    }
}

TEST(GameBanana, DISABLED_SearchMods) {
    auto result = gamebanana_search_mods("texture", 1, 50);
    ASSERT_TRUE(result.has_value());
    // Le filtrage local peut retourner 0 resultats si aucun mod recents
    // ne contient "texture" dans le nom
    EXPECT_EQ(result->page, 1);
}

TEST(GameBanana, DISABLED_GetModDetails) {
    // Utilise un ID de mod connu (premier mod IEVR sur GameBanana)
    auto mod = gamebanana_get_mod(529835);
    if (mod) {
        EXPECT_EQ(mod->id, 529835);
        EXPECT_FALSE(mod->name.empty());
    }
    // Si le mod n'existe plus, le test est accepte (reseau OK, mod supprime)
}

TEST(GameBanana, DISABLED_GetModFiles) {
    auto files = gamebanana_get_files(529835);
    if (files) {
        // Le mod peut ne pas avoir de fichiers
        for (const auto& f : *files) {
            EXPECT_GT(f.id, 0);
        }
    }
}

TEST(UpdateChecker, DISABLED_FetchLatestRelease) {
    auto release = fetch_latest_release();
    ASSERT_TRUE(release.has_value());
    EXPECT_FALSE(release->tag_name.empty());
    EXPECT_FALSE(release->name.empty());
}

TEST(UpdateChecker, DISABLED_CheckAppUpdate) {
    auto result = check_app_update("0.0.1");
    EXPECT_TRUE(result.update_available);
    EXPECT_FALSE(result.latest_version.empty());
}
