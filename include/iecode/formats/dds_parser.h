#pragma once

/// @file dds_parser.h
/// Parser DDS standalone (header + decompression BCn).
/// Complement leger a DirectXTex pour inspection rapide et detection de format.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::formats {

// ── Constantes DDS ─────────────────────────────────────────────────

/// Magic "DDS " (little-endian).
inline constexpr uint32_t DDS_MAGIC = 0x20534444;

/// Taille du header DDS (magic 4 + struct 124 = 128 octets).
inline constexpr size_t DDS_HEADER_TOTAL_SIZE = 128;

/// Taille de la struct DDS_HEADER (sans le magic).
inline constexpr size_t DDS_HEADER_STRUCT_SIZE = 124;

/// Taille de la struct DDS_PIXELFORMAT.
inline constexpr size_t DDS_PIXELFORMAT_SIZE = 32;

// ── Flags DDS connus ───────────────────────────────────────────────

/// DDPF_FOURCC — le champ pf_fourcc est valide.
inline constexpr uint32_t DDPF_FOURCC = 0x4;

/// DDPF_RGB — format non-compresse avec masques RGB.
inline constexpr uint32_t DDPF_RGB = 0x40;

/// DDPF_LUMINANCE — format luminance (grayscale).
inline constexpr uint32_t DDPF_LUMINANCE = 0x20000;

/// DDPF_ALPHAPIXELS — canal alpha present.
inline constexpr uint32_t DDPF_ALPHAPIXELS = 0x1;

// ── FourCC connus ──────────────────────────────────────────────────

inline constexpr uint32_t FOURCC_DXT1 = 0x31545844; // "DXT1"
inline constexpr uint32_t FOURCC_DXT3 = 0x33545844; // "DXT3"
inline constexpr uint32_t FOURCC_DXT5 = 0x35545844; // "DXT5"
inline constexpr uint32_t FOURCC_ATI1 = 0x31495441; // "ATI1" (BC4)
inline constexpr uint32_t FOURCC_ATI2 = 0x32495441; // "ATI2" (BC5)
inline constexpr uint32_t FOURCC_DX10 = 0x30315844; // "DX10"

// ── Header DDS ─────────────────────────────────────────────────────

/// Header DDS parse depuis les 128 premiers octets d'un fichier DDS.
/// Layout fidele a la specification Microsoft DirectDraw Surface.
struct DdsHeader {
    uint32_t magic = 0;              // "DDS " = 0x20534444
    uint32_t size = 0;               // 124
    uint32_t flags = 0;
    uint32_t height = 0;
    uint32_t width = 0;
    uint32_t pitch_or_linear_size = 0;
    uint32_t depth = 0;
    uint32_t mipmap_count = 0;
    // reserved[11] — ignore au parsing
    // Pixel format (32 octets)
    uint32_t pf_size = 0;            // 32
    uint32_t pf_flags = 0;
    uint32_t pf_fourcc = 0;          // "DXT1", "DXT3", "DXT5", etc.
    uint32_t pf_rgb_bit_count = 0;
    uint32_t pf_r_mask = 0;
    uint32_t pf_g_mask = 0;
    uint32_t pf_b_mask = 0;
    uint32_t pf_a_mask = 0;
    // Caps
    uint32_t caps1 = 0;
    uint32_t caps2 = 0;

    /// True si le format utilise un FourCC (compresse).
    [[nodiscard]] constexpr bool has_fourcc() const noexcept {
        return (pf_flags & DDPF_FOURCC) != 0;
    }

    /// True si le format est DXT1/BC1.
    [[nodiscard]] constexpr bool is_bc1() const noexcept {
        return has_fourcc() && pf_fourcc == FOURCC_DXT1;
    }

    /// True si le format est DXT3/BC2.
    [[nodiscard]] constexpr bool is_bc2() const noexcept {
        return has_fourcc() && pf_fourcc == FOURCC_DXT3;
    }

    /// True si le format est DXT5/BC3.
    [[nodiscard]] constexpr bool is_bc3() const noexcept {
        return has_fourcc() && pf_fourcc == FOURCC_DXT5;
    }

    /// True si le header contient une extension DX10.
    [[nodiscard]] constexpr bool has_dx10_extension() const noexcept {
        return has_fourcc() && pf_fourcc == FOURCC_DX10;
    }

    /// Taille des donnees texture (apres le header) estimee.
    [[nodiscard]] uint32_t data_offset() const noexcept {
        return has_dx10_extension() ? 148 : 128;
    }
};

// ── Fonctions publiques ────────────────────────────────────────────

/// Detecte si les donnees commencent par le magic DDS.
[[nodiscard]] bool dds_is_valid(std::span<const uint8_t> data);

/// Parse un fichier DDS et retourne le header.
/// Retourne std::nullopt si les donnees sont invalides ou trop courtes.
[[nodiscard]] std::optional<DdsHeader> dds_parse_header(std::span<const uint8_t> data);

/// Retourne un span sur les donnees pixel (apres le header DDS).
/// Retourne un span vide si les donnees sont invalides.
[[nodiscard]] std::span<const uint8_t> dds_pixel_data(std::span<const uint8_t> data);

/// Decompresse les pixels DXT1 (BC1) en RGBA32.
/// @param block_data donnees compressees (8 octets par bloc 4x4)
/// @param width largeur en pixels (doit etre > 0)
/// @param height hauteur en pixels (doit etre > 0)
/// @return buffer RGBA8 (width * height * 4 octets) ou vide en cas d'erreur
[[nodiscard]] std::vector<uint8_t> dds_decompress_bc1(
    std::span<const uint8_t> block_data, uint32_t width, uint32_t height);

/// Decompresse les pixels DXT5 (BC3) en RGBA32.
/// @param block_data donnees compressees (16 octets par bloc 4x4)
/// @param width largeur en pixels (doit etre > 0)
/// @param height hauteur en pixels (doit etre > 0)
/// @return buffer RGBA8 (width * height * 4 octets) ou vide en cas d'erreur
[[nodiscard]] std::vector<uint8_t> dds_decompress_bc3(
    std::span<const uint8_t> block_data, uint32_t width, uint32_t height);

/// Retourne le FourCC sous forme de string ("DXT1", "DXT5", "DX10", etc.).
/// Pour les FourCC non-ASCII, retourne la representation hexadecimale.
[[nodiscard]] std::string dds_fourcc_to_string(uint32_t fourcc);

} // namespace iecode::formats
