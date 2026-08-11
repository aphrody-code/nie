#include "iecode/formats/level5/g4pk.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>
#include <fmt/format.h>
#include <cstring>
#include <fstream>

namespace iecode::level5 {

// ── Constantes internes (prefixees g4pk_ pour unity build) ──────────

/// Magic "G4PK" en little-endian (0x4B503447 = "KP4G").
static constexpr uint32_t G4PK_MAGIC_LE = 0x4B503447;

/// Taille du header G4PK = 0x40 (64 octets).
static constexpr size_t G4PK_HEADER_SIZE = 0x40;

/// Verifie que [offset, offset+len) est dans les bornes.
static bool g4pk_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

/// Lit une chaine null-terminee depuis le span.
static std::string g4pk_read_string(std::span<const uint8_t> data, size_t offset) {
    if (offset >= data.size()) return {};
    const auto* start = reinterpret_cast<const char*>(data.data() + offset);
    const size_t max_len = data.size() - offset;
    const size_t len = strnlen(start, max_len);
    return {start, len};
}

std::optional<G4pkFile> g4pk_parse(std::span<const uint8_t> data) {
    if (data.size() < G4PK_HEADER_SIZE) {
        spdlog::error("g4pk_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4PK_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    // Verification du magic (little-endian sur PC)
    const uint32_t magic = iecode::read_u32_le(base);
    if (magic != G4PK_MAGIC_LE) {
        spdlog::error("g4pk_parse: magic invalide ({:#010x}, attendu {:#010x})",
                      magic, G4PK_MAGIC_LE);
        return std::nullopt;
    }

    // Lecture du header
    G4pkFile result;
    result.header_size   = iecode::read_u16_le(base + 0x04);
    result.file_type     = iecode::read_u16_le(base + 0x06);
    result.version       = iecode::read_u32_le(base + 0x08);
    result.content_size  = iecode::read_u32_le(base + 0x0C);

    const auto file_count        = iecode::read_u32_le(base + 0x20);
    const auto table2_entry_count = iecode::read_u16_le(base + 0x24);
    const auto table3_entry_count = iecode::read_u16_le(base + 0x26);

    spdlog::info("g4pk_parse: header_size={:#x} version={:#x} files={} "
                 "hash_entries={} string_entries={}",
                 result.header_size, result.version, file_count,
                 table2_entry_count, table3_entry_count);

    if (file_count == 0) {
        spdlog::warn("g4pk_parse: archive vide (0 fichiers)");
        return result;
    }

    // ── 1. Table des offsets (file_count x 4 octets) ────────────────
    const size_t offset_table_pos = result.header_size;
    const size_t offset_table_size = static_cast<size_t>(file_count) * 4;

    if (!g4pk_bounds_check(data, offset_table_pos, offset_table_size)) {
        spdlog::error("g4pk_parse: table d'offsets hors limites");
        return std::nullopt;
    }

    std::vector<int32_t> file_offsets(file_count);
    for (uint32_t i = 0; i < file_count; ++i) {
        file_offsets[i] = iecode::read_i32_le(
            base + offset_table_pos + static_cast<size_t>(i) * 4);
    }

    // ── 2. Table des tailles (file_count x 4 octets) ────────────────
    const size_t size_table_pos = offset_table_pos + offset_table_size;
    const size_t size_table_size = static_cast<size_t>(file_count) * 4;

    if (!g4pk_bounds_check(data, size_table_pos, size_table_size)) {
        spdlog::error("g4pk_parse: table de tailles hors limites");
        return std::nullopt;
    }

    std::vector<int32_t> file_sizes(file_count);
    for (uint32_t i = 0; i < file_count; ++i) {
        file_sizes[i] = iecode::read_i32_le(
            base + size_table_pos + static_cast<size_t>(i) * 4);
    }

    // ── 3. Table de hashes CRC32 (table2_entry_count x 4) ──────────
    const size_t hash_table_pos = size_table_pos + size_table_size;
    const size_t hash_table_size = static_cast<size_t>(table2_entry_count) * 4;

    std::vector<uint32_t> hashes(table2_entry_count);
    if (g4pk_bounds_check(data, hash_table_pos, hash_table_size)) {
        for (uint16_t i = 0; i < table2_entry_count; ++i) {
            hashes[i] = iecode::read_u32_le(
                base + hash_table_pos + static_cast<size_t>(i) * 4);
        }
    }

    // ── 4. Table d'IDs inconnus (table3_entry_count octets) ─────────
    const size_t unk_table_pos = hash_table_pos + hash_table_size;

    // ── 5. Table d'offsets de chaines (alignee sur 4 octets) ────────
    const size_t string_offset_pos = (unk_table_pos +
                                      static_cast<size_t>(table3_entry_count) + 3) & ~size_t{3};

    // Lire les offsets de chaines (table3_entry_count / 2 entrees de 2 octets)
    const uint16_t string_count = table3_entry_count / 2;
    std::vector<int16_t> string_offsets(string_count);
    if (string_count > 0 &&
        g4pk_bounds_check(data, string_offset_pos, static_cast<size_t>(string_count) * 2)) {
        for (uint16_t i = 0; i < string_count; ++i) {
            string_offsets[i] = iecode::read_i16_le(
                base + string_offset_pos + static_cast<size_t>(i) * 2);
        }
    }

    // Base de la pool de chaines = debut de la table d'offsets
    const size_t string_data_pos = string_offset_pos;

    // ── 6. Construire les entrees ───────────────────────────────────
    result.entries.reserve(file_count);

    for (uint32_t i = 0; i < file_count; ++i) {
        G4pkEntry entry;

        // Nom depuis la string table
        if (i < string_count && string_offsets[i] >= 0) {
            const size_t name_pos = string_data_pos +
                                    static_cast<size_t>(string_offsets[i]);
            entry.name = g4pk_read_string(data, name_pos);
        }
        if (entry.name.empty()) {
            entry.name = "file_" + std::to_string(i);
        }

        // Offset reel : decale de 2 bits a gauche, relatif au header
        entry.offset = static_cast<uint32_t>(result.header_size) +
                       (static_cast<uint32_t>(file_offsets[i]) << 2);
        entry.size = static_cast<uint32_t>(file_sizes[i]);

        // Hash CRC32
        if (i < hashes.size()) {
            entry.hash = hashes[i];
        }

        spdlog::debug("g4pk_parse: file[{}] name='{}' offset={:#x} size={} hash={:#010x}",
                       i, entry.name, entry.offset, entry.size, entry.hash);

        result.entries.push_back(std::move(entry));
    }

    spdlog::info("g4pk_parse: {} fichier(s) parse(s) avec succes", result.entries.size());
    return result;
}

std::span<const uint8_t> g4pk_extract_entry(
    std::span<const uint8_t> archive_data,
    const G4pkEntry& entry) {

    if (entry.size == 0) {
        return {};
    }

    const auto end = static_cast<size_t>(entry.offset) + static_cast<size_t>(entry.size);
    if (end > archive_data.size() || end < entry.offset) {
        spdlog::error("g4pk_extract_entry: entree '{}' hors limites "
                      "(offset={:#x}, size={}, archive={})",
                      entry.name, entry.offset, entry.size, archive_data.size());
        return {};
    }

    return archive_data.subspan(entry.offset, entry.size);
}

uint32_t g4pk_extract_all(
    std::span<const uint8_t> archive_data,
    const G4pkFile& file,
    const std::filesystem::path& output_dir,
    bool verbose) {

    namespace fs = std::filesystem;

    if (file.entries.empty()) {
        spdlog::warn("g4pk_extract_all: archive vide, rien a extraire");
        return 0;
    }

    // Creer le repertoire de sortie
    std::error_code ec;
    fs::create_directories(output_dir, ec);
    if (ec) {
        spdlog::error("g4pk_extract_all: impossible de creer '{}': {}",
                      output_dir.string(), ec.message());
        return 0;
    }

    uint32_t extracted = 0;

    for (const auto& entry : file.entries) {
        const auto data = g4pk_extract_entry(archive_data, entry);
        if (data.empty() && entry.size > 0) {
            spdlog::warn("g4pk_extract_all: skip '{}' (hors limites)", entry.name);
            continue;
        }

        // Construire le chemin de sortie (sanitiser les separateurs)
        auto entry_path = output_dir / entry.name;

        // Creer les sous-repertoires si le nom contient des separateurs
        fs::create_directories(entry_path.parent_path(), ec);
        if (ec) {
            spdlog::warn("g4pk_extract_all: impossible de creer le repertoire pour '{}': {}",
                         entry.name, ec.message());
            continue;
        }

        std::ofstream out(entry_path, std::ios::binary);
        if (!out) {
            spdlog::warn("g4pk_extract_all: impossible d'ecrire '{}'", entry_path.string());
            continue;
        }

        if (!data.empty()) {
            out.write(reinterpret_cast<const char*>(data.data()),
                      static_cast<std::streamsize>(data.size()));
        }

        if (!out.good()) {
            spdlog::warn("g4pk_extract_all: erreur d'ecriture pour '{}'", entry_path.string());
            continue;
        }

        if (verbose) {
            spdlog::info("  {} ({} octets)", entry.name, entry.size);
        }

        ++extracted;
    }

    spdlog::info("g4pk_extract_all: {}/{} fichier(s) extrait(s) dans '{}'",
                 extracted, file.entries.size(), output_dir.string());
    return extracted;
}

} // namespace iecode::level5
