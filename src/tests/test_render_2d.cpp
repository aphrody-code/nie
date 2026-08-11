/// @file test_render_2d.cpp
/// Tests du pipeline de rendu 2D (ResTexture, SpriteRenderer, CMenuLayer).
/// bgfx n'est pas initialise ici : on teste uniquement la logique CPU
/// (traduction de format, batching, parsing MENU_LAYER_INFO).

#include "iecode/engine/menu/menu_layer.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/render/res_texture.h"
#include "iecode/render/sprite_renderer.h"

#include <gtest/gtest.h>

#include <variant>

namespace {

using iecode::render::ResTexture;
using iecode::render::Sprite;
using iecode::render::SpriteRenderer;

// ── ResTexture : translate_format ──────────────────────────────────

TEST(ResTexture, TranslateFormatCouvreTousLesFormatsBCn) {
    using F = iecode::level5::G4txFormat;
    EXPECT_EQ(ResTexture::translate_format(F::BC1),   bgfx::TextureFormat::BC1);
    EXPECT_EQ(ResTexture::translate_format(F::BC2),   bgfx::TextureFormat::BC2);
    EXPECT_EQ(ResTexture::translate_format(F::BC3),   bgfx::TextureFormat::BC3);
    EXPECT_EQ(ResTexture::translate_format(F::BC4),   bgfx::TextureFormat::BC4);
    EXPECT_EQ(ResTexture::translate_format(F::BC5),   bgfx::TextureFormat::BC5);
    EXPECT_EQ(ResTexture::translate_format(F::BC6H),  bgfx::TextureFormat::BC6H);
    EXPECT_EQ(ResTexture::translate_format(F::BC7),   bgfx::TextureFormat::BC7);
    EXPECT_EQ(ResTexture::translate_format(F::RGBA8), bgfx::TextureFormat::RGBA8);
    EXPECT_EQ(ResTexture::translate_format(F::Unknown), bgfx::TextureFormat::Unknown);
}

TEST(ResTexture, FromG4txEchoueSiTexturesVides) {
    iecode::level5::G4txFile tx;
    auto r = ResTexture::from_g4tx(tx);
    EXPECT_FALSE(r.has_value());
}

TEST(ResTexture, FromG4txEchoueSiFormatInconnu) {
    iecode::level5::G4txFile tx;
    iecode::level5::G4txTexture t;
    t.format = iecode::level5::G4txFormat::Unknown;
    t.width = 64;
    t.height = 64;
    t.data = std::vector<uint8_t>(64 * 64 * 4, 0);
    tx.textures.push_back(std::move(t));
    EXPECT_FALSE(ResTexture::from_g4tx(tx).has_value());
}

// ── SpriteRenderer : batch accumulation ────────────────────────────

TEST(SpriteRenderer, DrawSkippeTextureInvalide) {
    SpriteRenderer r;
    // Pas d'init bgfx : on teste juste la logique d'accumulation.
    r.begin();
    Sprite s{};
    s.texture = BGFX_INVALID_HANDLE;
    s.w = 10.f;
    s.h = 10.f;
    r.draw(s);
    EXPECT_EQ(r.pending(), 0u);
}

TEST(SpriteRenderer, DrawSkippeTailleNulle) {
    SpriteRenderer r;
    r.begin();
    Sprite s{};
    s.texture.idx = 1;  // handle factice mais valide (idx != 0xFFFF)
    s.w = 0.f;
    s.h = 10.f;
    r.draw(s);
    EXPECT_EQ(r.pending(), 0u);
}

TEST(SpriteRenderer, DrawAccumuleSpritesValides) {
    SpriteRenderer r;
    r.begin();
    Sprite s{};
    s.texture.idx = 42;
    s.w = 128.f;
    s.h = 64.f;
    s.draw_pass = 60;
    r.draw(s);
    r.draw(s);
    r.draw(s);
    EXPECT_EQ(r.pending(), 3u);
    r.begin();  // reset
    EXPECT_EQ(r.pending(), 0u);
}

// ── CMenuLayer : parsing MENU_LAYER_INFO ───────────────────────────

TEST(CMenuLayer, FromCfgParseEntreesT2B) {
    using namespace iecode::level5;

    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    CfgEntry root;
    root.name = "MENU_LAYER_INFO";
    root.crc32 = 0x1AA1BAAFu;
    // 10 variables : int, str, str, int, int, int, int, int, float, int
    root.variables = {
        {CfgVarType::Int,    CfgVarValue{int32_t{3}}, {}},
        {CfgVarType::String, CfgVarValue{std::string{"#/menu/200_icon/bg.g4tx"}}, {}},
        {CfgVarType::String, CfgVarValue{std::string{}}, {}},
        {CfgVarType::Int,    CfgVarValue{int32_t{1}}, {}},
        {CfgVarType::Int,    CfgVarValue{int32_t{60}}, {}},
        {CfgVarType::Int,    CfgVarValue{int32_t{1920}}, {}},
        {CfgVarType::Int,    CfgVarValue{int32_t{10}}, {}},
        {CfgVarType::Int,    CfgVarValue{int32_t{20}}, {}},
        {CfgVarType::Float,  CfgVarValue{0.75f}, {}},
        {CfgVarType::Int,    CfgVarValue{int32_t{1}}, {}},
    };
    cfg.entries.push_back(root);

    std::vector<lives::CMenuLayerObject> storage;
    lives::CMenuLayerGroup group;
    const size_t n = lives::CMenuLayerGroup::from_cfg(cfg, storage, group);

    ASSERT_EQ(n, 1u);
    ASSERT_EQ(storage.size(), 1u);
    const auto& L = storage[0];
    EXPECT_EQ(L.layer_index_, 3u);
    EXPECT_EQ(L.texture_path_, "#/menu/200_icon/bg.g4tx");
    EXPECT_TRUE(L.layer_visible_);
    EXPECT_EQ(L.blend_mode_, 60u);
    EXPECT_EQ(L.width_pixels_, 1920u);
    EXPECT_EQ(L.x_offset_, 10);
    EXPECT_EQ(L.y_offset_, 20);
    EXPECT_FLOAT_EQ(L.opacity_, 0.75f);
    EXPECT_TRUE(L.enabled_);
    EXPECT_EQ(group.layers_.size(), 1u);
}

TEST(CMenuLayer, FromCfgIgnoreEntreesNonMatching) {
    using namespace iecode::level5;
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;
    CfgEntry other;
    other.name = "OTHER";
    other.crc32 = 0xDEADBEEFu;
    cfg.entries.push_back(other);

    std::vector<lives::CMenuLayerObject> storage;
    lives::CMenuLayerGroup group;
    const size_t n = lives::CMenuLayerGroup::from_cfg(cfg, storage, group);
    EXPECT_EQ(n, 0u);
    EXPECT_TRUE(storage.empty());
    EXPECT_TRUE(group.layers_.empty());
}

TEST(CMenuLayer, FromCfgTrieParZOrder) {
    using namespace iecode::level5;
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    auto make_entry = [](int32_t z) {
        CfgEntry e;
        e.name = "MENU_LAYER_INFO";
        e.crc32 = 0x1AA1BAAFu;
        e.variables = {
            {CfgVarType::Int,    CfgVarValue{z}, {}},
            {CfgVarType::String, CfgVarValue{std::string{}}, {}},
            {CfgVarType::String, CfgVarValue{std::string{}}, {}},
            {CfgVarType::Int,    CfgVarValue{int32_t{1}}, {}},
            {CfgVarType::Int,    CfgVarValue{int32_t{0}}, {}},
            {CfgVarType::Int,    CfgVarValue{int32_t{0}}, {}},
            {CfgVarType::Int,    CfgVarValue{int32_t{0}}, {}},
            {CfgVarType::Int,    CfgVarValue{int32_t{0}}, {}},
            {CfgVarType::Float,  CfgVarValue{1.f}, {}},
            {CfgVarType::Int,    CfgVarValue{int32_t{1}}, {}},
        };
        return e;
    };
    cfg.entries.push_back(make_entry(5));
    cfg.entries.push_back(make_entry(1));
    cfg.entries.push_back(make_entry(3));

    std::vector<lives::CMenuLayerObject> storage;
    lives::CMenuLayerGroup group;
    ASSERT_EQ(lives::CMenuLayerGroup::from_cfg(cfg, storage, group), 3u);
    ASSERT_EQ(group.layers_.size(), 3u);
    EXPECT_EQ(group.layers_[0]->layer_index_, 1u);
    EXPECT_EQ(group.layers_[1]->layer_index_, 3u);
    EXPECT_EQ(group.layers_[2]->layer_index_, 5u);
}

} // namespace
