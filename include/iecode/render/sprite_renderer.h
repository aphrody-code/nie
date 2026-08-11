#pragma once

/// @file sprite_renderer.h
/// Renderer 2D/sprite via bgfx transient buffers.
/// Supporte le batching par texture et le draw_pass (0-255).
/// draw_pass = 60 correspond a la passe "60_UI" du pipeline Level-5.

#include <bgfx/bgfx.h>

#include <cstdint>
#include <vector>

namespace iecode::render {

/// Sprite 2D a dessiner. Position/taille en pixels ecran, UV en [0,1].
struct Sprite {
    bgfx::TextureHandle texture = BGFX_INVALID_HANDLE;
    float x  = 0.f;
    float y  = 0.f;
    float w  = 0.f;
    float h  = 0.f;
    float u0 = 0.f;
    float v0 = 0.f;
    float u1 = 1.f;
    float v1 = 1.f;
    float alpha = 1.f;
    uint32_t tint = 0xFFFFFFFFu;  ///< ABGR8 (bgfx order)
    uint8_t  draw_pass = 60;       ///< view id bgfx (60 = UI par defaut)
};

/// Renderer 2D accumulateur — batch interne, flush via end().
class SpriteRenderer {
public:
    SpriteRenderer() = default;
    ~SpriteRenderer();

    SpriteRenderer(const SpriteRenderer&) = delete;
    SpriteRenderer& operator=(const SpriteRenderer&) = delete;

    /// Initialise les ressources bgfx (layout, programme shader).
    /// screen_w/screen_h : taille du framebuffer en pixels (matrice ortho).
    /// program : shader sprite compile (ou BGFX_INVALID_HANDLE pour skip rendu).
    void init(uint16_t screen_w, uint16_t screen_h,
              bgfx::ProgramHandle program = BGFX_INVALID_HANDLE);

    /// Libere les ressources bgfx.
    void shutdown();

    /// Met a jour la taille ecran (recalcule la matrice ortho a chaque frame).
    void resize(uint16_t screen_w, uint16_t screen_h) noexcept;

    /// Demarre un batch — vide les sprites en attente.
    void begin();

    /// Ajoute un sprite au batch.
    void draw(const Sprite& s);

    /// Termine le batch et soumet les drawcalls a bgfx.
    void end();

    /// Nombre de sprites accumules dans le batch courant.
    [[nodiscard]] size_t pending() const noexcept { return sprites_.size(); }

private:
    /// Vertex : position ecran (2f) + UV (2f) + couleur ABGR (u32).
    struct Vertex {
        float x, y;
        float u, v;
        uint32_t abgr;
    };

    /// Soumet tous les sprites du meme draw_pass/texture en un seul drawcall.
    void flush_batch(uint8_t pass,
                     bgfx::TextureHandle tex,
                     const Sprite* begin_sprite,
                     size_t count);

    bgfx::VertexLayout   layout_{};
    bgfx::ProgramHandle  program_ = BGFX_INVALID_HANDLE;
    bgfx::UniformHandle  sampler_ = BGFX_INVALID_HANDLE;
    uint16_t             screen_w_ = 0;
    uint16_t             screen_h_ = 0;
    bool                 initialized_ = false;

    std::vector<Sprite> sprites_;
};

} // namespace iecode::render
