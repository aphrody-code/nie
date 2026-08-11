/// @file sprite_renderer.cpp
/// Implementation du renderer 2D via bgfx transient buffers.
/// Trie les sprites par (draw_pass, texture) puis emet un drawcall par batch.

#include "iecode/render/sprite_renderer.h"

#include <bgfx/bgfx.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstring>

namespace iecode::render {

namespace {

/// Construit une matrice orthographique 2D (haut-gauche origine).
/// Suit la convention bgfx (D3D/GL homogeneise via bgfx::setViewTransform).
void make_ortho_2d(float* out, float w, float h) noexcept {
    // Matrice column-major 4x4 : origin top-left, y vers le bas.
    // x : [0, w] -> [-1, 1]
    // y : [0, h] -> [ 1,-1]
    std::memset(out, 0, sizeof(float) * 16);
    out[0]  =  2.f / w;
    out[5]  = -2.f / h;
    out[10] =  1.f;
    out[12] = -1.f;
    out[13] =  1.f;
    out[15] =  1.f;
}

/// Multiplie canal alpha d'une couleur ABGR par un facteur [0,1].
[[nodiscard]] uint32_t apply_alpha(uint32_t abgr, float alpha) noexcept {
    const uint32_t a = static_cast<uint32_t>(((abgr >> 24) & 0xFFu) * alpha) & 0xFFu;
    return (abgr & 0x00FFFFFFu) | (a << 24);
}

} // namespace

// ── Cycle de vie ────────────────────────────────────────────────────

SpriteRenderer::~SpriteRenderer() { shutdown(); }

void SpriteRenderer::init(uint16_t screen_w, uint16_t screen_h,
                          bgfx::ProgramHandle program) {
    if (initialized_) return;

    layout_
        .begin()
        .add(bgfx::Attrib::Position,  2, bgfx::AttribType::Float)
        .add(bgfx::Attrib::TexCoord0, 2, bgfx::AttribType::Float)
        .add(bgfx::Attrib::Color0,    4, bgfx::AttribType::Uint8, /*normalized=*/true)
        .end();

    program_ = program;
    sampler_ = bgfx::createUniform("s_texColor", bgfx::UniformType::Sampler);

    screen_w_ = screen_w;
    screen_h_ = screen_h;
    initialized_ = true;

    sprites_.reserve(256);
}

void SpriteRenderer::shutdown() {
    if (!initialized_) return;
    if (bgfx::isValid(sampler_)) {
        bgfx::destroy(sampler_);
        sampler_ = BGFX_INVALID_HANDLE;
    }
    // Note : program_ est fourni par l'exterieur, pas owned.
    program_ = BGFX_INVALID_HANDLE;
    sprites_.clear();
    initialized_ = false;
}

void SpriteRenderer::resize(uint16_t screen_w, uint16_t screen_h) noexcept {
    screen_w_ = screen_w;
    screen_h_ = screen_h;
}

// ── Batching ────────────────────────────────────────────────────────

void SpriteRenderer::begin() {
    sprites_.clear();
}

void SpriteRenderer::draw(const Sprite& s) {
    if (!bgfx::isValid(s.texture)) return;
    if (s.w <= 0.f || s.h <= 0.f) return;
    sprites_.push_back(s);
}

void SpriteRenderer::end() {
    if (!initialized_ || sprites_.empty()) return;

    // Tri stable par (draw_pass, texture.idx) pour preserver l'ordre de soumission
    // des sprites du meme batch (important pour le blending UI).
    std::stable_sort(sprites_.begin(), sprites_.end(),
        [](const Sprite& a, const Sprite& b) {
            if (a.draw_pass != b.draw_pass) return a.draw_pass < b.draw_pass;
            return a.texture.idx < b.texture.idx;
        });

    // Matrice ortho appliquee a chaque view id utilisee par ce batch.
    float proj[16];
    make_ortho_2d(proj, static_cast<float>(screen_w_), static_cast<float>(screen_h_));

    size_t i = 0;
    uint8_t  last_pass = 0xFF;
    while (i < sprites_.size()) {
        const uint8_t pass = sprites_[i].draw_pass;
        const bgfx::TextureHandle tex = sprites_[i].texture;

        size_t j = i + 1;
        while (j < sprites_.size()
               && sprites_[j].draw_pass == pass
               && sprites_[j].texture.idx == tex.idx) {
            ++j;
        }

        if (pass != last_pass) {
            bgfx::setViewTransform(pass, nullptr, proj);
            bgfx::setViewRect(pass, 0, 0, screen_w_, screen_h_);
            last_pass = pass;
        }

        flush_batch(pass, tex, &sprites_[i], j - i);
        i = j;
    }

    sprites_.clear();
}

// ── Submit d'un batch ──────────────────────────────────────────────

void SpriteRenderer::flush_batch(uint8_t pass,
                                 bgfx::TextureHandle tex,
                                 const Sprite* begin_sprite,
                                 size_t count) {
    if (count == 0) return;
    if (!bgfx::isValid(program_)) {
        // Pas de shader : on skippe silencieusement (le GUI tourne en headless test).
        return;
    }

    const uint32_t num_vertices = static_cast<uint32_t>(count * 4);
    const uint32_t num_indices  = static_cast<uint32_t>(count * 6);

    bgfx::TransientVertexBuffer tvb{};
    bgfx::TransientIndexBuffer  tib{};
    if (bgfx::getAvailTransientVertexBuffer(num_vertices, layout_) < num_vertices
     || bgfx::getAvailTransientIndexBuffer(num_indices) < num_indices) {
        spdlog::warn("SpriteRenderer: transient buffer overflow ({} sprites)", count);
        return;
    }
    bgfx::allocTransientVertexBuffer(&tvb, num_vertices, layout_);
    bgfx::allocTransientIndexBuffer(&tib, num_indices);

    auto* verts = reinterpret_cast<Vertex*>(tvb.data);
    auto* idx   = reinterpret_cast<uint16_t*>(tib.data);

    for (size_t n = 0; n < count; ++n) {
        const Sprite& s = begin_sprite[n];
        const uint32_t color = apply_alpha(s.tint, s.alpha);

        const float x0 = s.x;
        const float y0 = s.y;
        const float x1 = s.x + s.w;
        const float y1 = s.y + s.h;

        Vertex* v = verts + n * 4;
        v[0] = {x0, y0, s.u0, s.v0, color};
        v[1] = {x1, y0, s.u1, s.v0, color};
        v[2] = {x1, y1, s.u1, s.v1, color};
        v[3] = {x0, y1, s.u0, s.v1, color};

        const uint16_t base = static_cast<uint16_t>(n * 4);
        uint16_t* ix = idx + n * 6;
        ix[0] = base + 0;
        ix[1] = base + 1;
        ix[2] = base + 2;
        ix[3] = base + 0;
        ix[4] = base + 2;
        ix[5] = base + 3;
    }

    bgfx::setVertexBuffer(0, &tvb, 0, num_vertices);
    bgfx::setIndexBuffer(&tib, 0, num_indices);
    bgfx::setTexture(0, sampler_, tex);
    bgfx::setState(
        BGFX_STATE_WRITE_RGB
      | BGFX_STATE_WRITE_A
      | BGFX_STATE_BLEND_FUNC(BGFX_STATE_BLEND_SRC_ALPHA, BGFX_STATE_BLEND_INV_SRC_ALPHA)
      | BGFX_STATE_MSAA);
    bgfx::submit(pass, program_);
}

} // namespace iecode::render
