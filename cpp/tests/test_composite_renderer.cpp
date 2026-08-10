/// @file test_composite_renderer.cpp
/// Tests unitaires du CompositeRenderer iecode (sans contexte bgfx).
///
/// On ne peut pas appeler render() sans bgfx::init, mais on verifie :
///  - l'ajout/recuperation/suppression de features par type
///  - les politiques d'execution (DEFAULT/WHITELIST/BLACKLIST/NEVER)
///  - l'ajout de passes externes ordonnees par priorite
///  - l'enregistrement du GizmoPass

#include "iecode/engine/render/composite_renderer.h"
#include "iecode/engine/render/passes/gizmo_pass.h"
#include "iecode/engine/camera/camera.h"

#include <gtest/gtest.h>

#include <vector>

namespace {

using namespace lives::render;

// ── Features de test ────────────────────────────────────────────────

class ShadowFeature : public ARenderFeature {
public:
    explicit ShadowFeature(CompositeRenderer& renderer)
        : ARenderFeature(renderer) {}

    int begin_count = 0;
    int end_count   = 0;
    int render_count = 0;

protected:
    void on_begin_frame(const SceneDescriptor&) override { ++begin_count; }
    void on_end_frame() override { ++end_count; }
    void on_render(lives::DrawPass, uint16_t, const SceneDescriptor&) override {
        ++render_count;
    }
};

class LightingFeature : public ARenderFeature {
public:
    explicit LightingFeature(CompositeRenderer& renderer)
        : ARenderFeature(renderer) {}
};

// ── Pass externe de test ────────────────────────────────────────────

class CustomDebugPass : public ARenderPass {
public:
    CustomDebugPass(CompositeRenderer& renderer, std::vector<int>* log, int id)
        : ARenderPass(renderer, lives::DrawPass::POST), log_(log), id_(id) {}

protected:
    void draw(uint16_t, const SceneDescriptor&) override {
        if (log_) log_->push_back(id_);
    }

private:
    std::vector<int>* log_;
    int id_;
};

// ── Tests ───────────────────────────────────────────────────────────

TEST(CompositeRenderer, DefaultConstruction) {
    CompositeRenderer renderer;
    EXPECT_FALSE(renderer.is_initialized());
    EXPECT_EQ(renderer.frame_index(), 0u);
}

TEST(CompositeRenderer, AddAndGetFeature) {
    CompositeRenderer renderer;
    auto& shadow = renderer.add_feature<ShadowFeature>();
    EXPECT_TRUE(renderer.has_feature<ShadowFeature>());
    EXPECT_FALSE(renderer.has_feature<LightingFeature>());
    EXPECT_EQ(&renderer.get_feature<ShadowFeature>(), &shadow);
}

TEST(CompositeRenderer, RemoveFeature) {
    CompositeRenderer renderer;
    renderer.add_feature<ShadowFeature>();
    EXPECT_TRUE(renderer.remove_feature<ShadowFeature>());
    EXPECT_FALSE(renderer.has_feature<ShadowFeature>());
    EXPECT_FALSE(renderer.remove_feature<ShadowFeature>());
}

TEST(ARenderFeature, ExecutionPolicyDefault) {
    CompositeRenderer renderer;
    auto& shadow = renderer.add_feature<ShadowFeature>();
    EXPECT_TRUE(shadow.is_enabled());
    EXPECT_EQ(shadow.execution_policy(), FeatureExecutionPolicy::DEFAULT);
    // Tous les pass autorises par defaut
    EXPECT_TRUE(shadow.is_enabled_for(lives::DrawPass::CHARA_BEFORE));
    EXPECT_TRUE(shadow.is_enabled_for(lives::DrawPass::UI));
}

TEST(ARenderFeature, BlacklistExcept) {
    CompositeRenderer renderer;
    auto& shadow = renderer.add_feature<ShadowFeature>();
    shadow.except(lives::DrawPass::UI).except(lives::DrawPass::POST_MENU_END_DRAW);
    EXPECT_FALSE(shadow.is_enabled_for(lives::DrawPass::UI));
    EXPECT_FALSE(shadow.is_enabled_for(lives::DrawPass::POST_MENU_END_DRAW));
    EXPECT_TRUE(shadow.is_enabled_for(lives::DrawPass::CHARA_BEFORE));
}

TEST(ARenderFeature, WhitelistOnly) {
    CompositeRenderer renderer;
    auto& shadow = renderer.add_feature<ShadowFeature>();
    shadow.set_execution_policy(FeatureExecutionPolicy::WHITELIST_ONLY);
    shadow.include(lives::DrawPass::CHARA_BEFORE);
    EXPECT_TRUE(shadow.is_enabled_for(lives::DrawPass::CHARA_BEFORE));
    EXPECT_FALSE(shadow.is_enabled_for(lives::DrawPass::UI));
    EXPECT_FALSE(shadow.is_enabled_for(lives::DrawPass::POST));
}

TEST(ARenderFeature, NeverPolicy) {
    CompositeRenderer renderer;
    auto& shadow = renderer.add_feature<ShadowFeature>();
    shadow.set_execution_policy(FeatureExecutionPolicy::NEVER);
    EXPECT_FALSE(shadow.is_enabled());
    EXPECT_FALSE(shadow.is_enabled_for(lives::DrawPass::CHARA_BEFORE));
}

TEST(ARenderFeature, AlwaysIgnoresBlacklist) {
    CompositeRenderer renderer;
    auto& shadow = renderer.add_feature<ShadowFeature>();
    shadow.except(lives::DrawPass::UI);
    shadow.set_execution_policy(FeatureExecutionPolicy::ALWAYS);
    EXPECT_TRUE(shadow.is_enabled_for(lives::DrawPass::UI));
}

TEST(CompositeRenderer, AddExternalPass) {
    CompositeRenderer renderer;
    std::vector<int> log;
    auto& p1 = renderer.add_pass<CustomDebugPass>(/*order=*/10, &log, 1);
    auto& p2 = renderer.add_pass<CustomDebugPass>(/*order=*/5,  &log, 2);
    EXPECT_EQ(p1.slot(), lives::DrawPass::POST);
    EXPECT_EQ(p2.slot(), lives::DrawPass::POST);
    EXPECT_TRUE(p1.is_enabled());
}

TEST(GizmoPass, ConstructAndSlot) {
    CompositeRenderer renderer;
    auto& gizmo = renderer.add_pass<GizmoPass>(
        /*order=*/100,
        [](uint16_t, const SceneDescriptor&) {});
    EXPECT_EQ(gizmo.slot(), lives::DrawPass::PRE_MENU_END_DRAW);
    EXPECT_TRUE(gizmo.is_enabled());
}

TEST(SceneDescriptor, ValidityChecks) {
    SceneDescriptor scene;
    EXPECT_FALSE(scene.is_valid());

    scene.render_width  = 1920;
    scene.render_height = 1080;
    EXPECT_FALSE(scene.is_valid()); // pas de camera

    lives::CCamera camera;
    scene.components.main_camera = &camera;
    EXPECT_TRUE(scene.is_valid());
}

} // namespace
