#include "iecode/formats/level5/g4mt.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>

namespace iecode::level5 {

// ── Constantes internes (prefixees g4mt_ pour unity build) ──────────

/// Magic "G4MT" en little-endian.
/// MAGIC_G4MT dans types.h = 0x544D3447 = "TM4G" lu en LE.
static constexpr uint32_t G4MT_MAGIC_LE = 0x544D3447;

/// Taille minimale du header G4MT.
static constexpr size_t G4MT_MIN_HEADER_SIZE = 0x20;

/// Stride d'une entree G4MT (4 x uint32 = 16 octets).
static constexpr size_t G4MT_ENTRY_STRIDE = 0x10;

/// Verifie que [offset, offset+len) est dans les bornes.
static bool g4mt_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

std::optional<G4mtFile> g4mt_parse(std::span<const uint8_t> data) {
    if (data.size() < G4MT_MIN_HEADER_SIZE) {
        spdlog::error("g4mt_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4MT_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    // Detection de l'endianness via le magic
    const uint32_t magic_le = iecode::read_u32_le(base);
    const uint32_t magic_be = iecode::read_u32_be(base);
    bool is_big_endian = false;

    if (magic_le == G4MT_MAGIC_LE) {
        is_big_endian = false;
    } else if (magic_be == G4MT_MAGIC_LE) {
        // Si le magic lu en BE correspond au magic LE, c'est du big-endian
        is_big_endian = true;
    } else {
        spdlog::error("g4mt_parse: magic invalide (LE={:#010x}, BE={:#010x})",
                      magic_le, magic_be);
        return std::nullopt;
    }

    // Fonctions de lecture adaptees a l'endianness
    auto read_u16 = [is_big_endian, base](size_t off) -> uint16_t {
        return is_big_endian ? iecode::read_u16_be(base + off)
                             : iecode::read_u16_le(base + off);
    };
    auto read_u32 = [is_big_endian, base](size_t off) -> uint32_t {
        return is_big_endian ? iecode::read_u32_be(base + off)
                             : iecode::read_u32_le(base + off);
    };

    // Lecture du header
    // Le format G4MT a deux variantes de layout :
    //   - Variante "Level-5 standard" : header_size(u16) + version(u16) a 0x04
    //   - Variante "packed" (C# ref) : HeaderSize(i32) a 0x04, Version(i32) a 0x08,
    //     DataSize(i32) a 0x0C, EntryCount(i32) a 0x10, TableOffset(i32) a 0x14
    //
    // On detecte la variante via la valeur a 0x04 : si les 2 octets hauts sont 0,
    // c'est un u16 header_size (variante standard). Sinon, c'est la variante packed.
    G4mtFile result;

    const uint32_t field_04 = read_u32(0x04);
    uint32_t table_offset = 0;

    if ((field_04 & 0xFFFF0000) == 0 && field_04 > 0 && field_04 <= 0x100) {
        // Variante "Level-5 standard" : u16 header_size + u16 version
        result.header_size = static_cast<uint16_t>(field_04 & 0xFFFF);
        result.version     = read_u16(0x06);
        result.entry_count = read_u32(0x10);
        table_offset       = read_u32(0x14);
    } else {
        // Variante "packed" (C# reference) : i32 fields
        result.header_size = static_cast<uint16_t>(field_04 & 0xFFFF);
        result.version     = read_u32(0x08);
        result.entry_count = read_u32(0x10);
        table_offset       = read_u32(0x14);
    }

    // Validation de entry_count
    const size_t max_entries = (data.size() > G4MT_MIN_HEADER_SIZE)
                               ? (data.size() - G4MT_MIN_HEADER_SIZE) / G4MT_ENTRY_STRIDE
                               : 0;
    if (result.entry_count > max_entries) {
        spdlog::warn("g4mt_parse: entry_count ({}) depasse le maximum possible ({}), ajustement",
                     result.entry_count, max_entries);
        result.entry_count = static_cast<uint32_t>(max_entries);
    }

    spdlog::info("g4mt_parse: version={:#x} header_size={:#x} entries={} "
                 "table_offset={:#x} endian={}",
                 result.version, result.header_size, result.entry_count,
                 table_offset, is_big_endian ? "big" : "little");

    if (result.entry_count == 0) {
        spdlog::warn("g4mt_parse: aucune entree dans la table");
        return result;
    }

    // ── Parser les entrees ──────────────────────────────────────────
    // Utiliser table_offset du header si disponible, sinon fallback sur header_size
    const size_t entries_offset = (table_offset > 0)
                                  ? static_cast<size_t>(table_offset)
                                  : (result.header_size > 0)
                                      ? static_cast<size_t>(result.header_size)
                                      : G4MT_MIN_HEADER_SIZE;
    const size_t entries_size = static_cast<size_t>(result.entry_count) * G4MT_ENTRY_STRIDE;

    if (!g4mt_bounds_check(data, entries_offset, entries_size)) {
        spdlog::error("g4mt_parse: table d'entrees hors limites "
                      "(offset={:#x}, taille={})", entries_offset, entries_size);
        // Reduire le nombre d'entrees au lieu de rejeter
        const size_t available = (data.size() > entries_offset)
                                  ? (data.size() - entries_offset) / G4MT_ENTRY_STRIDE
                                  : 0;
        result.entry_count = static_cast<uint32_t>(available);
        if (result.entry_count == 0) return result;
    }

    result.entries.reserve(result.entry_count);

    for (uint32_t i = 0; i < result.entry_count; ++i) {
        const size_t off = entries_offset + static_cast<size_t>(i) * G4MT_ENTRY_STRIDE;

        G4mtEntry entry;
        entry.texture_id  = read_u32(off + 0x00);
        entry.material_id = read_u32(off + 0x04);
        entry.flags       = read_u32(off + 0x08);
        entry.reserved    = read_u32(off + 0x0C);

        spdlog::debug("g4mt_parse: entry[{}] tex_id={:#x} mat_id={:#x} flags={:#x}",
                       i, entry.texture_id, entry.material_id, entry.flags);

        result.entries.push_back(entry);
    }

    spdlog::info("g4mt_parse: {} entree(s) parsee(s) avec succes", result.entries.size());
    return result;
}

} // namespace iecode::level5
