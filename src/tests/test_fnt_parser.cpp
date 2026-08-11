#include <gtest/gtest.h>

#include "iecode/formats/level5/fnt_parser.h"

#include <array>
#include <cstring>
#include <vector>

using namespace iecode::level5;

// ── Helpers pour construire des donnees de test ─────────────────────

namespace {

/// Ecrit un uint32_t en little-endian dans un buffer.
void write_u32_le(std::vector<uint8_t>& buf, uint32_t val) {
    buf.push_back(static_cast<uint8_t>(val & 0xFF));
    buf.push_back(static_cast<uint8_t>((val >> 8) & 0xFF));
    buf.push_back(static_cast<uint8_t>((val >> 16) & 0xFF));
    buf.push_back(static_cast<uint8_t>((val >> 24) & 0xFF));
}

/// Ecrit un uint16_t en little-endian dans un buffer.
void write_u16_le(std::vector<uint8_t>& buf, uint16_t val) {
    buf.push_back(static_cast<uint8_t>(val & 0xFF));
    buf.push_back(static_cast<uint8_t>((val >> 8) & 0xFF));
}

/// Construit un fichier FNT00 minimal avec 2 glyphes et des donnees de texture.
std::vector<uint8_t> make_fnt00_data() {
    std::vector<uint8_t> data;

    // Header (0x18 octets)
    write_u32_le(data, 0x30544E46u); // magic "FNT0"
    write_u32_le(data, 0);           // file_size_or_flags
    write_u32_le(data, 2);           // glyph_count = 2
    write_u16_le(data, 128);         // texture_width
    write_u16_le(data, 128);         // texture_height
    write_u16_le(data, 16);          // line_height
    write_u16_le(data, 12);          // base_height
    write_u32_le(data, 20);          // glyph_section_size = 2 * 10 = 20

    // Glyphe 0 : 'A' (0x41), pos (10, 20), taille 8x12, offset (1, -2), advance 9
    write_u16_le(data, 0x0041); // char_code
    data.push_back(10);          // x
    data.push_back(20);          // y
    data.push_back(8);           // width
    data.push_back(12);          // height
    data.push_back(1);           // offset_x (int8_t)
    data.push_back(static_cast<uint8_t>(static_cast<int8_t>(-2))); // offset_y
    data.push_back(9);           // advance
    data.push_back(0);           // padding

    // Glyphe 1 : 'B' (0x42), pos (30, 20), taille 7x11, offset (0, 0), advance 8
    write_u16_le(data, 0x0042); // char_code
    data.push_back(30);          // x
    data.push_back(20);          // y
    data.push_back(7);           // width
    data.push_back(11);          // height
    data.push_back(0);           // offset_x
    data.push_back(0);           // offset_y
    data.push_back(8);           // advance
    data.push_back(0);           // padding

    // Donnees de texture factices (4 octets)
    data.push_back(0xFF);
    data.push_back(0x00);
    data.push_back(0xAA);
    data.push_back(0x55);

    return data;
}

/// Construit un fichier FNT01 minimal avec 1 glyphe.
std::vector<uint8_t> make_fnt01_data() {
    std::vector<uint8_t> data;

    // Header (0x18 octets)
    write_u32_le(data, 0x31544E46u); // magic "FNT1"
    write_u32_le(data, 0);           // file_size_or_flags
    write_u32_le(data, 1);           // glyph_count = 1
    write_u16_le(data, 256);         // texture_width
    write_u16_le(data, 256);         // texture_height
    write_u16_le(data, 20);          // line_height
    write_u16_le(data, 16);          // base_height
    write_u32_le(data, 12);          // glyph_section_size = 1 * 12 = 12

    // Glyphe 0 : caractere 0x3042 (hiragana 'a'), pos (200, 100),
    //            taille 14x18, offset (2, -1), advance 16
    write_u16_le(data, 0x3042); // char_code
    write_u16_le(data, 200);     // x (16-bit)
    write_u16_le(data, 100);     // y (16-bit)
    data.push_back(14);          // width
    data.push_back(18);          // height
    data.push_back(2);           // offset_x
    data.push_back(static_cast<uint8_t>(static_cast<int8_t>(-1))); // offset_y
    data.push_back(16);          // advance
    data.push_back(0);           // padding

    // Pas de donnees de texture dans ce test

    return data;
}

} // namespace

