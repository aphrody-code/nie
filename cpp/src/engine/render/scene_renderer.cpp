/// @file scene_renderer.cpp
/// Implementation du SceneRenderer — enregistre des features dans le pipeline.
/// Stubs pour la grille editeur et le skybox.

#include "iecode/engine/render/scene_renderer.h"
#include "iecode/engine/render/debug_draw.h"
#include "iecode/engine/ecs/scene.h"

#include <bgfx/bgfx.h>
#include <spdlog/spdlog.h>

namespace lives {

SceneRenderer::SceneRenderer(RenderPipeline& pipeline)
    : pipeline_(pipeline) {}

void SceneRenderer::register_features() {
    if (registered_) {
        spdlog::warn("SceneRenderer::register_features() deja appele");
        return;
    }

    // Skybox — passe ZERO, priorite 0 (premier dans le pass)
    pipeline_.add_feature(DrawPass::ZERO, RenderFeature{
        .name     = "skybox",
        .priority = 0,
        .execute  = [](uint16_t view_id) { render_skybox(view_id); },
        .enabled  = true,
    });

    // Grille editeur — passe MAP_BEFORE, priorite 0
    pipeline_.add_feature(DrawPass::MAP_BEFORE, RenderFeature{
        .name     = "editor_grid",
        .priority = 0,
        .execute  = [](uint16_t view_id) { render_grid(view_id); },
        .enabled  = true,
    });

    registered_ = true;
    spdlog::info("SceneRenderer : features enregistrees (skybox, editor_grid)");
}

void SceneRenderer::unregister_features() {
    if (!registered_) {
        return;
    }

    pipeline_.remove_feature(DrawPass::ZERO, "skybox");
    pipeline_.remove_feature(DrawPass::MAP_BEFORE, "editor_grid");

    registered_ = false;
    spdlog::debug("SceneRenderer : features retirees");
}

// ── Stubs de rendu ──────────────────────────────────────────────────

void SceneRenderer::render_grid(uint16_t view_id) {
    // Grille 20x20 unites, pas de 1.0, gris moyen (ABGR)
    constexpr uint32_t GRID_COLOR = 0xFF808080;
    constexpr float GRID_SIZE = 20.0f;
    constexpr float GRID_STEP = 1.0f;

    DebugDraw::grid(GRID_SIZE, GRID_STEP, GRID_COLOR, view_id);

    // Axes au centre
    DebugDraw::axis(glm::vec3{0.0f}, 2.0f, view_id);
}

void SceneRenderer::submit_scene_drawables(const ecs::Scene& scene,
                                           uint16_t view_id) {
    const auto& fac = scene.fast_access();

    // Iteration directe O(1) — pas de parcours complet de la Scene.
    // Pour l'instant on ne fait que toucher le view ; la vraie soumission
    // bgfx (vertex/index buffer + shader) sera ajoutee quand les sous-classes
    // ModelRendererComponent exposeront leur mesh resolu.
    for ([[maybe_unused]] auto* renderer : fac.model_renderers) {
        bgfx::touch(view_id);
    }

    spdlog::trace("SceneRenderer::submit_scene_drawables : {} models, {} cameras, "
                  "{} lights, {} soccer_players, {} npcs",
                  fac.model_renderers.size(),
                  fac.cameras.size(),
                  fac.lights.size(),
                  fac.soccer_players.size(),
                  fac.npcs.size());
}

void SceneRenderer::render_skybox(uint16_t view_id) {
    // Stub — le skybox est gere par le clear de la passe UI_BEFORE.
    // Ici on s'assure simplement que le view est touche.
    bgfx::touch(view_id);
}

} // namespace lives
