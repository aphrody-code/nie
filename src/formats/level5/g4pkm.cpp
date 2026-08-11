#include "iecode/formats/level5/g4pkm.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>
#include <cstring>

namespace iecode::level5 {

/// Magic "G4PK" en little-endian (identique a G4PK).
static constexpr uint32_t G4PKM_MAGIC_LE = 0x4B503447;

/// Taille canonique du header G4PKM.
static constexpr size_t G4PKM_HEADER_SIZE = 0x64;

/// Offset de la zone de noms embedded.
static constexpr size_t G4PKM_NAME_POOL_OFFSET = 0x60;

static bool g4pkm_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

static std::string g4pkm_read_string(std::span<const uint8_t> data, size_t offset) {
    if (offset >= data.size()) return {};
    const auto* start = reinterpret_cast<const char*>(data.data() + offset);
    const size_t max_len = data.size() - offset;
    const size_t len = strnlen(start, max_len);
    return {start, len};
}

std::optional<G4pkmFile> g4pkm_parse(std::span<const uint8_t> data) {
    if (data.size() < G4PKM_HEADER_SIZE) {
        spdlog::error("g4pkm_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4PKM_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    const uint32_t magic = iecode::read_u32_le(base);
    if (magic != G4PKM_MAGIC_LE) {
        spdlog::error("g4pkm_parse: magic invalide ({:#010x})", magic);
        return std::nullopt;
    }

    G4pkmFile result;
    result.header_size  = iecode::read_u16_le(base + 0x04);
    result.file_type    = iecode::read_u16_le(base + 0x06);
    result.version      = iecode::read_u32_le(base + 0x08);
    result.content_size = iecode::read_u32_le(base + 0x0C);
    result.entry_count  = iecode::read_u32_le(base + 0x20);

    spdlog::info("g4pkm_parse: header_size={:#x} version={:#x} entries={}",
                 result.header_size, result.version, result.entry_count);

    if (result.entry_count == 0) {
        return result;
    }

    // Table d'offsets et table de tailles (entry_count x 4 octets chacune)
    const size_t offset_table = result.header_size;
    const size_t size_table   = offset_table + static_cast<size_t>(result.entry_count) * 4;

    if (!g4pkm_bounds_check(data, offset_table,
                            static_cast<size_t>(result.entry_count) * 8)) {
        spdlog::error("g4pkm_parse: tables d'offsets/tailles hors limites");
        return std::nullopt;
    }

    // Lecture des noms embedded depuis +0x60 (ASCII null-terminated)
    std::vector<std::string> names;
    size_t name_cursor = G4PKM_NAME_POOL_OFFSET;
    for (uint32_t i = 0; i < result.entry_count && name_cursor < result.header_size; ++i) {
        auto name = g4pkm_read_string(data, name_cursor);
        if (name.empty()) break;
        name_cursor += name.size() + 1;
        names.push_back(std::move(name));
    }

    result.entries.reserve(result.entry_count);
    for (uint32_t i = 0; i < result.entry_count; ++i) {
        G4pkmEntry entry;
        const auto rel_offset = iecode::read_u32_le(base + offset_table + i * 4);
        entry.size   = iecode::read_u32_le(base + size_table   + i * 4);
        entry.offset = static_cast<uint32_t>(result.header_size) + (rel_offset << 2);

        if (i < names.size()) {
            entry.name = names[i];
        } else {
            entry.name = "file_" + std::to_string(i);
        }

        spdlog::debug("g4pkm_parse: entry[{}] name='{}' offset={:#x} size={}",
                       i, entry.name, entry.offset, entry.size);

        result.entries.push_back(std::move(entry));
    }

    return result;
}

std::span<const uint8_t> g4pkm_extract_entry(
    std::span<const uint8_t> archive_data,
    const G4pkmEntry& entry) {

    if (entry.size == 0) return {};

    const auto end = static_cast<size_t>(entry.offset) + static_cast<size_t>(entry.size);
    if (end > archive_data.size() || end < entry.offset) {
        spdlog::error("g4pkm_extract_entry: '{}' hors limites", entry.name);
        return {};
    }
    return archive_data.subspan(entry.offset, entry.size);
}

} // namespace iecode::level5