// ── Tests fnt_is_valid ──────────────────────────────────────────────

TEST(FntParser, IsValidFNT0) {
    auto data = make_fnt00_data();
    EXPECT_TRUE(fnt_is_valid(data));
}

TEST(FntParser, IsValidFNT1) {
    auto data = make_fnt01_data();
    EXPECT_TRUE(fnt_is_valid(data));
}

TEST(FntParser, IsValidTooSmall) {
    std::vector<uint8_t> tiny = {0x46, 0x4E, 0x54};
    EXPECT_FALSE(fnt_is_valid(tiny));
}

TEST(FntParser, IsValidWrongMagic) {
    std::vector<uint8_t> bad = {0x00, 0x00, 0x00, 0x00};
    EXPECT_FALSE(fnt_is_valid(bad));
}

TEST(FntParser, IsValidEmptySpan) {
    std::span<const uint8_t> empty;
    EXPECT_FALSE(fnt_is_valid(empty));
}

// ── Tests fnt_parse FNT00 ──────────────────────────────────────────

TEST(FntParser, ParseFNT00_Header) {
    auto data = make_fnt00_data();
    auto result = fnt_parse(data);

    ASSERT_TRUE(result.has_value());

    const auto& hdr = result->header;
    EXPECT_EQ(hdr.magic, 0x30544E46u);
    EXPECT_EQ(hdr.version, 0u);
    EXPECT_EQ(hdr.glyph_count, 2u);
    EXPECT_EQ(hdr.texture_width, 128u);
    EXPECT_EQ(hdr.texture_height, 128u);
    EXPECT_EQ(hdr.line_height, 16u);
    EXPECT_EQ(hdr.base_height, 12u);
}

TEST(FntParser, ParseFNT00_Glyphs) {
    auto data = make_fnt00_data();
    auto result = fnt_parse(data);

    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->glyphs.size(), 2u);

    // Glyphe 'A'
    const auto& g0 = result->glyphs[0];
    EXPECT_EQ(g0.char_code, 0x0041u);
    EXPECT_EQ(g0.x, 10u);
    EXPECT_EQ(g0.y, 20u);
    EXPECT_EQ(g0.width, 8u);
    EXPECT_EQ(g0.height, 12u);
    EXPECT_EQ(g0.offset_x, 1);
    EXPECT_EQ(g0.offset_y, -2);
    EXPECT_EQ(g0.advance, 9u);

    // Glyphe 'B'
    const auto& g1 = result->glyphs[1];
    EXPECT_EQ(g1.char_code, 0x0042u);
    EXPECT_EQ(g1.x, 30u);
    EXPECT_EQ(g1.y, 20u);
    EXPECT_EQ(g1.width, 7u);
    EXPECT_EQ(g1.height, 11u);
    EXPECT_EQ(g1.offset_x, 0);
    EXPECT_EQ(g1.offset_y, 0);
    EXPECT_EQ(g1.advance, 8u);
}

TEST(FntParser, ParseFNT00_TextureData) {
    auto data = make_fnt00_data();
    auto result = fnt_parse(data);

    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->texture_data.size(), 4u);
    EXPECT_EQ(result->texture_data[0], 0xFFu);
    EXPECT_EQ(result->texture_data[1], 0x00u);
    EXPECT_EQ(result->texture_data[2], 0xAAu);
    EXPECT_EQ(result->texture_data[3], 0x55u);
}

// ── Tests fnt_parse FNT01 ──────────────────────────────────────────

TEST(FntParser, ParseFNT01_Header) {
    auto data = make_fnt01_data();
    auto result = fnt_parse(data);

    ASSERT_TRUE(result.has_value());

    const auto& hdr = result->header;
    EXPECT_EQ(hdr.magic, 0x31544E46u);
    EXPECT_EQ(hdr.version, 1u);
    EXPECT_EQ(hdr.glyph_count, 1u);
    EXPECT_EQ(hdr.texture_width, 256u);
    EXPECT_EQ(hdr.texture_height, 256u);
    EXPECT_EQ(hdr.line_height, 20u);
    EXPECT_EQ(hdr.base_height, 16u);
}

