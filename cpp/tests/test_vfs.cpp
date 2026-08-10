/// @file test_vfs.cpp
/// Tests du VFS (Virtual File System).
///
/// Utilise des donnees cfg.bin synthetiques (creees programmatiquement)
/// pour tester l'indexation et la recherche sans donnees de jeu reelles.

#include <gtest/gtest.h>

#include "iecode/vfs/vfs.h"
#include "iecode/formats/level5/cfgbin.h"

using namespace iecode::vfs;
using namespace iecode::level5;

// ── Helpers ──────────────────────────────────────────────────────

/// Cree un CfgBinFile T2B simulant cpk_list.cfg.bin avec les entrees donnees.
/// Chaque tuple = (directory, filename, cpk_hash, size).
static std::vector<uint8_t> make_mock_cpk_list(
    const std::vector<std::tuple<std::string, std::string, std::string, int32_t>>& items) {

    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    // Creer l'entree racine
    CfgEntry root;
    root.name = "CPK_ITEM_BEGIN_0";
    root.crc32 = 0;

    for (const auto& [dir, name, cpk, size] : items) {
        CfgEntry child;
        child.name = "CPK_ITEM_0";
        child.crc32 = 0;

        // variable[0] = directory (String)
        child.variables.push_back(CfgVariable{
            .type = CfgVarType::String,
            .value = dir,
            .name = "directory",
        });

        // variable[1] = filename (String)
        child.variables.push_back(CfgVariable{
            .type = CfgVarType::String,
            .value = name,
            .name = "filename",
        });

        // variable[2] = pack_dir (String)
        child.variables.push_back(CfgVariable{
            .type = CfgVarType::String,
            .value = std::string("data/packs/"),
            .name = "pack_dir",
        });

        // variable[3] = cpk_hash (String)
        child.variables.push_back(CfgVariable{
            .type = CfgVarType::String,
            .value = cpk,
            .name = "cpk_hash",
        });

        // variable[4] = size (Int)
        child.variables.push_back(CfgVariable{
            .type = CfgVarType::Int,
            .value = size,
            .name = "size",
        });

        root.children.push_back(std::move(child));
    }

    cfg.entries.push_back(std::move(root));

    return cfgbin_write(cfg);
}

/// Donnees de test communes
static const std::vector<std::tuple<std::string, std::string, std::string, int32_t>>
    TEST_ITEMS = {
        {"data/common/chr/_uniform/u11020029/", "u11020029.g4md",
         "e832856918ebb97cb4430f715e6bd525.cpk", 1024},
        {"data/common/chr/_uniform/u11020029/", "u11020029.g4tx",
         "e832856918ebb97cb4430f715e6bd525.cpk", 2048},
        {"data/common/map/town01/", "town01.g4mg",
         "abcdef1234567890abcdef1234567890.cpk", 4096},
        {"data/common/script/lua/menu/", "main_menu.lua.bin",
         "1111111111111111111111111111111.cpk", 512},
        {"data/common/sound/bgm/", "bgm_title.acb",
         "abcdef1234567890abcdef1234567890.cpk", 8192},
};

// ── Tests init_from_data ────────────────────────────────────────

TEST(Vfs, InitFromDataSucceeds) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty()) << "cfgbin_write doit generer des donnees valides";

    Vfs vfs;
    EXPECT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));
}

TEST(Vfs, InitFromEmptyDataFails) {
    Vfs vfs;
    std::vector<uint8_t> empty;
    EXPECT_FALSE(vfs.init_from_data(std::span<const uint8_t>(empty)));
}

// ── Tests asset_count / cpk_count ───────────────────────────────

TEST(Vfs, AssetCountMatchesEntries) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    EXPECT_EQ(vfs.asset_count(), TEST_ITEMS.size());
}

TEST(Vfs, CpkCountCountsUniques) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    // TEST_ITEMS contient 3 CPK uniques
    EXPECT_EQ(vfs.cpk_count(), 3u);
}

// ── Tests find ──────────────────────────────────────────────────

