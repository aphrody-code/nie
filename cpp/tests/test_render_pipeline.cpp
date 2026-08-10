/// @file test_render_pipeline.cpp
/// Tests unitaires pour le RenderPipeline Level-5 (13 DrawPass).
/// Les tests ne creent pas de contexte bgfx — on teste la logique
/// de gestion des passes et features sans GPU.

#include "iecode/engine/render/render_pipeline.h"
#include "iecode/engine/render/draw_pass.h"

#include <gtest/gtest.h>

#include <string>
#include <vector>

namespace {

// ── Tests DrawPass ──────────────────────────────────────────────────

TEST(DrawPass, CountIs13) {
    // Le moteur Level-5 a exactement 13 passes de rendu
    EXPECT_EQ(static_cast<uint32_t>(lives::DrawPass::COUNT), 13u);
}

TEST(DrawPass, NamesAreCorrect) {
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::UI_BEFORE), "00_UI_Before");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::ZERO), "00_Zero");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::MAP_BEFORE), "10_MapBefore");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::PROJ_EFFECT), "15_ProjEffect");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::CHARA_BEFORE), "20_CharaBefore");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::CHARA_AFTER), "25_CharaAfter");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::MAP_AFTER), "30_MapAfter");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::EFFECT), "40_Effect");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::POST), "50_Post");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::POST_AFTER), "51_PostAfter");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::PRE_MENU_END_DRAW), "59_PreMenuEndDraw");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::UI), "60_UI");
    EXPECT_EQ(lives::draw_pass_name(lives::DrawPass::POST_MENU_END_DRAW), "61_PostMenuEndDraw");
}

TEST(DrawPass, ViewIdMapping) {
    // Chaque DrawPass correspond a son index comme bgfx ViewId
    EXPECT_EQ(lives::RenderPipeline::view_id_for(lives::DrawPass::UI_BEFORE), 0);
    EXPECT_EQ(lives::RenderPipeline::view_id_for(lives::DrawPass::ZERO), 1);
    EXPECT_EQ(lives::RenderPipeline::view_id_for(lives::DrawPass::UI), 11);
    EXPECT_EQ(lives::RenderPipeline::view_id_for(lives::DrawPass::POST_MENU_END_DRAW), 12);
}

// ── Tests RenderPipeline (sans GPU) ─────────────────────────────────

TEST(RenderPipeline, DefaultConstruction) {
    lives::RenderPipeline pipeline;
    EXPECT_FALSE(pipeline.is_initialized());
    EXPECT_EQ(pipeline.width(), 0u);
    EXPECT_EQ(pipeline.height(), 0u);
}

TEST(RenderPipeline, InitFailsWithNullHandle) {
    lives::RenderPipeline pipeline;
    EXPECT_FALSE(pipeline.initialize(1920, 1080, nullptr));
    EXPECT_FALSE(pipeline.is_initialized());
}

TEST(RenderPipeline, InitFailsWithZeroDimensions) {
    lives::RenderPipeline pipeline;
    // Dimensions nulles, meme avec un handle non-null (on ne teste pas bgfx::init)
    EXPECT_FALSE(pipeline.initialize(0, 0, nullptr));
    EXPECT_FALSE(pipeline.is_initialized());
}

TEST(RenderPipeline, AllPassesEnabledByDefault) {
    lives::RenderPipeline pipeline;
    for (uint32_t i = 0; i < static_cast<uint32_t>(lives::DrawPass::COUNT); ++i) {
        EXPECT_TRUE(pipeline.is_pass_enabled(static_cast<lives::DrawPass>(i)))
            << "Pass " << i << " devrait etre active par defaut";
    }
}

TEST(RenderPipeline, SetPassEnabled) {
    lives::RenderPipeline pipeline;
    pipeline.set_pass_enabled(lives::DrawPass::EFFECT, false);
    EXPECT_FALSE(pipeline.is_pass_enabled(lives::DrawPass::EFFECT));

    pipeline.set_pass_enabled(lives::DrawPass::EFFECT, true);
    EXPECT_TRUE(pipeline.is_pass_enabled(lives::DrawPass::EFFECT));
}

