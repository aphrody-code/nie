/// @file test_font_loader.cpp
/// Tests du FontLoader et du FontPreview.
/// Les tests D3D11 sont conditionnes par _WIN32 — les tests de structures
/// de donnees fonctionnent sur toutes les plateformes.

#include <gtest/gtest.h>

#ifdef _WIN32
#include "iecode/editor/font_loader.h"
#endif

#include "iecode/formats/level5/g4tx.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/engine/res/res_font.h"

// ── Tests FontGlyph (structure de donnees) ────────────────────────

TEST(FontLoaderTest, FontGlyphSize) {
    // La structure FontGlyph doit faire exactement 12 octets (aligne sur nie.exe)
    EXPECT_EQ(sizeof(lives::FontGlyph), 12u);
}

TEST(FontLoaderTest, FontGlyphDefaultConstruction) {
    lives::FontGlyph glyph;
    EXPECT_EQ(glyph.char_code_, 0);
    EXPECT_EQ(glyph.atlas_u_, 0);
    EXPECT_EQ(glyph.atlas_v_, 0);
    EXPECT_EQ(glyph.width_, 0);
    EXPECT_EQ(glyph.height_, 0);
    EXPECT_EQ(glyph.advance_, 0);
    EXPECT_EQ(glyph.flags_, 0);
}

TEST(FontLoaderTest, FontKerningSize) {
    EXPECT_EQ(sizeof(lives::FontKerning), 12u);
}

TEST(FontLoaderTest, FontKerningDefaultConstruction) {
    lives::FontKerning kern;
    EXPECT_EQ(kern.left_char_, 0u);
    EXPECT_EQ(kern.right_char_, 0u);
    EXPECT_EQ(kern.adjustment_, 0);
}

TEST(FontLoaderTest, FontPageDefaultConstruction) {
    lives::FontPage page;
    EXPECT_TRUE(page.glyphs_.empty());
    EXPECT_EQ(page.line_height_, 0);
    EXPECT_EQ(page.atlas_width_, 0);
    EXPECT_EQ(page.atlas_height_, 0);
}

TEST(FontLoaderTest, CResFontMaxPages) {
    // nie.exe supporte jusqu'a 4 pages d'atlas
    EXPECT_EQ(lives::CResFont::MAX_PAGES, 4u);
}

TEST(FontLoaderTest, CResFontDefaultConstruction) {
    lives::CResFont font;
    EXPECT_TRUE(font.kerning_.empty());
    EXPECT_TRUE(font.name_.empty());
    EXPECT_EQ(font.cell_width_, 0);
    EXPECT_EQ(font.cell_height_, 0);
    EXPECT_EQ(font.total_glyph_count_, 0u);
    EXPECT_EQ(font.page_count_, 0u);
}

// ── Tests GlyphInfo (structure interne FontLoader) ────────────────

#ifdef _WIN32

TEST(FontLoaderTest, GlyphInfoDefaultConstruction) {
    iecode::editor::FontLoader::GlyphInfo glyph;
    EXPECT_EQ(glyph.char_code_, 0);
    EXPECT_FLOAT_EQ(glyph.u0_, 0.f);
    EXPECT_FLOAT_EQ(glyph.v0_, 0.f);
    EXPECT_FLOAT_EQ(glyph.u1_, 0.f);
    EXPECT_FLOAT_EQ(glyph.v1_, 0.f);
    EXPECT_FLOAT_EQ(glyph.width_, 0.f);
    EXPECT_FLOAT_EQ(glyph.height_, 0.f);
    EXPECT_FLOAT_EQ(glyph.advance_, 0.f);
}

TEST(FontLoaderTest, FontLoaderDefaultState) {
    iecode::editor::FontLoader loader;
    EXPECT_EQ(loader.game_font(), nullptr);
    EXPECT_EQ(loader.gaiji_srv(), nullptr);
    EXPECT_EQ(loader.atlas_srv(), nullptr);
    EXPECT_EQ(loader.atlas_width(), 0u);
    EXPECT_EQ(loader.atlas_height(), 0u);
    EXPECT_FALSE(loader.has_game_font());
    EXPECT_FALSE(loader.has_gaiji());
    EXPECT_TRUE(loader.glyphs().empty());
}

TEST(FontLoaderTest, LoadGameFontWithoutDevice) {
    iecode::editor::FontLoader loader;
    // Sans init(), le device est nullptr — doit echouer proprement
    std::vector<uint8_t> dummy_atlas = {0x47, 0x34, 0x54, 0x58}; // "G4TX"
    std::vector<uint8_t> dummy_cfg = {0x01, 0x74, 0x32, 0x62};   // T2B footer

    EXPECT_FALSE(loader.load_game_font(dummy_atlas, dummy_cfg));
}

TEST(FontLoaderTest, LoadGameFontWithEmptyData) {
    iecode::editor::FontLoader loader;
    // init sans device reel — on teste juste le guard
    std::span<const uint8_t> empty;
    EXPECT_FALSE(loader.load_game_font(empty, empty));
}

TEST(FontLoaderTest, LoadGaijiWithoutDevice) {
    iecode::editor::FontLoader loader;
    std::vector<uint8_t> dummy = {0x47, 0x34, 0x54, 0x58};
    EXPECT_FALSE(loader.load_gaiji(dummy));
}

TEST(FontLoaderTest, LoadGaijiWithEmptyData) {
    iecode::editor::FontLoader loader;
    std::span<const uint8_t> empty;
    EXPECT_FALSE(loader.load_gaiji(empty));
}

TEST(FontLoaderTest, ShutdownIdempotent) {
    iecode::editor::FontLoader loader;
    // shutdown() sans init() ne doit pas crasher
    loader.shutdown();
    loader.shutdown();
}

#endif // _WIN32
