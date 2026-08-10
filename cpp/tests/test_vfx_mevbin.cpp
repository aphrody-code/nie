/// @file test_vfx_mevbin.cpp
/// Tests pour vfx_inspector et mevbin_parser.

#include "iecode/formats/level5/vfx_inspector.h"
#include "iecode/formats/level5/mevbin_parser.h"

#include <gtest/gtest.h>
#include <array>
#include <cstring>

using namespace iecode::level5;

// ── VFX inspector ────────────────────────────────────────────────────

TEST(VfxTest, EmptyData) {
    std::vector<uint8_t> data;
    auto r = vfx_inspect(data);
    EXPECT_EQ(r.format_type, VfxFormatType::Unknown);
    EXPECT_FALSE(r.has_known_magic);
    EXPECT_EQ(r.file_size, 0u);
}

TEST(VfxTest, TooSmall) {
    std::array<uint8_t, 3> data = {0xAA, 0xBB, 0xCC};
    auto r = vfx_inspect(data);
    EXPECT_EQ(r.format_type, VfxFormatType::Unknown);
    EXPECT_FALSE(r.has_known_magic);
    EXPECT_FALSE(r.hex_header.empty());
}

TEST(VfxTest, KnownVfxoMagic) {
    // "VFXO" LE = 0x4F584656
    std::array<uint8_t, 12> data = {
        0x56, 0x46, 0x58, 0x4F,  // "VFXO"
        0x01, 0x00, 0x00, 0x00,  // version = 1
        0x0A, 0x00, 0x00, 0x00   // count = 10
    };
    auto r = vfx_inspect(data);
    EXPECT_EQ(r.format_type, VfxFormatType::Vfxo);
    EXPECT_EQ(r.format_name, "VFXO");
    EXPECT_TRUE(r.has_known_magic);
    EXPECT_EQ(r.version, 1u);
    EXPECT_EQ(r.item_count, 10u);
}

TEST(VfxTest, KnownPfxoMagic) {
    // "PFXO" LE = 0x4F584650
    std::array<uint8_t, 12> data = {
        0x50, 0x46, 0x58, 0x4F,
        0x02, 0x00, 0x00, 0x00,
        0x05, 0x00, 0x00, 0x00
    };
    auto r = vfx_inspect(data);
    EXPECT_EQ(r.format_type, VfxFormatType::Pfxo);
    EXPECT_TRUE(r.has_known_magic);
}

TEST(VfxTest, UnknownMagic) {
    std::array<uint8_t, 12> data = {
        0xDE, 0xAD, 0xBE, 0xEF,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
    };
    auto r = vfx_inspect(data);
    EXPECT_EQ(r.format_type, VfxFormatType::Unknown);
    EXPECT_FALSE(r.has_known_magic);
    EXPECT_EQ(r.format_name, "unknown");
}

// ── MEVBIN parser ─────────────────────────────────────────────────────

TEST(MevbinTest, TooSmall) {
    std::array<uint8_t, 15> data{};
    auto r = mevbin_parse(data);
    EXPECT_FALSE(r.has_value());
}

TEST(MevbinTest, ZeroEventsValid) {
    // Header: magic(4) + version(4) + count=0(4) + duration(4)
    std::array<uint8_t, 16> data = {
        0x4D, 0x45, 0x56, 0x42,  // "MEVB"
        0x01, 0x00, 0x00, 0x00,  // version = 1
        0x00, 0x00, 0x00, 0x00,  // count = 0
        0x00, 0x00, 0xF0, 0x41   // duration = 30.0f
    };
    auto r = mevbin_parse(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->version, 1u);
    EXPECT_EQ(r->events.size(), 0u);
    EXPECT_FALSE(r->is_speculative);
    EXPECT_NEAR(r->duration, 30.0f, 0.001f);
}

TEST(MevbinTest, SingleEvent) {
    std::vector<uint8_t> data(16 + 16, 0);
    // Header
    data[0] = 0x4D; data[1] = 0x45; data[2] = 0x56; data[3] = 0x42; // "MEVB"
    data[8] = 0x01; // count = 1
    // Event at offset 16: time=0.5f, type=1(Sound), param1=0xABCD, param2=0
    float t = 0.5f;
    std::memcpy(&data[16], &t, 4);
    data[20] = 0x01; // type = Sound
    data[24] = 0xCD; data[25] = 0xAB; // param1 = 0xABCD
    auto r = mevbin_parse(data);
    ASSERT_TRUE(r.has_value());
    ASSERT_EQ(r->events.size(), 1u);
    EXPECT_NEAR(r->events[0].time, 0.5f, 0.001f);
    EXPECT_EQ(r->events[0].type, MevEventType::Sound);
    EXPECT_EQ(r->events[0].param1, 0xABCDu);
}

TEST(MevbinTest, BoundsOverflow) {
    // Claim 1M events but only 16 bytes
    std::array<uint8_t, 16> data = {
        0x4D, 0x45, 0x56, 0x42,
        0x01, 0x00, 0x00, 0x00,
        0x40, 0x42, 0x0F, 0x00,  // count = 1,000,000
        0x00, 0x00, 0x00, 0x00
    };
    auto r = mevbin_parse(data);
    EXPECT_FALSE(r.has_value());
}

TEST(MevbinTest, UnknownMagicSpeculative) {
    std::array<uint8_t, 16> data = {
        0xAA, 0xBB, 0xCC, 0xDD,  // unknown magic
        0x01, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
    };
    auto r = mevbin_parse(data);
    ASSERT_TRUE(r.has_value());
    EXPECT_TRUE(r->is_speculative);
}
