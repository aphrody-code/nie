#pragma once

/// @file res_texture.h
/// Ressource texture GPU — pont entre parsers Level-5 G4TX/G4TG et bgfx.
/// Traduit les formats de pixels Level-5 vers bgfx::TextureFormat (BC1/BC3/BC7/RGBA8).

#include "iecode/formats/level5/g4tg.h"
#include "iecode/formats/level5/g4tx.h"

#include <bgfx/bgfx.h>

#include <cstdint>
#include <optional>

namespace iecode::render {

/// Ressource texture 2D prete a etre soumise au GPU via bgfx.
/// Encapsule un handle bgfx + metadonnees de base. Move-only.
struct ResTexture {
    bgfx::TextureHandle handle = BGFX_INVALID_HANDLE;
    uint16_t width  = 0;
    uint16_t height = 0;
    uint8_t  mips   = 0;

    ResTexture() = default;
    ResTexture(const ResTexture&)            = delete;
    ResTexture& operator=(const ResTexture&) = delete;
    ResTexture(ResTexture&& other) noexcept;
    ResTexture& operator=(ResTexture&& other) noexcept;
    ~ResTexture();

    /// Libere le handle bgfx et reset les champs.
    void destroy();

    /// Indique si la texture est valide (handle bgfx valide).
    [[nodiscard]] bool valid() const noexcept { return bgfx::isValid(handle); }

    // ── Factory ──────────────────────────────────────────────────────

    /// Cree une texture bgfx a partir d'un G4TX (utilise la premiere texture).
    /// Les donnees pixel sont copiees dans un buffer bgfx::copy().
    [[nodiscard]] static std::optional<ResTexture> from_g4tx(
        const level5::G4txFile& tx);

    /// Cree une texture a partir d'un G4TX + companion G4TG (donnees GPU brutes).
    /// Le G4TG contient les donnees de subresource/mip tail (BCn stream).
    [[nodiscard]] static std::optional<ResTexture> from_g4tx_with_gpu(
        const level5::G4txFile& tx, const level5::G4Tg& tg);

    // ── Helpers ──────────────────────────────────────────────────────

    /// Traduit un G4txFormat en bgfx::TextureFormat.
    /// Retourne bgfx::TextureFormat::Unknown pour les formats non supportes.
    [[nodiscard]] static bgfx::TextureFormat::Enum translate_format(
        level5::G4txFormat fmt) noexcept;
};

} // namespace iecode::render