TEST(FntParser, ParseFNT01_Glyph) {
    auto data = make_fnt01_data();
    auto result = fnt_parse(data);

    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->glyphs.size(), 1u);

    const auto& g = result->glyphs[0];
    EXPECT_EQ(g.char_code, 0x3042u); // Hiragana 'a'
    // FNT01 stocke X/Y en 16-bit mais la struct tronque en uint8_t
    // 200 & 0xFF = 0xC8
    EXPECT_EQ(g.x, static_cast<uint8_t>(200 & 0xFF));
    EXPECT_EQ(g.y, static_cast<uint8_t>(100 & 0xFF));
    EXPECT_EQ(g.width, 14u);
    EXPECT_EQ(g.height, 18u);
    EXPECT_EQ(g.offset_x, 2);
    EXPECT_EQ(g.offset_y, -1);
    EXPECT_EQ(g.advance, 16u);
}

TEST(FntParser, ParseFNT01_NoTexture) {
    auto data = make_fnt01_data();
    auto result = fnt_parse(data);

    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->texture_data.empty());
}

// ── Tests fnt_version_string ────────────────────────────────────────

TEST(FntParser, VersionString) {
    FntHeader h0{.magic = 0x30544E46, .version = 0};
    EXPECT_EQ(fnt_version_string(h0), "FNT00");

    FntHeader h1{.magic = 0x31544E46, .version = 1};
    EXPECT_EQ(fnt_version_string(h1), "FNT01");
}

// ── Tests fnt_find_glyph ────────────────────────────────────────────

TEST(FntParser, FindGlyphFound) {
    auto data = make_fnt00_data();
    auto result = fnt_parse(data);
    ASSERT_TRUE(result.has_value());

    const auto* glyph = fnt_find_glyph(*result, 0x0041); // 'A'
    ASSERT_NE(glyph, nullptr);
    EXPECT_EQ(glyph->char_code, 0x0041u);
    EXPECT_EQ(glyph->width, 8u);
}

TEST(FntParser, FindGlyphNotFound) {
    auto data = make_fnt00_data();
    auto result = fnt_parse(data);
    ASSERT_TRUE(result.has_value());

    const auto* glyph = fnt_find_glyph(*result, 0x0043); // 'C' — pas dans la font
    EXPECT_EQ(glyph, nullptr);
}

// ── Tests cas limites ──────────────────────────────────────────────

TEST(FntParser, ParseTooSmall) {
    std::vector<uint8_t> tiny = {0x46, 0x4E, 0x54, 0x30};
    auto result = fnt_parse(tiny);
    EXPECT_FALSE(result.has_value());
}

TEST(FntParser, ParseWrongMagic) {
    auto data = make_fnt00_data();
    // Corrompre le magic
    data[0] = 0x00;
    data[1] = 0x00;
    auto result = fnt_parse(data);
    EXPECT_FALSE(result.has_value());
}

TEST(FntParser, ParseEmpty) {
    std::span<const uint8_t> empty;
    auto result = fnt_parse(empty);
    EXPECT_FALSE(result.has_value());
}

TEST(FntParser, ParseTruncatedGlyphs) {
    auto data = make_fnt00_data();
    // Tronquer les donnees avant la fin des glyphes
    // Header = 0x18 = 24 bytes, premier glyphe partiel = 5 octets de plus
    data.resize(24 + 5);
    auto result = fnt_parse(data);
    // Devrait echouer car la section glyphes depasse le fichier
    EXPECT_FALSE(result.has_value());
}

TEST(FntParser, ParseZeroGlyphs) {
    std::vector<uint8_t> data;

    // Header avec 0 glyphes
    write_u32_le(data, 0x30544E46u); // magic "FNT0"
    write_u32_le(data, 0);           // file_size_or_flags
    write_u32_le(data, 0);           // glyph_count = 0
    write_u16_le(data, 64);          // texture_width
    write_u16_le(data, 64);          // texture_height
    write_u16_le(data, 10);          // line_height
    write_u16_le(data, 8);           // base_height
    write_u32_le(data, 0);           // glyph_section_size = 0

    // Quelques donnees de texture
    data.push_back(0xAB);
    data.push_back(0xCD);

    auto result = fnt_parse(data);
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->glyphs.empty());
    EXPECT_EQ(result->texture_data.size(), 2u);
    EXPECT_EQ(result->header.glyph_count, 0u);
}
