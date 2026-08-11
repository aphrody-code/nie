/// @file test_gmd_obj_model.cpp
/// Tests du composant lives::gmdCObjModelComponent.
///
/// Couvre :
///   - initialize() echoue proprement quand les dependances sont nulles
///   - set_lod() selectionne le bon LOD selon la distance
///   - set_material() override le materiau
///   - on_render() est no-op si pas de mesh / mauvaise passe
///   - register_with_pipeline() / unregister_from_pipeline()

#include "iecode/engine/gmd/gmd_obj_model.h"
#include "iecode/engine/render/render_pipeline.h"

#include <gtest/gtest.h>

namespace {

using namespace lives;

TEST(GmdObjModelComponent, InitializeFailsWithoutDeps) {
    gmdCObjModelComponent comp;
    EXPECT_FALSE(comp.load());

    comp.mesh_path_ = "common/chr/chr001/chr001.g4mg";
    EXPECT_FALSE(comp.load()); // model_manager_ et vfs_ encore nuls
}

TEST(GmdObjModelComponent, SetLodSelectsByDistance) {
    gmdCObjModelComponent comp;
    comp.lods_ = {
        {.distance_ = 10.f, .lod_level_ = 0, .mesh_index_ = 0, .is_visible_ = true},
        {.distance_ = 50.f, .lod_level_ = 1, .mesh_index_ = 1, .is_visible_ = true},
        {.distance_ = 200.f, .lod_level_ = 2, .mesh_index_ = 2, .is_visible_ = true},
    };

    comp.set_lod(5.f);
    EXPECT_EQ(comp.current_lod_.lod_level_, 0u);

    comp.set_lod(25.f);
    EXPECT_EQ(comp.current_lod_.lod_level_, 1u);

    comp.set_lod(150.f);
    EXPECT_EQ(comp.current_lod_.lod_level_, 2u);

    // Au-dela du dernier seuil : on garde le LOD le plus loin.
    comp.set_lod(10000.f);
    EXPECT_EQ(comp.current_lod_.lod_level_, 2u);
}

TEST(GmdObjModelComponent, SetLodWithoutLodTable) {
    gmdCObjModelComponent comp;
    comp.set_lod(42.f);
    EXPECT_FLOAT_EQ(comp.lod_distance_, 42.f);
    EXPECT_EQ(comp.current_lod_.lod_level_, 0u);
}

TEST(GmdObjModelComponent, SetMaterialOverride) {
    gmdCObjModelComponent comp;
    EXPECT_EQ(comp.material_override_, nullptr);

    // On utilise un pointeur factice — on_render() le verifiera mais skip
    // le draw call car d3d_context_ est nul.
    auto* fake_mesh = reinterpret_cast<CResMesh*>(0xDEADBEEFULL);
    comp.set_material(fake_mesh);
    EXPECT_EQ(comp.material_override_, fake_mesh);

    comp.set_material(nullptr);
    EXPECT_EQ(comp.material_override_, nullptr);
}

TEST(GmdObjModelComponent, OnRenderNoOpWithoutMesh) {
    gmdCObjModelComponent comp;
    comp.draw_pass_ = DrawPass::CHARA_BEFORE;

    // Aucun mesh charge -> ne doit pas crasher.
    comp.on_render(DrawPass::CHARA_BEFORE);
    comp.on_render(DrawPass::UI); // mauvaise passe
    SUCCEED();
}

TEST(GmdObjModelComponent, OnRenderSkipsDisabledOrWrongPass) {
    gmdCObjModelComponent comp;
    comp.draw_pass_ = DrawPass::CHARA_BEFORE;
    comp.enabled_   = false;

    comp.on_render(DrawPass::CHARA_BEFORE); // disabled -> skip
    comp.enabled_ = true;
    comp.on_render(DrawPass::MAP_AFTER);    // mauvaise passe -> skip
    SUCCEED();
}

TEST(GmdObjModelComponent, RegisterAndUnregisterPipeline) {
    RenderPipeline pipeline;
    // Pas besoin d'initialize() : add_feature/remove_feature manipulent
    // uniquement les vecteurs internes de PassState.

    gmdCObjModelComponent comp;
    comp.draw_pass_ = DrawPass::CHARA_BEFORE;
    comp.mesh_path_ = "test/mesh.g4mg";

    comp.register_with_pipeline(pipeline, 50);
    // Idempotent
    comp.register_with_pipeline(pipeline, 50);

    comp.unregister_from_pipeline(pipeline);
    // Idempotent
    comp.unregister_from_pipeline(pipeline);
    SUCCEED();
}

} // namespace
