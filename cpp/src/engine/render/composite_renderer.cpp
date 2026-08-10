/// @file composite_renderer.cpp
/// Implementation du CompositeRenderer iecode.
///
/// Orchestration du frame :
///   begin_frame (features + passes externes)
///   pour chaque DrawPass slot 0..12 :
///       bgfx::touch
///       on_render des features actives
///       draw des ARenderPass externes (ordonne par priorite, filtres par slot)
///       legacy callbacks (RenderPipeline::render_frame partiel)
///   end_frame

#include "iecode/engine/render/composite_renderer.h"

#include <bgfx/bgfx.h>
#include <spdlog/spdlog.h>

namespace lives::render {

CompositeRenderer::CompositeRenderer() = default;

CompositeRenderer::~CompositeRenderer() {
    shutdown();
}

bool CompositeRenderer::initialize(uint32_t width, uint32_t height,
                                   void* native_window_handle) {
    return pipeline_.initialize(width, height, native_window_handle);
}

void CompositeRenderer::shutdown() {
    // Detruire les passes externes et features avant bgfx::shutdown
    // pour permettre aux destructeurs de liberer leurs ressources GPU.
    passes_.clear();
    features_.clear();
    pipeline_.shutdown();
}

void CompositeRenderer::resize(uint32_t width, uint32_t height) {
    pipeline_.resize(width, height);
}

void CompositeRenderer::render(const SceneDescriptor& scene) {
    if (!pipeline_.is_initialized()) {
        return;
    }

    if (!scene.is_valid()) {
        spdlog::warn("CompositeRenderer::render() : SceneDescriptor invalide "
                     "(camera ou dimensions manquantes)");
        return;
    }

    ++frame_index_;

    // ── 1. Begin frame ──────────────────────────────────────────────
    for (auto& [type, feature] : features_) {
        if (feature->is_enabled()) {
            feature->on_begin_frame(scene);
        }
    }
    for (auto& [order, pass] : passes_) {
        if (pass->is_enabled()) {
            pass->on_begin_frame(scene);
        }
    }

    // ── 2. Pour chaque DrawPass slot ────────────────────────────────
    for (uint32_t i = 0; i < static_cast<uint32_t>(DrawPass::COUNT); ++i) {
        const auto slot = static_cast<DrawPass>(i);
        if (!pipeline_.is_pass_enabled(slot)) {
            continue;
        }

        const auto view_id = static_cast<uint16_t>(i);
        bgfx::touch(view_id);

        // 2a — features autorisees pour ce pass
        for (auto& [type, feature] : features_) {
            if (feature->is_enabled() && feature->is_enabled_for(slot)) {
                feature->on_render(slot, view_id, scene);
            }
        }

        // 2b — passes externes greffees sur ce slot, ordonnees par priorite
        for (auto& [order, pass] : passes_) {
            if (pass->is_enabled() && pass->slot() == slot) {
                pass->draw(view_id, scene);
            }
        }
    }

    // ── 3. End frame ────────────────────────────────────────────────
    for (auto& [order, pass] : passes_) {
        if (pass->is_enabled()) {
            pass->on_end_frame();
        }
    }
    for (auto& [type, feature] : features_) {
        if (feature->is_enabled()) {
            feature->on_end_frame();
        }
    }
}

uint32_t CompositeRenderer::submit_frame() {
    return pipeline_.submit_frame();
}

} // namespace lives::render
