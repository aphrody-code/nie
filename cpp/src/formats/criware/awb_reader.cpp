#include "iecode/formats/criware/awb_reader.h"

#include "iecode/types.h"

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstring>
#include <filesystem>
#include <fstream>

namespace iecode::criware {

namespace {

/// Magic "AFS2" en little-endian (tel que lu par memcpy sur x86).
constexpr uint32_t AFS2_MAGIC = 0x32534641; // 'A','F','S','2'

/// Taille minimale du header AFS2.
constexpr size_t AFS2_MIN_HEADER_SIZE = 0x10;

/// Detecte l'extension d'un fichier audio a partir des premiers octets.
/// @return ".hca", ".adx", ".at3", ou ".bin" par defaut.
[[nodiscard]] std::string detect_audio_extension(std::span<const uint8_t> data) {
    if (data.size() >= 4) {
        // HCA : magic "HCA\x00" ou "\x80HCA"
        if ((data[0] == 'H' && data[1] == 'C' && data[2] == 'A') ||
            (data[0] == 0x80 && data[1] == 'H' && data[2] == 'C' && data[3] == 'A')) {
            return ".hca";
        }
        // ADX : magic 0x80 0x00
        if (data[0] == 0x80 && data[1] == 0x00) {
            return ".adx";
        }
    }
    return ".bin";
}

} // namespace

std::optional<AwbFile> awb_parse(std::span<const uint8_t> data) {
    if (data.size() < AFS2_MIN_HEADER_SIZE) {
        spdlog::error("awb_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), AFS2_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    // --- Verifier le magic ---
    const uint32_t magic = read_u32_le(data.data());
    if (magic != AFS2_MAGIC) {
        spdlog::error("awb_parse: magic invalide (attendu AFS2/0x{:08X}, recu 0x{:08X})",
                      AFS2_MAGIC, magic);
        return std::nullopt;
    }

    AwbFile file;

    // --- Lire le header ---
    // offset 0x04: version (uint8)
    file.version = data[4];

    // offset 0x05: taille des offsets en octets (2 ou 4)
    const uint8_t offset_size = data[5];

    // offset 0x06: entry_count (uint16 LE)
    const uint16_t entry_count = read_u16_le(data.data() + 6);

    // offset 0x08: block_size (uint32 LE) — alignement
    file.block_size = read_u32_le(data.data() + 8);

    // offset 0x0C: key (uint32 LE) — sous-cle HCA
    file.key = read_u32_le(data.data() + 0x0C);

    spdlog::debug("awb_parse: version={}, offset_size={}, entries={}, block_size={:#x}, key={:#x}",
                  file.version, offset_size, entry_count, file.block_size, file.key);

    // --- Valider la taille des offsets ---
    // Le champ a offset 0x05 indique la taille des offset entries dans la table.
    // Valeurs observees : 2 (uint16) ou 4 (uint32).
    // Certaines implementations interpretent ce champ comme "subkey bits"
    // mais en pratique il controle la taille des offsets dans le header.
    uint8_t actual_offset_size = 4; // Par defaut uint32
    if (offset_size == 2) {
        actual_offset_size = 2;
    } else if (offset_size == 4) {
        actual_offset_size = 4;
    }
    // Si la valeur est 0 (subkey_bits), on utilise uint32 pour les offsets
    // comme c'est le cas le plus courant.

    // --- Lire les cue IDs ---
    // Apres le header (offset 0x10), on a : cue_ids[entry_count] en uint16 LE
    const size_t cue_ids_offset = AFS2_MIN_HEADER_SIZE;
    const size_t cue_ids_size = static_cast<size_t>(entry_count) * 2;

    if (cue_ids_offset + cue_ids_size > data.size()) {
        spdlog::error("awb_parse: table de cue_ids depasse la taille du fichier");
        return std::nullopt;
    }

    std::vector<uint16_t> cue_ids(entry_count);
    for (uint16_t i = 0; i < entry_count; ++i) {
        cue_ids[i] = read_u16_le(data.data() + cue_ids_offset + static_cast<size_t>(i) * 2);
    }

    // --- Lire les offsets ---
    // Apres les cue_ids : offsets[entry_count + 1] (le dernier est la fin)
    const size_t offsets_start = cue_ids_offset + cue_ids_size;
    const size_t offset_count = static_cast<size_t>(entry_count) + 1;
    const size_t offsets_size = offset_count * actual_offset_size;

    if (offsets_start + offsets_size > data.size()) {
        spdlog::error("awb_parse: table d'offsets depasse la taille du fichier");
        return std::nullopt;
    }

    std::vector<uint32_t> offsets(offset_count);
    for (size_t i = 0; i < offset_count; ++i) {
        if (actual_offset_size == 2) {
            offsets[i] = read_u16_le(data.data() + offsets_start + i * 2);
        } else {
            offsets[i] = read_u32_le(data.data() + offsets_start + i * 4);
        }
    }

    // --- Construire les entrees ---
    file.entries.reserve(entry_count);

    for (uint16_t i = 0; i < entry_count; ++i) {
        AwbEntry entry;
        entry.cue_id = cue_ids[i];

        // L'offset reel est aligne sur block_size
        uint32_t raw_offset = offsets[i];
        if (file.block_size > 0 && file.block_size != 1) {
            // Aligner vers le haut
            raw_offset = ((raw_offset + file.block_size - 1) / file.block_size) * file.block_size;
        }
        entry.offset = raw_offset;

        // La taille est la difference entre cet offset (aligne) et le prochain offset brut
        // Pour le dernier, c'est la fin du fichier
        uint32_t end_offset = offsets[static_cast<size_t>(i) + 1];
        if (end_offset > raw_offset) {
            entry.size = end_offset - raw_offset;
        } else {
            entry.size = 0;
        }

        // Validation : verifier que l'entree ne depasse pas le fichier
        if (static_cast<size_t>(entry.offset) + entry.size > data.size()) {
            spdlog::warn("awb_parse: entree {} (cue_id={}) depasse la taille du fichier "
                         "(offset={:#x}, size={:#x}, file_size={:#x})",
                         i, entry.cue_id, entry.offset, entry.size, data.size());
            // Tronquer a la taille disponible
            if (entry.offset < data.size()) {
                entry.size = static_cast<uint32_t>(data.size() - entry.offset);
            } else {
                entry.size = 0;
            }
        }

        file.entries.push_back(entry);
    }

    spdlog::debug("awb_parse: {} entrees parsees", file.entries.size());
    return file;
}

std::span<const uint8_t> awb_extract_entry(
    std::span<const uint8_t> data, const AwbEntry& entry) {
    if (entry.size == 0) {
        return {};
    }
    if (static_cast<size_t>(entry.offset) + entry.size > data.size()) {
        spdlog::error("awb_extract_entry: cue_id={} hors bornes (offset={:#x}, size={:#x}, total={:#x})",
                      entry.cue_id, entry.offset, entry.size, data.size());
        return {};
    }
    return data.subspan(entry.offset, entry.size);
}

uint32_t awb_extract_all(
    std::span<const uint8_t> data,
    const AwbFile& file,
    const std::filesystem::path& output_dir,
    bool verbose) {

    namespace fs = std::filesystem;

    // Creer le repertoire de sortie
    std::error_code ec;
    fs::create_directories(output_dir, ec);
    if (ec) {
        spdlog::error("awb_extract_all: impossible de creer le repertoire '{}'", output_dir.string());
        return 0;
    }

    uint32_t extracted = 0;

    for (const auto& entry : file.entries) {
        const auto entry_data = awb_extract_entry(data, entry);
        if (entry_data.empty()) {
            spdlog::warn("awb_extract_all: entree cue_id={} vide, ignoree", entry.cue_id);
            continue;
        }

        // Detecter l'extension
        const auto ext = detect_audio_extension(entry_data);
        const auto filename = fmt::format("cue_{:04d}{}", entry.cue_id, ext);
        const auto output_path = output_dir / filename;

        // Ecrire le fichier
        std::ofstream out(output_path, std::ios::binary);
        if (!out) {
            spdlog::error("awb_extract_all: impossible d'ecrire '{}'", output_path.string());
            continue;
        }
        out.write(reinterpret_cast<const char*>(entry_data.data()),
                  static_cast<std::streamsize>(entry_data.size()));

        if (verbose) {
            spdlog::info("  {} ({} octets)", filename, entry_data.size());
        }

        ++extracted;
    }

    spdlog::info("awb_extract_all: {} fichiers extraits vers '{}'", extracted, output_dir.string());
    return extracted;
}

} // namespace iecode::criware