TEST(Vfs, FindByFullPath) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    auto entry = vfs.find("data/common/chr/_uniform/u11020029/u11020029.g4md");
    ASSERT_TRUE(entry.has_value());
    EXPECT_EQ(entry->cpk_filename, "e832856918ebb97cb4430f715e6bd525.cpk");
    EXPECT_EQ(entry->file_size, 1024u);
}

TEST(Vfs, FindByDirectoryAndFilename) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    auto entry = vfs.find("data/common/map/town01/", "town01.g4mg");
    ASSERT_TRUE(entry.has_value());
    EXPECT_EQ(entry->cpk_filename, "abcdef1234567890abcdef1234567890.cpk");
    EXPECT_EQ(entry->file_size, 4096u);
}

TEST(Vfs, FindNonExistentReturnsNullopt) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    auto entry = vfs.find("data/nonexistent/path/file.bin");
    EXPECT_FALSE(entry.has_value());
}

// ── Tests list ──────────────────────────────────────────────────

TEST(Vfs, ListAllAssets) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    auto all = vfs.list("*");
    EXPECT_EQ(all.size(), TEST_ITEMS.size());
}

TEST(Vfs, ListWithGlobPattern) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    // Filtrer par extension g4tx
    auto g4tx = vfs.list("*.g4tx");
    EXPECT_EQ(g4tx.size(), 1u);
    if (!g4tx.empty()) {
        EXPECT_TRUE(g4tx[0].internal_path.ends_with(".g4tx"));
    }

    // Filtrer par repertoire
    auto chr = vfs.list("data/common/chr/*");
    EXPECT_EQ(chr.size(), 2u); // g4md + g4tx dans le meme repertoire
}

TEST(Vfs, ListReturnsSorted) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    auto all = vfs.list("*");
    for (size_t i = 1; i < all.size(); ++i) {
        EXPECT_LE(all[i - 1].internal_path, all[i].internal_path)
            << "Les resultats doivent etre tries par chemin";
    }
}

// ── Tests cpk_list ──────────────────────────────────────────────

TEST(Vfs, CpkListReturnsSortedUniques) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    auto cpks = vfs.cpk_list();
    EXPECT_EQ(cpks.size(), 3u);

    // Verifie le tri
    for (size_t i = 1; i < cpks.size(); ++i) {
        EXPECT_LT(cpks[i - 1], cpks[i]);
    }
}

// ── Tests shutdown ──────────────────────────────────────────────

TEST(Vfs, ShutdownClearsCache) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    vfs.shutdown();
    // Apres shutdown, le VFS est toujours utilisable pour les lookups
    // (seul le cache CPK est vide)
    EXPECT_EQ(vfs.asset_count(), TEST_ITEMS.size());
}

// ── Tests edge cases ────────────────────────────────────────────

TEST(Vfs, SingleEntry) {
    auto data = make_mock_cpk_list({
        {"data/test/", "file.bin", "single.cpk", 100},
    });
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    EXPECT_EQ(vfs.asset_count(), 1u);
    EXPECT_EQ(vfs.cpk_count(), 1u);

    auto entry = vfs.find("data/test/file.bin");
    ASSERT_TRUE(entry.has_value());
    EXPECT_EQ(entry->file_size, 100u);
}

TEST(Vfs, MultipleFilesInSameCpk) {
    auto data = make_mock_cpk_list({
        {"data/a/", "file1.bin", "same.cpk", 100},
        {"data/b/", "file2.bin", "same.cpk", 200},
        {"data/c/", "file3.bin", "same.cpk", 300},
    });
    ASSERT_FALSE(data.empty());

    Vfs vfs;
    ASSERT_TRUE(vfs.init_from_data(std::span<const uint8_t>(data)));

    EXPECT_EQ(vfs.asset_count(), 3u);
    EXPECT_EQ(vfs.cpk_count(), 1u); // Tous dans le meme CPK
}

TEST(Vfs, MoveConstructor) {
    auto data = make_mock_cpk_list(TEST_ITEMS);
    ASSERT_FALSE(data.empty());

    Vfs vfs1;
    ASSERT_TRUE(vfs1.init_from_data(std::span<const uint8_t>(data)));

    Vfs vfs2 = std::move(vfs1);
    EXPECT_EQ(vfs2.asset_count(), TEST_ITEMS.size());
}
