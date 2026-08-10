/// @file res_texture.cpp
/// Pont G4TX/G4TG -> bgfx::TextureHandle.
/// Supporte BC1/BC2/BC3/BC4/BC5/BC6H/BC7/RGBA8 — les formats utilises par IEVR.

#include "iecode/render/res_texture.h"

#include <spdlog/spdlog.h>

#include <cstring>
#include <utility>

namespace iecode::render {

// ── RAII ────────────────────────────────────────────────────────────

ResTexture::ResTexture(ResTexture&& other) noexcept
    : handle(other.handle), width(other.width), height(other.height), mips(other.mips) {
    other.handle = BGFX_INVALID_HANDLE;
    other.width = other.height = 0;
    other.mips = 0;
}

ResTexture& ResTexture::operator=(ResTexture&& other) noexcept {
    if (this != &other) {
        destroy();
        handle = other.handle;
        width  = other.width;
        height = other.height;
        mips   = other.mips;
        other.handle = BGFX_INVALID_HANDLE;
        other.width = other.height = 0;
        other.mips = 0;
    }
    return *this;
}

ResTexture::~ResTexture() { destroy(); }

void ResTexture::destroy() {
    if (bgfx::isValid(handle)) {
        bgfx::destroy(handle);
        handle = BGFX_INVALID_HANDLE;
    }
    width = height = 0;
    mips = 0;
}

// ── Translation de format ───────────────────────────────────────────

bgfx::TextureFormat::Enum ResTexture::translate_format(level5::G4txFormat fmt) noexcept {
    using F = level5::G4txFormat;
    switch (fmt) {
        case F::BC1:   return bgfx::TextureFormat::BC1;
        case F::BC2:   return bgfx::TextureFormat::BC2;
        case F::BC3:   return bgfx::TextureFormat::BC3;
        case F::BC4:   return bgfx::TextureFormat::BC4;
        case F::BC5:   return bgfx::TextureFormat::BC5;
        case F::BC6H:  return bgfx::TextureFormat::BC6H;
        case F::BC7:   return bgfx::TextureFormat::BC7;
        case F::RGBA8: return bgfx::TextureFormat::RGBA8;
        default:       return bgfx::TextureFormat::Unknown;
    }
}

// ── Helpers internes ────────────────────────────────────────────────

namespace {

/// Cree un bgfx::TextureHandle 2D a partir d'un buffer de pixels copie.
[[nodiscard]] bgfx::TextureHandle create_texture_2d(
    uint16_t width,
    uint16_t height,
    uint8_t mips,
    bgfx::TextureFormat::Enum fmt,
    const void* data,
    uint32_t data_size) {

    if (width == 0 || height == 0 || data == nullptr || data_size == 0) {
        spdlog::error("ResTexture: parametres invalides (w={}, h={}, size={})",
                      width, height, data_size);
        return BGFX_INVALID_HANDLE;
    }

    const bgfx::Memory* mem = bgfx::copy(data, data_size);
    if (mem == nullptr) {
        spdlog::error("ResTexture: bgfx::copy a echoue");
        return BGFX_INVALID_HANDLE;
    }

    const bool has_mips = mips > 1;
    bgfx::TextureHandle h = bgfx::createTexture2D(
        width,
        height,
        has_mips,
        /*numLayers=*/1,
        fmt,
        BGFX_TEXTURE_NONE | BGFX_SAMPLER_NONE,
        mem);

    if (!bgfx::isValid(h)) {
        spdlog::error("ResTexture: bgfx::createTexture2D a echoue ({}x{}, fmt={})",
                      width, height, static_cast<int>(fmt));
    }
    return h;
}

} // namespace

// ── Factories ───────────────────────────────────────────────────────

std::optional<ResTexture> ResTexture::from_g4tx(const level5::G4txFile& tx) {
    if (tx.textures.empty()) {
        spdlog::warn("ResTexture::from_g4tx: G4TX sans textures");
        return std::nullopt;
    }

    const auto& src = tx.textures.front();
    const auto fmt = translate_format(src.format);
    if (fmt == bgfx::TextureFormat::Unknown) {
        spdlog::error("ResTexture::from_g4tx: format non supporte ({})",
                      static_cast<uint32_t>(src.format));
        return std::nullopt;
    }

    if (src.data.empty()) {
        spdlog::error("ResTexture::from_g4tx: buffer pixels vide ({})", src.name);
        return std::nullopt;
    }

    bgfx::TextureHandle h = create_texture_2d(
        src.width, src.height, src.mip_count, fmt,
        src.data.data(), static_cast<uint32_t>(src.data.size()));
    if (!bgfx::isValid(h)) return std::nullopt;

    ResTexture out;
    out.handle = h;
    out.width  = src.width;
    out.height = src.height;
    out.mips   = src.mip_count;
    return out;
}

std::optional<ResTexture> ResTexture::from_g4tx_with_gpu(
    const level5::G4txFile& tx, const level5::G4Tg& tg) {

    if (tx.textures.empty()) {
        spdlog::warn("ResTexture::from_g4tx_with_gpu: G4TX sans textures");
        return std::nullopt;
    }
    if (tg.gpu_data.empty()) {
        // Fallback : pas de donnees GPU companion, on retombe sur le G4TX.
        return from_g4tx(tx);
    }

    const auto& src = tx.textures.front();
    const auto fmt = translate_format(src.format);
    if (fmt == bgfx::TextureFormat::Unknown) {
        spdlog::error("ResTexture::from_g4tx_with_gpu: format non supporte ({})",
                      static_cast<uint32_t>(src.format));
        return std::nullopt;
    }

    bgfx::TextureHandle h = create_texture_2d(
        src.width, src.height, src.mip_count, fmt,
        tg.gpu_data.data(), static_cast<uint32_t>(tg.gpu_data.size()));
    if (!bgfx::isValid(h)) return std::nullopt;

    ResTexture out;
    out.handle = h;
    out.width  = src.width;
    out.height = src.height;
    out.mips   = src.mip_count;
    return out;
}

} // namespace iecode::render
