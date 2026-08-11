#include "iecode/formats/level5/g4cm.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>
#include <fmt/format.h>
#include <cstring>
#include <fstream>

namespace iecode::level5 {

// ── Constantes internes (prefixees g4cm_ pour unity build) ──────────

/// Magic "G4CM" en little-endian (octets : 0x47 0x34 0x43 0x4D).
static constexpr uint32_t G4CM_MAGIC_LE = 0x4D433447; // "G4CM" lu en LE
/// Magic "G4CM" en big-endian.
static constexpr uint32_t G4CM_MAGIC_BE = 0x47344D43; // "G4CM" lu en BE

/// Taille minimale du header G4CM (magic + version + header_size + entry_count).
static constexpr size_t G4CM_MIN_HEADER_SIZE = 0x20;

/// Stride d'une entree dans la table d'entrees G4CM.
/// Hypothese : 16 octets par entree (type_hash/offset/size/flags).
static constexpr size_t G4CM_ENTRY_STRIDE = 0x10;

/// Verifie que [offset, offset+len) est dans les bornes.
static bool g4cm_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

/// Detecte le type d'un sous-fichier a partir de ses premiers octets.
static std::string g4cm_detect_type(std::span<const uint8_t> data, size_t offset, size_t size) {
    if (size < 4 || !g4cm_bounds_check(data, offset, 4)) {
        return "unknown";
    }

    const auto magic = iecode::read_u32_be(data.data() + offset);

    // Magics big-endian (format Level-5 natif)
    if (magic == MAGIC_G4TX)  return "g4tx";
    if (magic == MAGIC_G4MG)  return "g4mg";
    if (magic == MAGIC_G4MD)  return "g4md";
    if (magic == MAGIC_G4SK)  return "g4sk";

    // Verifier aussi en little-endian (PC)
    const auto magic_le = iecode::read_u32_le(data.data() + offset);
    if (magic_le == 0x58543447) return "g4tx"; // "G4TX" en LE
    if (magic_le == 0x474D3447) return "g4mg"; // "G4MG" en LE
    if (magic_le == 0x444D3447) return "g4md"; // "G4MD" en LE
    if (magic_le == 0x40533447) return "g4sk"; // "G4SK@" en LE

    return "unknown";
}

/// Lit une chaine null-terminee depuis le span.
static std::string g4cm_read_string(std::span<const uint8_t> data, size_t offset) {
    if (offset >= data.size()) return {};
    const auto* start = reinterpret_cast<const char*>(data.data() + offset);
    const size_t max_len = data.size() - offset;
    const size_t len = strnlen(start, max_len);
    return {start, len};
}

std::optional<G4cmFile> g4cm_parse(std::span<const uint8_t> data) {
    if (data.size() < G4CM_MIN_HEADER_SIZE) {
        spdlog::error("g4cm_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4CM_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    // Detection du magic
    const uint32_t magic_le = iecode::read_u32_le(base);
    const uint32_t magic_be = iecode::read_u32_be(base);
    bool is_big_endian = false;

    if (magic_le == G4CM_MAGIC_LE) {
        is_big_endian = false;
    } else if (magic_be == G4CM_MAGIC_BE) {
        is_big_endian = true;
    } else {
        spdlog::error("g4cm_parse: magic invalide (LE={:#010x}, BE={:#010x})",
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
    G4cmFile result;
    result.header_size = read_u16(0x04);
    result.version     = read_u32(0x08);

    const auto entry_count = read_u32(0x0C);

    // Validite basique du header_size
    if (result.header_size == 0) {
        result.header_size = G4CM_MIN_HEADER_SIZE;
    }
    if (result.header_size > data.size()) {
        spdlog::error("g4cm_parse: header_size ({:#x}) depasse la taille du fichier ({})",
                      result.header_size, data.size());
        return std::nullopt;
    }

    spdlog::info("g4cm_parse: version={:#x} header_size={:#x} entries={}",
                 result.version, result.header_size, entry_count);

    if (entry_count == 0) {
        spdlog::warn("g4cm_parse: conteneur vide (0 entrees)");
        return result;
    }

    // Limite raisonnable pour eviter les allocations excessives
    if (entry_count > 1024) {
        spdlog::error("g4cm_parse: nombre d'entrees suspect ({} > 1024)", entry_count);
        return std::nullopt;
    }

    // ── Table des entrees ───────────────────────────────────────────
    // Hypothese : la table commence juste apres le header
    // Chaque entree = 16 octets : offset(4) + size(4) + name_offset(4) + flags(4)
    const size_t entry_table_offset = result.header_size;
    const size_t entry_table_size = static_cast<size_t>(entry_count) * G4CM_ENTRY_STRIDE;

    if (!g4cm_bounds_check(data, entry_table_offset, entry_table_size)) {
        spdlog::error("g4cm_parse: table d'entrees hors limites "
                      "(offset={:#x}, size={}, file_size={})",
                      entry_table_offset, entry_table_size, data.size());
        return std::nullopt;
    }

    // Base des noms de fichiers : juste apres la table d'entrees
    const size_t name_pool_offset = entry_table_offset + entry_table_size;

    result.entries.reserve(entry_count);
    for (uint32_t i = 0; i < entry_count; ++i) {
        const size_t off = entry_table_offset + static_cast<size_t>(i) * G4CM_ENTRY_STRIDE;

        G4cmEntry entry;
        entry.offset = read_u32(off + 0x00);
        entry.size   = read_u32(off + 0x04);

        const uint32_t name_off = read_u32(off + 0x08);
        // flags a off + 0x0C (ignore pour l'instant)

        // Lire le nom si l'offset est valide
        if (name_off > 0) {
            const size_t abs_name_off = name_pool_offset + name_off;
            entry.name = g4cm_read_string(data, abs_name_off);
        }

        // Generer un nom par defaut si vide
        if (entry.name.empty()) {
            entry.name = fmt::format("file_{:03d}", i);
        }

        // Detecter le type depuis le magic du sous-fichier
        entry.type = g4cm_detect_type(data, entry.offset, entry.size);

        // Ajouter l'extension si le nom n'en a pas
        if (entry.name.find('.') == std::string::npos && entry.type != "unknown") {
            entry.name += "." + entry.type;
        }

        // Validation des bornes
        if (entry.size > 0 && !g4cm_bounds_check(data, entry.offset, entry.size)) {
            spdlog::warn("g4cm_parse: entree[{}] '{}' hors limites "
                         "(offset={:#x}, size={})",
                         i, entry.name, entry.offset, entry.size);
        }

        spdlog::debug("g4cm_parse: entry[{}] type='{}' name='{}' offset={:#x} size={}",
                       i, entry.type, entry.name, entry.offset, entry.size);

        result.entries.push_back(std::move(entry));
    }

    spdlog::info("g4cm_parse: {} entree(s) parsee(s) avec succes", result.entries.size());
    return result;
}

std::span<const uint8_t> g4cm_extract_entry(
    std::span<const uint8_t> container_data,
    const G4cmEntry& entry) {

    if (entry.size == 0) {
        return {};
    }

    const auto end = static_cast<size_t>(entry.offset) + static_cast<size_t>(entry.size);
    if (end > container_data.size() || end < entry.offset) {
        spdlog::error("g4cm_extract_entry: entree '{}' hors limites "
                      "(offset={:#x}, size={}, container={})",
                      entry.name, entry.offset, entry.size, container_data.size());
        return {};
    }

    return container_data.subspan(entry.offset, entry.size);
}

uint32_t g4cm_extract_all(
    std::span<const uint8_t> container_data,
    const G4cmFile& file,
    const std::filesystem::path& output_dir,
    bool verbose) {

    namespace fs = std::filesystem;

    if (file.entries.empty()) {
        spdlog::warn("g4cm_extract_all: conteneur vide, rien a extraire");
        return 0;
    }

    // Creer le repertoire de sortie
    std::error_code ec;
    fs::create_directories(output_dir, ec);
    if (ec) {
        spdlog::error("g4cm_extract_all: impossible de creer '{}': {}",
                      output_dir.string(), ec.message());
        return 0;
    }

    uint32_t extracted = 0;

    for (const auto& entry : file.entries) {
        const auto entry_data = g4cm_extract_entry(container_data, entry);
        if (entry_data.empty() && entry.size > 0) {
            spdlog::warn("g4cm_extract_all: skip '{}' (hors limites)", entry.name);
            continue;
        }

        auto entry_path = output_dir / entry.name;

        // Creer les sous-repertoires si necessaire
        fs::create_directories(entry_path.parent_path(), ec);
        if (ec) {
            spdlog::warn("g4cm_extract_all: impossible de creer le repertoire pour '{}': {}",
                         entry.name, ec.message());
            continue;
        }

        std::ofstream out(entry_path, std::ios::binary);
        if (!out) {
            spdlog::warn("g4cm_extract_all: impossible d'ecrire '{}'", entry_path.string());
            continue;
        }

        if (!entry_data.empty()) {
            out.write(reinterpret_cast<const char*>(entry_data.data()),
                      static_cast<std::streamsize>(entry_data.size()));
        }

        if (!out.good()) {
            spdlog::warn("g4cm_extract_all: erreur d'ecriture pour '{}'", entry_path.string());
            continue;
        }

        if (verbose) {
            spdlog::info("  [{}] {} ({} octets)", entry.type, entry.name, entry.size);
        }

        ++extracted;
    }

    spdlog::info("g4cm_extract_all: {}/{} fichier(s) extrait(s) dans '{}'",
                 extracted, file.entries.size(), output_dir.string());
    return extracted;
}

} // namespace iecode::level5
