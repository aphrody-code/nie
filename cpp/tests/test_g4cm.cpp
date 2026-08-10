#include <gtest/gtest.h>

#include "iecode/formats/level5/g4cm.h"
#include "iecode/formats/level5/g4md.h"
#include "iecode/types.h"

#include <array>
#include <cstring>
#include <vector>

using iecode::level5::g4cm_parse;
using iecode::level5::g4cm_extract_entry;
using iecode::level5::G4cmEntry;

// ══════════════════════════════════════════════════════════════════════
//  Tests G4CM
// ══════════════════════════════════════════════════════════════════════

/// Donnees trop courtes -> parsing echoue.
TEST(G4cmTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 8> tiny = {};
    EXPECT_FALSE(g4cm_parse(tiny).has_value());
}

/// Magic invalide -> parsing echoue.
TEST(G4cmTest, InvalidMagicReturnsNullopt) {
    std::vector<uint8_t> data(64, 0);
    EXPECT_FALSE(g4cm_parse(data).has_value());
}

/// Magic correct "G4CM" en little-endian avec 0 entrees -> conteneur vide valide.
TEST(G4cmTest, EmptyContainerIsValid) {
    std::vector<uint8_t> data(64, 0);

    // Magic "G4CM" en little-endian : 0x47 0x34 0x43 0x4D
    data[0] = 0x47;
    data[1] = 0x34;
    data[2] = 0x43;
    data[3] = 0x4D;

    // header_size = 0x20 (32)
    data[4] = 0x20;
    data[5] = 0x00;

    // entry_count a offset 0x0C = 0
    // (deja zero)

    auto parsed = g4cm_parse(data);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->entries.size(), 0u);
}

/// Nombre d'entrees excessif -> rejet.
TEST(G4cmTest, ExcessiveEntryCountRejected) {
    std::vector<uint8_t> data(64, 0);

    // Magic G4CM LE
    data[0] = 0x47;
    data[1] = 0x34;
    data[2] = 0x43;
    data[3] = 0x4D;

    // header_size
    data[4] = 0x20;
    data[5] = 0x00;

    // entry_count = 0xFFFF (> 1024 limite)
    data[0x0C] = 0xFF;
    data[0x0D] = 0xFF;
    data[0x0E] = 0x00;
    data[0x0F] = 0x00;

    EXPECT_FALSE(g4cm_parse(data).has_value());
}

/// Table d'entrees hors limites -> rejet.
TEST(G4cmTest, EntryTableOutOfBoundsRejected) {
    std::vector<uint8_t> data(48, 0);

    // Magic G4CM LE
    data[0] = 0x47;
    data[1] = 0x34;
    data[2] = 0x43;
    data[3] = 0x4D;

    // header_size = 0x20
    data[4] = 0x20;
    data[5] = 0x00;

    // entry_count = 10 (requiert 10*16 = 160 octets apres header, mais fichier = 48)
    data[0x0C] = 0x0A;
    data[0x0D] = 0x00;
    data[0x0E] = 0x00;
    data[0x0F] = 0x00;

    EXPECT_FALSE(g4cm_parse(data).has_value());
}

/// g4cm_extract_entry retourne un span vide pour une entree hors limites.
TEST(G4cmTest, ExtractEntryOutOfBoundsReturnsEmpty) {
    std::vector<uint8_t> container(128, 0xAA);

    G4cmEntry entry;
    entry.name = "test.g4mg";
    entry.type = "g4mg";
    entry.offset = 200;
    entry.size = 32;

    auto result = g4cm_extract_entry(container, entry);
    EXPECT_TRUE(result.empty());
}

/// g4cm_extract_entry retourne les bonnes donnees pour une entree valide.
TEST(G4cmTest, ExtractEntryValidReturnsCorrectData) {
    std::vector<uint8_t> container(256, 0);
    for (size_t i = 0; i < 16; ++i) {
        container[64 + i] = static_cast<uint8_t>(0xCA + i);
    }

    G4cmEntry entry;
    entry.name = "pattern.g4tx";
    entry.type = "g4tx";
    entry.offset = 64;
    entry.size = 16;

    auto result = g4cm_extract_entry(container, entry);
    ASSERT_EQ(result.size(), 16u);
    EXPECT_EQ(result[0], 0xCA);
    EXPECT_EQ(result[1], 0xCB);
}

/// g4cm_extract_entry avec taille 0 retourne un span vide.
TEST(G4cmTest, ExtractEntryZeroSizeReturnsEmpty) {
    std::vector<uint8_t> container(128, 0);

    G4cmEntry entry;
    entry.name = "empty.bin";
    entry.type = "unknown";
    entry.offset = 32;
    entry.size = 0;

    auto result = g4cm_extract_entry(container, entry);
    EXPECT_TRUE(result.empty());
}

