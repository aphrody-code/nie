#include "iecode/formats/level5/agi.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>
#include <cstring>

namespace iecode::level5 {

// ── Constantes internes (prefixees agi_ pour unity build) ───────────

/// Magic pour le format AGI little-endian : fichier contient ".IGA" (0x2E, 0x49, 0x47, 0x41),
/// lu en u32 LE = 0x4147492E. Confirme par FormatDetector.cs : isBigEndian=false.
static constexpr uint32_t AGI_MAGIC_LE = 0x4147492E;

/// Magic pour le format AGI big-endian : fichier contient "AGI." (0x41, 0x47, 0x49, 0x2E),
/// lu en u32 LE = 0x2E494741. Confirme par FormatDetector.cs : isBigEndian=true.
static constexpr uint32_t AGI_MAGIC_BE = 0x2E494741;

/// Taille minimale pour le header de base.
static constexpr size_t AGI_MIN_HEADER_SIZE = 0x20;

/// Lit un float depuis les donnees avec l'endianness appropriee.
static float agi_read_float(const uint8_t* p, bool is_big_endian) {
    uint32_t bits = is_big_endian ? iecode::read_u32_be(p) : iecode::read_u32_le(p);
    float result = 0.0f;
    std::memcpy(&result, &bits, sizeof(float));
    return result;
}

/// Verifie que [offset, offset+len) est dans les bornes.
static bool agi_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

std::optional<AgiFile> agi_parse(std::span<const uint8_t> data) {
    if (data.size() < AGI_MIN_HEADER_SIZE) {
        spdlog::error("agi_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), AGI_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    // Detection de l'endianness via le magic.
    // On lit toujours les 4 premiers octets en LE et on compare aux constantes.
    // AGI_MAGIC_LE (0x4147492E) = fichier ".IGA" -> format LE
    // AGI_MAGIC_BE (0x2E494741) = fichier "AGI." -> format BE
    const uint32_t magic_val = iecode::read_u32_le(base);
    bool is_big_endian = false;

    if (magic_val == AGI_MAGIC_LE) {
        is_big_endian = false;
    } else if (magic_val == AGI_MAGIC_BE) {
        is_big_endian = true;
    } else {
        spdlog::error("agi_parse: magic invalide ({:#010x})", magic_val);
        return std::nullopt;
    }

    // Fonctions de lecture adaptees a l'endianness
    auto read_u32 = [is_big_endian, base](size_t off) -> uint32_t {
        return is_big_endian ? iecode::read_u32_be(base + off)
                             : iecode::read_u32_le(base + off);
    };

    // Lecture du header de base
    AgiFile result;
    result.version     = read_u32(0x04);
    result.flags       = read_u32(0x08);
    result.data_size   = read_u32(0x0C);
    result.frame_count = read_u32(0x10);
    result.duration    = agi_read_float(base + 0x14, is_big_endian);
    result.track_count = read_u32(0x18);
    result.event_count = read_u32(0x1C);
    result.is_big_endian = is_big_endian;

    spdlog::info("agi_parse: version={:#x} frames={} duration={:.2f}s "
                 "tracks={} events={} endian={}",
                 result.version, result.frame_count, result.duration,
                 result.track_count, result.event_count,
                 is_big_endian ? "big" : "little");

    // ── Parser le transform (offset 0x50-0x60) ─────────────────────
    if (agi_bounds_check(data, 0x50, 0x11)) {
        result.transform.x      = agi_read_float(base + 0x50, is_big_endian);
        result.transform.y      = agi_read_float(base + 0x54, is_big_endian);
        result.transform.width  = agi_read_float(base + 0x58, is_big_endian);
        result.transform.height = agi_read_float(base + 0x5C, is_big_endian);
        result.transform.flags  = base[0x60];

        spdlog::debug("agi_parse: transform pos=({:.2f}, {:.2f}) size={:.2f}x{:.2f} flags={:#x}",
                       result.transform.x, result.transform.y,
                       result.transform.width, result.transform.height,
                       result.transform.flags);
    }

    // ── Parser les bounds (offset 0x70-0x84) ────────────────────────
    if (agi_bounds_check(data, 0x70, 0x18)) {
        result.bounds.left         = agi_read_float(base + 0x70, is_big_endian);
        result.bounds.top          = agi_read_float(base + 0x74, is_big_endian);
        result.bounds.right        = agi_read_float(base + 0x78, is_big_endian);
        result.bounds.bottom       = agi_read_float(base + 0x7C, is_big_endian);
        result.bounds.bounds_flags = read_u32(0x80);

        spdlog::debug("agi_parse: bounds L={:.2f} T={:.2f} R={:.2f} B={:.2f}",
                       result.bounds.left, result.bounds.top,
                       result.bounds.right, result.bounds.bottom);
    }

    // ── Parser les facteurs d'echelle (offset 0xC0-0xCC) ───────────
    if (agi_bounds_check(data, 0xC0, 0x10)) {
        result.scale.scale_x = agi_read_float(base + 0xC0, is_big_endian);
        result.scale.scale_y = agi_read_float(base + 0xC4, is_big_endian);
        result.scale.scale_z = agi_read_float(base + 0xC8, is_big_endian);
        result.scale.factor  = agi_read_float(base + 0xCC, is_big_endian);

        spdlog::debug("agi_parse: scale ({:.2f}, {:.2f}, {:.2f}) factor={:.2f}",
                       result.scale.scale_x, result.scale.scale_y,
                       result.scale.scale_z, result.scale.factor);
    }
    // Si les donnees sont trop courtes pour les echelles, les valeurs par
    // defaut (1.0, 1.0, 1.0, 0.1) restent en place dans la struct.

    spdlog::info("agi_parse: fichier AGI parse avec succes "
                 "(frames={}, tracks={})", result.frame_count, result.track_count);
    return result;
}

} // namespace iecode::level5