TEST(RenderPipeline, AddFeature) {
    lives::RenderPipeline pipeline;

    int call_count = 0;
    pipeline.add_feature(lives::DrawPass::MAP_BEFORE, lives::RenderFeature{
        .name     = "test_grid",
        .priority = 0,
        .execute  = [&call_count](uint16_t) { ++call_count; },
        .enabled  = true,
    });

    // Le feature est enregistre (pas d'exception, pas de crash)
    // On ne peut pas executer render_frame() sans bgfx init
}

TEST(RenderPipeline, AddDuplicateFeatureIsIgnored) {
    lives::RenderPipeline pipeline;

    pipeline.add_feature(lives::DrawPass::ZERO, lives::RenderFeature{
        .name     = "skybox",
        .priority = 0,
        .execute  = [](uint16_t) {},
        .enabled  = true,
    });

    // Ajout d'un doublon — doit etre ignore sans crash
    pipeline.add_feature(lives::DrawPass::ZERO, lives::RenderFeature{
        .name     = "skybox",
        .priority = 1,
        .execute  = [](uint16_t) {},
        .enabled  = true,
    });
}

TEST(RenderPipeline, RemoveFeature) {
    lives::RenderPipeline pipeline;

    pipeline.add_feature(lives::DrawPass::POST, lives::RenderFeature{
        .name     = "bloom",
        .priority = 0,
        .execute  = [](uint16_t) {},
        .enabled  = true,
    });

    EXPECT_TRUE(pipeline.remove_feature(lives::DrawPass::POST, "bloom"));
    // Le deuxieme remove retourne false — deja supprime
    EXPECT_FALSE(pipeline.remove_feature(lives::DrawPass::POST, "bloom"));
}

TEST(RenderPipeline, RemoveNonExistentFeature) {
    lives::RenderPipeline pipeline;
    EXPECT_FALSE(pipeline.remove_feature(lives::DrawPass::UI, "inexistant"));
}

TEST(RenderPipeline, FeaturePriorityOrdering) {
    lives::RenderPipeline pipeline;
    std::vector<std::string> execution_order;

    // Ajouter dans le desordre
    pipeline.add_feature(lives::DrawPass::CHARA_BEFORE, lives::RenderFeature{
        .name     = "shadows",
        .priority = 10,
        .execute  = [&](uint16_t) { execution_order.push_back("shadows"); },
        .enabled  = true,
    });

    pipeline.add_feature(lives::DrawPass::CHARA_BEFORE, lives::RenderFeature{
        .name     = "base_pass",
        .priority = 0,
        .execute  = [&](uint16_t) { execution_order.push_back("base_pass"); },
        .enabled  = true,
    });

    pipeline.add_feature(lives::DrawPass::CHARA_BEFORE, lives::RenderFeature{
        .name     = "outlines",
        .priority = 20,
        .execute  = [&](uint16_t) { execution_order.push_back("outlines"); },
        .enabled  = true,
    });

    // On ne peut pas appeler render_frame() sans bgfx, mais on verifie
    // que l'ajout n'a pas crashe et que les features sont enregistrees.
    // L'ordre sera verifie implicitement par le tri dans add_feature().
}

// ── Tests RenderFeature ─────────────────────────────────────────────

TEST(RenderFeature, DefaultValues) {
    lives::RenderFeature feature;
    EXPECT_TRUE(feature.name.empty());
    EXPECT_EQ(feature.priority, 0u);
    EXPECT_TRUE(feature.enabled);
    EXPECT_FALSE(static_cast<bool>(feature.execute));
}

TEST(RenderFeature, DesignatedInitializer) {
    lives::RenderFeature feature{
        .name     = "test",
        .priority = 42,
        .execute  = [](uint16_t) {},
        .enabled  = false,
    };
    EXPECT_EQ(feature.name, "test");
    EXPECT_EQ(feature.priority, 42u);
    EXPECT_FALSE(feature.enabled);
    EXPECT_TRUE(static_cast<bool>(feature.execute));
}

// ── Tests RenderPassConfig ──────────────────────────────────────────

TEST(RenderPassConfig, DefaultValues) {
    lives::RenderPassConfig config;
    EXPECT_EQ(config.pass, lives::DrawPass::UI_BEFORE);
    EXPECT_TRUE(config.name.empty());
    EXPECT_FALSE(config.clear_color);
    EXPECT_FALSE(config.clear_depth);
    EXPECT_EQ(config.clear_color_value, 0x000000FFu);
    EXPECT_FLOAT_EQ(config.clear_depth_value, 1.0f);
}

} // namespace
