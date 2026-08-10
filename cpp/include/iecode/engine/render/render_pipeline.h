#pragma once

/// @file render_pipeline.h
/// Pipeline de rendu Level-5 avec 13 DrawPass (bgfx backend).
/// Reproduit l'ordre des passes de FUN_140eff080 dans nie.exe.
///
/// Chaque passe correspond a un bgfx ViewId (0-12).
/// Les RenderFeature sont des unites de travail enregistrees dans un pass,
/// triees par priorite et executees sequentiellement.

#include "draw_pass.h"

#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace lives {

/// Unite de rendu dans un pass — callback executee avec le view_id bgfx.
struct RenderFeature {
    std::string name;
    uint32_t priority = 0; ///< Ordre dans le pass (0 = premier)
    std::function<void(uint16_t view_id)> execute;
    bool enabled = true;
};

/// Configuration d'un pass de rendu (clear flags, couleur, depth).
struct RenderPassConfig {
    DrawPass pass       = DrawPass::UI_BEFORE;
    std::string name;
    bool clear_color    = false;
    bool clear_depth    = false;
    uint32_t clear_color_value = 0x000000FF;
    float clear_depth_value    = 1.0f;
};

/// Pipeline de rendu Level-5 — 13 passes dans l'ordre de nie.exe.
///
/// Gere l'initialisation de bgfx, la configuration des views,
/// l'enregistrement de RenderFeatures par pass, et l'execution du frame.
class RenderPipeline {
public:
    RenderPipeline();
    ~RenderPipeline();

    // Non-copiable, movable
    RenderPipeline(const RenderPipeline&) = delete;
    RenderPipeline& operator=(const RenderPipeline&) = delete;
    RenderPipeline(RenderPipeline&&) noexcept = default;
    RenderPipeline& operator=(RenderPipeline&&) noexcept = default;

    /// Initialise bgfx (D3D11 backend) et configure les 13 view IDs.
    /// @param width   Largeur du framebuffer en pixels.
    /// @param height  Hauteur du framebuffer en pixels.
    /// @param native_window_handle  Handle natif de la fenetre (HWND sur Windows).
    /// @return true si l'initialisation a reussi.
    [[nodiscard]] bool initialize(uint32_t width, uint32_t height,
                                  void* native_window_handle);

    /// Libere les ressources bgfx.
    void shutdown();

    /// Redimensionne le framebuffer (appelle bgfx::reset + reconfigure les views).
    void resize(uint32_t width, uint32_t height);

    /// Execute toutes les passes dans l'ordre Level-5 (0 a 12).
    /// Les features inactives ou les passes desactivees sont sautees.
    void render_frame();

    /// Soumet le frame a bgfx (bgfx::frame()).
    /// @return L'index du frame soumis.
    [[nodiscard]] uint32_t submit_frame();

    /// Ajoute un RenderFeature a un pass specifique.
    /// Les features sont triees par priorite croissante.
    void add_feature(DrawPass pass, RenderFeature feature);

    /// Supprime un feature par nom dans un pass.
    /// @return true si le feature a ete trouve et supprime.
    bool remove_feature(DrawPass pass, const std::string& name);

    /// Active ou desactive un pass entier.
    void set_pass_enabled(DrawPass pass, bool enabled);

    /// Verifie si un pass est active.
    [[nodiscard]] bool is_pass_enabled(DrawPass pass) const;

    /// Dimensions du viewport.
    [[nodiscard]] uint32_t width() const noexcept { return width_; }
    [[nodiscard]] uint32_t height() const noexcept { return height_; }

    /// Etat d'initialisation.
    [[nodiscard]] bool is_initialized() const noexcept { return initialized_; }

    /// Retourne le bgfx ViewId pour un DrawPass donne.
    [[nodiscard]] static constexpr uint16_t view_id_for(DrawPass pass) noexcept {
        return static_cast<uint16_t>(pass);
    }

private:
    /// Configure les 13 bgfx views (noms, rects, clear flags).
    void setup_views();

    /// Etat interne d'un pass.
    struct PassState {
        RenderPassConfig config;
        std::vector<RenderFeature> features;
        bool enabled = true;
    };

    /// 13 passes dans l'ordre Level-5.
    std::array<PassState, static_cast<size_t>(DrawPass::COUNT)> passes_;

    uint32_t width_  = 0;
    uint32_t height_ = 0;
    bool initialized_ = false;
};

} // namespace lives
