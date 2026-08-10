#include <gtest/gtest.h>

#include "iecode/formats/criware/awb_reader.h"
#include "iecode/formats/criware/acb_reader.h"
#include "iecode/types.h"

#include <array>
#include <cstring>
#include <vector>

using iecode::criware::awb_parse;
using iecode::criware::awb_extract_entry;
using iecode::criware::acb_parse;
using iecode::criware::acb_extract_awb;

// ══════════════════════════════════════════════════════════════════════
//  Tests AWB (AFS2)
// ══════════════════════════════════════════════════════════════════════

/// Donnees trop courtes -> parsing echoue.
TEST(AwbTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 8> tiny = {};
    EXPECT_FALSE(awb_parse(tiny).has_value());
}

/// Magic invalide -> parsing echoue.
TEST(AwbTest, InvalidMagicReturnsNullopt) {
    std::vector<uint8_t> data(64, 0);
    EXPECT_FALSE(awb_parse(data).has_value());
}

/// Construction d'un AWB minimal valide avec 1 entree.
TEST(AwbTest, MinimalValidAwb) {
    // Header AFS2 : 0x10 octets
    // cue_ids : 1 x uint16 = 2 octets
    // offsets : 2 x uint32 = 8 octets
    // data : 4 octets ("HCA\0")
    // Total minimum : 0x10 + 2 + 8 + 4 = 30, mais aligne a block_size
    const uint32_t block_size = 0x20;
    const size_t header_size = 0x10; // AFS2 header
    const size_t cue_ids_size = 2;   // 1 entry x uint16
    const size_t offsets_size = 8;   // 2 entries (entry+1) x uint32
    const size_t metadata_end = header_size + cue_ids_size + offsets_size;
    // Aligner au block_size
    const size_t data_start = ((metadata_end + block_size - 1) / block_size) * block_size;
    const size_t audio_size = 4; // "HCA\0"
    const size_t total_size = data_start + audio_size;

    std::vector<uint8_t> awb(total_size, 0);

    // Magic "AFS2"
    awb[0] = 'A'; awb[1] = 'F'; awb[2] = 'S'; awb[3] = '2';
    // version = 1
    awb[4] = 0x01;
    // offset_size = 4 (uint32)
    awb[5] = 0x04;
    // entry_count = 1
    iecode::write_u16_le(awb.data() + 6, 1);
    // block_size = 0x20
    iecode::write_u32_le(awb.data() + 8, block_size);
    // key = 0
    iecode::write_u32_le(awb.data() + 0x0C, 0);

    // cue_ids[0] = 42
    iecode::write_u16_le(awb.data() + header_size, 42);

    // offsets[0] = data_start (sera aligne par le parser)
    iecode::write_u32_le(awb.data() + header_size + cue_ids_size,
                          static_cast<uint32_t>(data_start));
    // offsets[1] = data_start + audio_size (fin)
    iecode::write_u32_le(awb.data() + header_size + cue_ids_size + 4,
                          static_cast<uint32_t>(data_start + audio_size));

    // Audio data : "HCA\0"
    awb[data_start] = 'H';
    awb[data_start + 1] = 'C';
    awb[data_start + 2] = 'A';
    awb[data_start + 3] = '\0';

    auto parsed = awb_parse(awb);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->version, 1u);
    EXPECT_EQ(parsed->block_size, block_size);
    ASSERT_EQ(parsed->entries.size(), 1u);
    EXPECT_EQ(parsed->entries[0].cue_id, 42);
    EXPECT_EQ(parsed->entries[0].size, audio_size);

    // Extraction
    auto entry_data = awb_extract_entry(awb, parsed->entries[0]);
    ASSERT_EQ(entry_data.size(), audio_size);
    EXPECT_EQ(entry_data[0], 'H');
    EXPECT_EQ(entry_data[1], 'C');
    EXPECT_EQ(entry_data[2], 'A');
}

/// awb_extract_entry hors bornes retourne vide.
TEST(AwbTest, ExtractEntryOutOfBoundsReturnsEmpty) {
    std::vector<uint8_t> data(64, 0);

    iecode::criware::AwbEntry entry;
    entry.cue_id = 0;
    entry.offset = 100; // hors bornes
    entry.size = 10;

    auto result = awb_extract_entry(data, entry);
    EXPECT_TRUE(result.empty());
}

/// awb_extract_entry avec taille 0 retourne vide.
TEST(AwbTest, ExtractEntryZeroSizeReturnsEmpty) {
    std::vector<uint8_t> data(64, 0);

    iecode::criware::AwbEntry entry;
    entry.cue_id = 0;
    entry.offset = 0;
    entry.size = 0;

    auto result = awb_extract_entry(data, entry);
    EXPECT_TRUE(result.empty());
}

// ══════════════════════════════════════════════════════════════════════
//  Tests ACB
// ══════════════════════════════════════════════════════════════════════

/// Donnees trop courtes -> parsing echoue.
TEST(AcbTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 8> tiny = {};
    EXPECT_FALSE(acb_parse(tiny).has_value());
}

/// Magic invalide -> parsing echoue.
TEST(AcbTest, InvalidMagicReturnsNullopt) {
    std::vector<uint8_t> data(64, 0xAA);
    EXPECT_FALSE(acb_parse(data).has_value());
}

/// acb_extract_awb sur donnees invalides retourne vide.
TEST(AcbTest, ExtractAwbInvalidReturnsEmpty) {
    std::vector<uint8_t> data(64, 0);
    auto result = acb_extract_awb(data);
    EXPECT_TRUE(result.empty());
}
