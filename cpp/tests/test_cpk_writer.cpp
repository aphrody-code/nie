/// @file test_cpk_writer.cpp
/// Tests pour le CPK writer/patcher et les fonctions FFI associees.

#include <gtest/gtest.h>

#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/formats/criware/cpk_writer.h"

#include <cstring>
#include <filesystem>
#include <vector>

namespace fs = std::filesystem;

/// Construit des donnees de test simples.
static std::vector<uint8_t> make_test_data(const std::string& content) {
    return {content.begin(), content.end()};
}

// ── cpk_rebuild — roundtrip basique ─────────────────────────────────

TEST(CpkWriterTest, RebuildRoundtrip) {
    // Creer des entrees de test
    std::vector<iecode::criware::CpkWriteEntry> entries;

    auto data_a = make_test_data("Contenu du fichier A.");
    auto data_b = make_test_data("Fichier B — donnees de test plus longues pour le padding.");

    entries.push_back({
        .filename  = "file_a.txt",
        .directory = "test_dir",
        .data      = data_a,
        .compress  = false
    });
    entries.push_back({
        .filename  = "file_b.bin",
        .directory = "",
        .data      = data_b,
        .compress  = false
    });

    // Ecrire le CPK
    auto output = fs::temp_directory_path() / "test_rebuild.cpk";
    ASSERT_TRUE(iecode::criware::cpk_rebuild(entries, output));
    ASSERT_TRUE(fs::exists(output));
    EXPECT_GT(fs::file_size(output), 0u);

    // Relire avec le CpkReader
    iecode::criware::CpkReader reader;
    ASSERT_TRUE(reader.open(output));
    EXPECT_EQ(reader.count(), 2u);

    // Verifier que les fichiers sont presents
    const auto& list = reader.list();
    ASSERT_EQ(list.size(), 2u);

    // Verifier le contenu extrait
    auto extracted_a = reader.extract(list[0]);
    EXPECT_EQ(extracted_a, data_a);

    auto extracted_b = reader.extract(list[1]);
    EXPECT_EQ(extracted_b, data_b);

    // Nettoyage
    std::error_code ec;
    fs::remove(output, ec);
}

// ── cpk_rebuild — fichier vide refuse ───────────────────────────────

TEST(CpkWriterTest, RebuildEmptyEntries) {
    std::vector<iecode::criware::CpkWriteEntry> empty;
    auto output = fs::temp_directory_path() / "test_empty.cpk";
    EXPECT_FALSE(iecode::criware::cpk_rebuild(empty, output));
}

// ── cpk_patch_file — patch in-place ────────────────────────────────

TEST(CpkWriterTest, PatchInPlace) {
    // D'abord creer un CPK avec un fichier assez grand
    auto original_data = make_test_data("ORIGINAL_CONTENT_PADDING_XXXXXXXXXXXXX");
    auto new_data      = make_test_data("PATCHED_DATA_SHORT");

    std::vector<iecode::criware::CpkWriteEntry> entries;
    entries.push_back({
        .filename  = "patchable.txt",
        .directory = "data",
        .data      = original_data,
        .compress  = false
    });

    auto cpk_path = fs::temp_directory_path() / "test_patch.cpk";
    ASSERT_TRUE(iecode::criware::cpk_rebuild(entries, cpk_path));

    // Patcher le fichier (nouveau contenu plus petit)
    auto new_span = std::span<const uint8_t>(new_data);
    ASSERT_TRUE(iecode::criware::cpk_patch_file(
        cpk_path, "data/patchable.txt", new_span));

    // Nettoyage
    std::error_code ec;
    fs::remove(cpk_path, ec);
}

// ── cpk_patch_file — fichier inexistant refuse ─────────────────────

TEST(CpkWriterTest, PatchNonExistentFile) {
    // Creer un CPK minimal
    std::vector<iecode::criware::CpkWriteEntry> entries;
    entries.push_back({
        .filename = "exists.txt",
        .directory = "",
        .data = make_test_data("data"),
        .compress = false
    });

    auto cpk_path = fs::temp_directory_path() / "test_patch_noexist.cpk";
    ASSERT_TRUE(iecode::criware::cpk_rebuild(entries, cpk_path));

    auto new_data = make_test_data("x");
    EXPECT_FALSE(iecode::criware::cpk_patch_file(
        cpk_path, "does_not_exist.txt",
        std::span<const uint8_t>(new_data)));

    std::error_code ec;
    fs::remove(cpk_path, ec);
}

// ── cpk_patch_file — nouveau trop grand refuse ─────────────────────

TEST(CpkWriterTest, PatchTooLargeRefused) {
    auto small_data = make_test_data("AB");
    std::vector<iecode::criware::CpkWriteEntry> entries;
    entries.push_back({
        .filename = "small.txt",
        .directory = "",
        .data = small_data,
        .compress = false
    });

    auto cpk_path = fs::temp_directory_path() / "test_patch_toolarge.cpk";
    ASSERT_TRUE(iecode::criware::cpk_rebuild(entries, cpk_path));

    // Tenter de patcher avec des donnees beaucoup plus grandes
    auto big_data = make_test_data(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ_THIS_IS_MUCH_LARGER_THAN_THE_ORIGINAL_CONTENT");
    EXPECT_FALSE(iecode::criware::cpk_patch_file(
        cpk_path, "small.txt",
        std::span<const uint8_t>(big_data)));

    std::error_code ec;
    fs::remove(cpk_path, ec);
}