// ══════════════════════════════════════════════════════════════════════
//  Tests G4MD export (parsing valide / invalide)
// ══════════════════════════════════════════════════════════════════════

using iecode::level5::g4md_parse;

/// G4MD : donnees trop courtes -> nullopt.
TEST(G4mdExportTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 16> tiny = {};
    EXPECT_FALSE(g4md_parse(tiny).has_value());
}

/// G4MD : magic invalide -> nullopt.
TEST(G4mdExportTest, InvalidMagicReturnsNullopt) {
    std::vector<uint8_t> data(0xA0, 0);
    EXPECT_FALSE(g4md_parse(data).has_value());
}

/// G4MD : magic "G4MD" LE valide avec 0 submeshes, 0 bones.
/// Header complet de 0xA0 octets requis depuis le reverse FUN_1404d8430.
TEST(G4mdExportTest, ValidMagicZeroCountsSucceeds) {
    std::vector<uint8_t> data(0xA0, 0);

    // Magic "G4MD" en little-endian : 0x47 0x34 0x4D 0x44
    data[0] = 0x47;
    data[1] = 0x34;
    data[2] = 0x4D;
    data[3] = 0x44;
    // header_size = 0xA0 @ 0x04
    data[0x04] = 0xA0;
    data[0x05] = 0x00;
    // version = 1 @ 0x06 (< 0x69)
    data[0x06] = 0x01;
    // endian_flag = 0 (LE) @ 0x09 — deja zero
    // submesh_count = 0 @ 0x20 — deja zero
    // bone_count = 0 @ 0x22 — deja zero

    auto parsed = g4md_parse(data);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->submeshes.size(), 0u);
    EXPECT_EQ(parsed->bone_refs.size(), 0u);
    EXPECT_EQ(parsed->header.header_size, 0xA0u);
    EXPECT_FALSE(parsed->header.is_big_endian);
}

/// G4MD : un submesh avec stride 0x50 lu aux offsets reels.
TEST(G4mdExportTest, ParsesSingleSubmeshStride50) {
    // Header + 1 submesh = 0xA0 + 0x50 = 0xF0 octets.
    std::vector<uint8_t> data(0xF0, 0);

    // Magic
    data[0] = 0x47; data[1] = 0x34; data[2] = 0x4D; data[3] = 0x44;
    // header_size = 0xA0
    data[0x04] = 0xA0; data[0x05] = 0x00;
    // version = 1
    data[0x06] = 0x01;
    // submesh_count = 1 @ 0x20
    data[0x20] = 0x01; data[0x21] = 0x00;
    // total_vertex_count = 100 @ 0x50
    data[0x50] = 100; data[0x51] = 0;
    // total_index_count = 300 @ 0x54
    data[0x54] = 0x2C; data[0x55] = 0x01;
    // vertex_buffer_size = 1600 @ 0x58 (100 * 16 stride)
    data[0x58] = 0x40; data[0x59] = 0x06;
    // index_buffer_size = 600 @ 0x5C
    data[0x5C] = 0x58; data[0x5D] = 0x02;
    // submesh_table_off @ 0x60 : resolution = (off + base_shift) * 4 = 0xA0
    //   donc off=0x28, base_shift=0 -> 0x28 * 4 = 0xA0 (juste apres header)
    data[0x60] = 0x28; data[0x61] = 0x00;

    // Submesh[0] @ 0xA0, stride 0x50
    const size_t sm = 0xA0;
    // vertex_count = 50 @ sm+0x30
    data[sm + 0x30] = 50;
    // index_count = 150 @ sm+0x34
    data[sm + 0x34] = 150;
    // primitive_type = 6 (tri list) @ sm+0x38
    data[sm + 0x38] = 6;
    // index_offset = 0 @ sm+0x3C (deja zero)
    // material_id = 3 @ sm+0x42
    data[sm + 0x42] = 3;

    auto parsed = g4md_parse(data);
    ASSERT_TRUE(parsed.has_value());
    ASSERT_EQ(parsed->submeshes.size(), 1u);
    EXPECT_EQ(parsed->submeshes[0].vertex_count, 50);
    EXPECT_EQ(parsed->submeshes[0].index_count, 150);
    EXPECT_EQ(parsed->submeshes[0].primitive_type, 6u);
    EXPECT_EQ(parsed->submeshes[0].material_index, 3);
    EXPECT_EQ(parsed->header.total_vertex_count, 100u);
    EXPECT_EQ(parsed->header.total_index_count, 300u);
    EXPECT_EQ(parsed->header.vertex_buffer_size, 1600u);
    EXPECT_EQ(parsed->header.index_buffer_size, 600u);
}
