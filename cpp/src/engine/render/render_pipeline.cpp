/// @file render_pipeline.cpp
/// Implementation du pipeline de rendu Level-5 — 13 DrawPass via bgfx.
/// Reproduit l'architecture de FUN_140eff080 dans nie.exe.

#include "iecode/engine/render/render_pipeline.h"

#include <bgfx/bgfx.h>
#include <bgfx/platform.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <string>

namespace lives {

// ── Configurations par defaut des 13 passes ─────────────────────────
// La passe UI_BEFORE clear couleur + depth (fond du framebuffer).
// Toutes les autres passes heritent du contenu precedent.
static constexpr struct {
    DrawPass pass;
    const char* name;
    bool clear_color;
    bool clear_depth;
    uint32_t clear_value;
} DEFAULT_PASS_CONFIGS[] = {
    {DrawPass::UI_BEFORE,          "00_UI_Before",        true,  true,  0x1A1A2EFF},
    {DrawPass::ZERO,               "00_Zero",             false, false, 0},
    {DrawPass::MAP_BEFORE,         "10_MapBefore",        false, false, 0},
    {DrawPass::PROJ_EFFECT,        "15_ProjEffect",       false, false, 0},
    {DrawPass::CHARA_BEFORE,       "20_CharaBefore",      false, false, 0},
    {DrawPass::CHARA_AFTER,        "25_CharaAfter",       false, false, 0},
    {DrawPass::MAP_AFTER,          "30_MapAfter",         false, false, 0},
    {DrawPass::EFFECT,             "40_Effect",           false, false, 0},
    {DrawPass::POST,               "50_Post",             false, false, 0},
    {DrawPass::POST_AFTER,         "51_PostAfter",        false, false, 0},
    {DrawPass::PRE_MENU_END_DRAW,  "59_PreMenuEndDraw",   false, false, 0},
    {DrawPass::UI,                 "60_UI",               false, false, 0},
    {DrawPass::POST_MENU_END_DRAW, "61_PostMenuEndDraw",  false, false, 0},
};

static_assert(
    sizeof(DEFAULT_PASS_CONFIGS) / sizeof(DEFAULT_PASS_CONFIGS[0])
        == static_cast<size_t>(DrawPass::COUNT),
    "DEFAULT_PASS_CONFIGS doit avoir exactement 13 entrees");

// ── Construction / Destruction ──────────────────────────────────────

RenderPipeline::RenderPipeline() {
    // Initialiser les configs par defaut
    for (const auto& cfg : DEFAULT_PASS_CONFIGS) {
        const auto idx = static_cast<size_t>(cfg.pass);
        passes_[idx].config = RenderPassConfig{
            .pass              = cfg.pass,
            .name              = cfg.name,
            .clear_color       = cfg.clear_color,
            .clear_depth       = cfg.clear_depth,
            .clear_color_value = cfg.clear_value,
            .clear_depth_value = 1.0f,
        };
        passes_[idx].enabled = true;
    }
}

RenderPipeline::~RenderPipeline() {
    if (initialized_) {
        shutdown();
    }
}

// ── Initialisation bgfx ─────────────────────────────────────────────

bool RenderPipeline::initialize(uint32_t width, uint32_t height,
                                void* native_window_handle) {
    if (initialized_) {
        spdlog::warn("RenderPipeline::initialize() appele alors que le pipeline "
                     "est deja initialise");
        return true;
    }

    if (native_window_handle == nullptr) {
        spdlog::error("RenderPipeline::initialize() : handle de fenetre nul");
        return false;
    }

    if (width == 0 || height == 0) {
        spdlog::error("RenderPipeline::initialize() : dimensions invalides "
                      "({}x{})", width, height);
        return false;
    }

    width_  = width;
    height_ = height;

    // Configurer la plateforme native avant bgfx::init
    bgfx::PlatformData pd = {};
    pd.nwh = native_window_handle;
    bgfx::setPlatformData(pd);

    bgfx::Init init;
    init.type = bgfx::RendererType::Direct3D11;
    init.resolution.width  = width;
    init.resolution.height = height;
    init.resolution.reset  = BGFX_RESET_VSYNC;

    if (!bgfx::init(init)) {
        spdlog::critical("RenderPipeline : echec initialisation bgfx (D3D11)");
        return false;
    }

    spdlog::info("RenderPipeline initialise — D3D11, {}x{}", width, height);

    setup_views();
    initialized_ = true;
    return true;
}

void RenderPipeline::shutdown() {
    if (!initialized_) {
        return;
    }

    // Vider toutes les features
    for (auto& pass_state : passes_) {
        pass_state.features.clear();
    }

    bgfx::shutdown();
    initialized_ = false;
    spdlog::info("RenderPipeline arrete");
}

// ── Configuration des views bgfx ────────────────────────────────────

void RenderPipeline::setup_views() {
    for (size_t i = 0; i < passes_.size(); ++i) {
        const auto view_id = static_cast<bgfx::ViewId>(i);
        const auto& config = passes_[i].config;

        // Nom de debug (visible dans PIX / RenderDoc)
        bgfx::setViewName(view_id, config.name.c_str());

        // Rect du viewport
        bgfx::setViewRect(view_id, 0, 0,
                          static_cast<uint16_t>(width_),
                          static_cast<uint16_t>(height_));

        // Clear flags
        uint16_t clear_flags = BGFX_CLEAR_NONE;
        if (config.clear_color) {
            clear_flags |= BGFX_CLEAR_COLOR;
        }
        if (config.clear_depth) {
            clear_flags |= BGFX_CLEAR_DEPTH;
        }

        bgfx::setViewClear(view_id, clear_flags,
                            config.clear_color_value,
                            config.clear_depth_value,
                            0);
    }
}

// ── Redimensionnement ───────────────────────────────────────────────

void RenderPipeline::resize(uint32_t width, uint32_t height) {
    if (width == 0 || height == 0) {
        return;
    }

    width_  = width;
    height_ = height;

    if (initialized_) {
        bgfx::reset(width, height, BGFX_RESET_VSYNC);

        // Mettre a jour les view rects
        for (uint32_t i = 0; i < static_cast<uint32_t>(DrawPass::COUNT); ++i) {
            bgfx::setViewRect(static_cast<bgfx::ViewId>(i), 0, 0,
                              static_cast<uint16_t>(width),
                              static_cast<uint16_t>(height));
        }
    }
}

// ── Execution du frame ──────────────────────────────────────────────

void RenderPipeline::render_frame() {
    if (!initialized_) {
        return;
    }

    for (size_t i = 0; i < passes_.size(); ++i) {
        const auto& pass_state = passes_[i];
        const auto view_id = static_cast<uint16_t>(i);

        if (!pass_state.enabled) {
            continue;
        }

        // Touch le view pour s'assurer qu'il est soumis meme sans draw calls
        bgfx::touch(view_id);

        // Executer les features actives, triees par priorite
        for (const auto& feature : pass_state.features) {
            if (feature.enabled && feature.execute) {
                feature.execute(view_id);
            }
        }
    }
}

uint32_t RenderPipeline::submit_frame() {
    return bgfx::frame();
}

// ── Gestion des features ────────────────────────────────────────────

void RenderPipeline::add_feature(DrawPass pass, RenderFeature feature) {
    const auto idx = static_cast<size_t>(pass);
    if (idx >= passes_.size()) {
        spdlog::warn("RenderPipeline::add_feature() : pass invalide ({})", idx);
        return;
    }

    auto& features = passes_[idx].features;

    // Verifier qu'un feature du meme nom n'existe pas deja
    for (const auto& existing : features) {
        if (existing.name == feature.name) {
            spdlog::warn("RenderPipeline::add_feature() : feature '{}' existe "
                         "deja dans le pass '{}'",
                         feature.name, passes_[idx].config.name);
            return;
        }
    }

    const auto name = feature.name; // copie pour le log
    features.push_back(std::move(feature));

    // Trier par priorite croissante
    std::sort(features.begin(), features.end(),
              [](const RenderFeature& a, const RenderFeature& b) {
                  return a.priority < b.priority;
              });

    spdlog::debug("RenderPipeline : feature '{}' ajoute au pass '{}'",
                  name, passes_[idx].config.name);
}

bool RenderPipeline::remove_feature(DrawPass pass, const std::string& name) {
    const auto idx = static_cast<size_t>(pass);
    if (idx >= passes_.size()) {
        return false;
    }

    auto& features = passes_[idx].features;
    const auto it = std::find_if(features.begin(), features.end(),
                                 [&name](const RenderFeature& f) {
                                     return f.name == name;
                                 });

    if (it == features.end()) {
        return false;
    }

    features.erase(it);
    spdlog::debug("RenderPipeline : feature '{}' retire du pass '{}'",
                  name, passes_[idx].config.name);
    return true;
}

void RenderPipeline::set_pass_enabled(DrawPass pass, bool enabled) {
    const auto idx = static_cast<size_t>(pass);
    if (idx < passes_.size()) {
        passes_[idx].enabled = enabled;
    }
}

bool RenderPipeline::is_pass_enabled(DrawPass pass) const {
    const auto idx = static_cast<size_t>(pass);
    if (idx >= passes_.size()) {
        return false;
    }
    return passes_[idx].enabled;
}

} // namespace lives
