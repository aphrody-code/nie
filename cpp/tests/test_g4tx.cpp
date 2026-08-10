#include <gtest/gtest.h>
#include "iecode/formats/level5/g4tx.h"

using namespace iecode::level5;

// ── Helper : construire un G4TX minimal valide ──────────────────────

static std::vector<uint8_t> make_minimal_g4tx() {
    // G4TX avec 0 textures (header valide mais vide)
    std::vector<uint8_t> data(0x60, 0);

    // Magic "G4TX" (0x58543447 LE)
    data[0] = 0x47; data[1] = 0x34; data[2] = 0x54; data[3] = 0x58;

    // Header size = 0x60
    data[4] = 0x60; data[5] = 0x00;

    // Texture count = 0
    data[0x20] = 0; data[0x21] = 0;

    // Total count = 0
    data[0x22] = 0; data[0x23] = 0;

    return data;
}

// ── Tests ───────────────────────────────────────────────────────────

TEST(G4tx, ParseEmpty) {
    EXPECT_FALSE(g4tx_parse({}).has_value());
}

TEST(G4tx, ParseTooShort) {
    const uint8_t tiny[] = {0x47, 0x34, 0x54, 0x58};
    EXPECT_FALSE(g4tx_parse(tiny).has_value());
}

TEST(G4tx, InvalidMagic) {
    std::vector<uint8_t> data(0x60, 0);
    data[0] = 0xFF; data[1] = 0xFF; data[2] = 0xFF; data[3] = 0xFF;
    EXPECT_FALSE(g4tx_parse(data).has_value());
}

TEST(G4tx, ParseZeroTextures) {
    auto data = make_minimal_g4tx();
    auto result = g4tx_parse(data);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->textures.size(), 0u);
}

TEST(G4tx, FormatEnum) {
    EXPECT_EQ(static_cast<uint32_t>(G4txFormat::BC1), 0x01u);
    EXPECT_EQ(static_cast<uint32_t>(G4txFormat::BC7), 0x07u);
    EXPECT_EQ(static_cast<uint32_t>(G4txFormat::RGBA8), 0x1Fu);
}

TEST(G4tx, SubTextureDefaults) {
    G4txSubTexture sub;
    EXPECT_EQ(sub.entry_id, 0);
    EXPECT_EQ(sub.x, 0);
    EXPECT_EQ(sub.y, 0);
    EXPECT_EQ(sub.width, 0);
    EXPECT_EQ(sub.height, 0);
}

TEST(G4tx, TextureDefaults) {
    G4txTexture tex;
    EXPECT_EQ(tex.width, 0);
    EXPECT_EQ(tex.height, 0);
    EXPECT_EQ(tex.format, G4txFormat::Unknown);
    EXPECT_EQ(tex.mip_count, 1);
    EXPECT_FALSE(tex.is_dds);
    EXPECT_TRUE(tex.data.empty());
    EXPECT_TRUE(tex.sub_textures.empty());
}
