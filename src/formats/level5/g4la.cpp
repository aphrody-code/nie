#include "iecode/formats/level5/g4la.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>

namespace iecode::level5 {

// ── Constantes internes ─────────────────────────────────────────────

/// Taille minimale du header G4xx.
static constexpr size_t G4XX_MIN_HEADER_SIZE = 0x10;

/// Taille canonique du header G4xx (pattern G4LA/G4MA/G4VS).
static constexpr size_t G4XX_CANONICAL_HEADER_SIZE = 0x68;

std::optional<G4xxContainer> g4xx_parse(
    std::span<const uint8_t> data, uint32_t expected_magic) {

    if (data.size() < G4XX_MIN_HEADER_SIZE) {
        spdlog::error("g4xx_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4XX_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    const uint32_t magic = iecode::read_u32_le(base);
    if (magic != expected_magic) {
        spdlog::error("g4xx_parse: magic invalide ({:#010x}, attendu {:#010x})",
                      magic, expected_magic);
        return std::nullopt;
    }

    G4xxContainer result;
    result.magic           = magic;
    result.flags           = iecode::read_u16_le(base + 0x04);
    result.header_size     = iecode::read_u16_le(base + 0x06);
    result.section_offset  = iecode::read_u16_le(base + 0x0A);
    result.data_size       = iecode::read_u32_le(base + 0x0C);
    result.raw             = data;

    spdlog::info("g4xx_parse: magic={:#010x} header_size={:#x} data_size={} section_offset={:#x}",
                 result.magic, result.header_size, result.data_size, result.section_offset);

    // Parse la section table : uint16 pairs (offset, size)
    // jusqu'a la fin du header (header_size) — borne defensive.
    const size_t table_start = result.section_offset;
    const size_t table_end = result.header_size != 0
                                 ? static_cast<size_t>(result.header_size)
                                 : G4XX_CANONICAL_HEADER_SIZE;

    if (table_start >= data.size() || table_end <= table_start) {
        return result;
    }

    const size_t table_max = std::min(table_end, data.size());
    for (size_t off = table_start; off + 4 <= table_max; off += 4) {
        G4xxSection section;
        section.offset = iecode::read_u16_le(base + off);
        section.size   = iecode::read_u16_le(base + off + 2);
        if (section.offset == 0 && section.size == 0) {
            break;
        }
        result.sections.push_back(section);
    }

    return result;
}

} // namespace iecode::level5
