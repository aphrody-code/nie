#include "iecode/formats/level5/g4ra.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>
#include <cstring>
#include <fmt/format.h>

namespace iecode::level5 {

// ── Constantes internes (prefixees g4ra_ pour unity build) ──────────

/// Magic "G4RA" en little-endian.
static constexpr uint32_t G4RA_MAGIC_LE = 0x41523447; // "AR4G" lu en LE

/// Magic "G4RA" en big-endian.
static constexpr uint32_t G4RA_MAGIC_BE = 0x47345241; // "G4RA"

/// Taille minimale du header G4RA.
static constexpr size_t G4RA_MIN_HEADER_SIZE = 0x3C;

/// Stride d'une entree G4RA (0x28 octets).
static constexpr size_t G4RA_ENTRY_STRIDE = 0x28;

/// Verifie que [offset, offset+len) est dans les bornes.
static bool g4ra_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

/// Lit une chaine null-terminee depuis le span.
static std::string g4ra_read_string(std::span<const uint8_t> data, size_t offset) {
    if (offset >= data.size()) return {};
    const auto* start = reinterpret_cast<const char*>(data.data() + offset);
    const size_t max_len = data.size() - offset;
    const size_t len = strnlen(start, max_len);
    return {start, len};
}

std::optional<G4raFile> g4ra_parse(std::span<const uint8_t> data) {
    if (data.size() < G4RA_MIN_HEADER_SIZE) {
        spdlog::error("g4ra_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4RA_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    // Detection de l'endianness via le magic
    const uint32_t magic_le = iecode::read_u32_le(base);
    const uint32_t magic_be = iecode::read_u32_be(base);
    bool is_big_endian = false;

    if (magic_le == G4RA_MAGIC_LE) {
        is_big_endian = false;
    } else if (magic_be == G4RA_MAGIC_BE) {
        is_big_endian = true;
    } else {
        spdlog::error("g4ra_parse: magic invalide (LE={:#010x}, BE={:#010x})",
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
    auto read_i16 = [is_big_endian, base](size_t off) -> int16_t {
        return is_big_endian ? iecode::read_i16_be(base + off)
                             : iecode::read_i16_le(base + off);
    };

    // Lecture du header
    G4raFile result;
    const uint16_t header_size = read_u16(0x04);
    result.version = read_u16(0x06);
    result.entry_table_offset = read_u32(0x10);
    result.entry_count = read_u32(0x14);
    result.string_table_offset = read_u32(0x18);
    result.string_table_size = read_u32(0x1C);
    result.active_count = read_i16(0x32);

    spdlog::info("g4ra_parse: version={} entries={} header_size={:#x} "
                 "entry_table={:#x} string_table={:#x} endian={}",
                 result.version, result.entry_count, header_size,
                 result.entry_table_offset, result.string_table_offset,
                 is_big_endian ? "big" : "little");

    if (result.entry_count == 0) {
        spdlog::warn("g4ra_parse: archive vide (0 entrees)");
        return result;
    }

    // Parser les entrees
    if (result.entry_table_offset == 0) {
        spdlog::warn("g4ra_parse: pas de table d'entrees (offset=0)");
        return result;
    }

    const size_t entry_table_size = static_cast<size_t>(result.entry_count) * G4RA_ENTRY_STRIDE;
    if (!g4ra_bounds_check(data, result.entry_table_offset, entry_table_size)) {
        spdlog::error("g4ra_parse: table d'entrees hors limites "
                      "(offset={:#x}, taille={}, fichier={})",
                      result.entry_table_offset, entry_table_size, data.size());
        return std::nullopt;
    }

    result.entries.reserve(result.entry_count);

    for (uint32_t i = 0; i < result.entry_count; ++i) {
        const size_t entry_off = result.entry_table_offset +
                                 static_cast<size_t>(i) * G4RA_ENTRY_STRIDE;

        G4raEntry entry;
        entry.index = static_cast<int>(i);

        // Offset 0x18 dans l'entree : offset/taille de la ressource
        // Le C# reference lit ce champ comme "ResourceOffset" — c'est un offset
        // relatif au fichier, pas une taille. La taille est determinee a
        // l'extraction (par la difference entre offsets consecutifs ou par le
        // format interne).
        entry.offset = read_u32(entry_off + 0x18);

        // Calculer la taille par la difference avec l'entree suivante
        // (sera ajustee apres la boucle pour la derniere entree)
        entry.size = 0;

        // Offset 0x20 : ref count
        entry.ref_count = read_u16(entry_off + 0x20);

        // Offset 0x25 : flags d'activite
        if (g4ra_bounds_check(data, entry_off + 0x25, 1)) {
            entry.flags = base[entry_off + 0x25];
        }

        // Nom depuis la string table (table d'offsets de 4 octets par entree)
        if (result.string_table_offset > 0 &&
            g4ra_bounds_check(data, result.string_table_offset + i * 4, 4)) {
            const int32_t name_offset = is_big_endian
                ? iecode::read_i32_be(base + result.string_table_offset + i * 4)
                : iecode::read_i32_le(base + result.string_table_offset + i * 4);

            if (name_offset > 0 && static_cast<size_t>(name_offset) < data.size()) {
                entry.name = g4ra_read_string(data, static_cast<size_t>(name_offset));
            }
        }

        // Nom par defaut si vide
        if (entry.name.empty()) {
            entry.name = fmt::format("resource_{:04d}", i);
        }

        spdlog::debug("g4ra_parse: entry[{}] name='{}' offset={:#x} ref_count={} flags={:#x}",
                       i, entry.name, entry.offset, entry.ref_count, entry.flags);

        result.entries.push_back(std::move(entry));
    }

    // Calculer les tailles par difference d'offsets consecutifs
    for (size_t i = 0; i + 1 < result.entries.size(); ++i) {
        if (result.entries[i + 1].offset > result.entries[i].offset) {
            result.entries[i].size = result.entries[i + 1].offset - result.entries[i].offset;
        }
    }
    // Derniere entree : taille = fin du fichier - offset
    if (!result.entries.empty()) {
        auto& last = result.entries.back();
        if (last.offset < data.size()) {
            last.size = static_cast<uint32_t>(data.size() - last.offset);
        }
    }

    spdlog::info("g4ra_parse: {} entree(s) parsee(s) avec succes", result.entries.size());
    return result;
}

} // namespace iecode::level5
