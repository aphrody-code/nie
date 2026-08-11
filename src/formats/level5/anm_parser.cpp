#include "iecode/formats/level5/anm_parser.h"

#include "iecode/types.h"
#include <cstring>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

namespace iecode::level5 {

// ── Constantes internes (prefixees anm_ pour unity build) ──────────

/// Taille minimale d'un fichier ANMx : 4 (magic) + 20 (header minimum).
static constexpr size_t ANM_MIN_SIZE = 24;

/// Limite du nombre d'entrees pour eviter les allocations abusives.
static constexpr size_t ANM_MAX_ENTRIES = 100'000;

/// Limite du nombre de keyframes par entree.
static constexpr size_t ANM_MAX_KEYFRAMES = 1'000'000;

/// Taille d'une entree dans la table d'entrees (3 x uint32 = 12 octets).
static constexpr size_t ANM_ENTRY_TABLE_STRIDE = 12;

/// Verifie que [offset, offset+len) est dans les bornes.
static bool anm_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

/// Determine le type ANMx a partir d'un magic de 4 octets.
static AnmType anm_magic_to_type(const uint8_t* magic) {
    if (std::memcmp(magic, "ANMC", 4) == 0) return AnmType::ANMC;
    if (std::memcmp(magic, "ANMV", 4) == 0) return AnmType::ANMV;
    if (std::memcmp(magic, "ANMA", 4) == 0) return AnmType::ANMA;
    if (std::memcmp(magic, "ANMN", 4) == 0) return AnmType::ANMN;
    if (std::memcmp(magic, "ANMP", 4) == 0) return AnmType::ANMP;
    return AnmType::Unknown;
}

bool anm_is_valid(std::span<const uint8_t> data) {
    if (data.size() < 4) return false;
    return anm_magic_to_type(data.data()) != AnmType::Unknown;
}

AnmType anm_detect_type(std::span<const uint8_t> data) {
    if (data.size() < 4) return AnmType::Unknown;
    return anm_magic_to_type(data.data());
}

std::string_view anm_type_name(AnmType type) {
    switch (type) {
        case AnmType::ANMC: return "ANMC";
        case AnmType::ANMV: return "ANMV";
        case AnmType::ANMA: return "ANMA";
        case AnmType::ANMN: return "ANMN";
        case AnmType::ANMP: return "ANMP";
        case AnmType::Unknown: return "Unknown";
    }
    return "Unknown";
}

std::optional<AnmFile> anm_parse(std::span<const uint8_t> data) {
    if (data.size() < ANM_MIN_SIZE) {
        spdlog::error("anm_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), ANM_MIN_SIZE);
        return std::nullopt;
    }

    // ── Detecter le type depuis le magic ────────────────────────────
    const AnmType type = anm_magic_to_type(data.data());
    if (type == AnmType::Unknown) {
        spdlog::error("anm_parse: magic invalide ({:#04x} {:#04x} {:#04x} {:#04x})",
                      data[0], data[1], data[2], data[3]);
        return std::nullopt;
    }

    const auto* base = data.data();

    // ── Detection endianness ────────────────────────────────────────
    // Les fichiers ANMx Level-5 sont en big-endian (comme G4TX, G4MG, etc.)
    // Le magic est toujours en ASCII, donc on detecte via la version a +4.
    // Une version > 0xFFFF en LE est peu probable, donc on teste BE d'abord.
    bool is_big_endian = true;
    const uint32_t version_be = iecode::read_u32_be(base + 4);
    const uint32_t version_le = iecode::read_u32_le(base + 4);

    // Heuristique : la version Level-5 est typiquement < 0x10000
    if (version_le < version_be && version_le < 0x10000 && version_le > 0) {
        is_big_endian = false;
    }

    // Fonctions de lecture adaptees a l'endianness
    auto read_u32 = [is_big_endian, base](size_t off) -> uint32_t {
        return is_big_endian ? iecode::read_u32_be(base + off)
                             : iecode::read_u32_le(base + off);
    };
    auto read_f32 = [is_big_endian, base](size_t off) -> float {
        return is_big_endian ? iecode::read_f32_be(base + off)
                             : iecode::read_f32_le(base + off);
    };

    // ── Parser le header ────────────────────────────────────────────
    AnmFile result;
    std::memcpy(result.header.magic, data.data(), 4);
    result.header.type = type;

    // Layout header presume (similaire aux autres formats Level-5) :
    //   +0x00 : magic (4 octets)
    //   +0x04 : version (uint32)
    //   +0x08 : data_size (uint32) — taille totale des donnees
    //   +0x0C : entry_count (uint32) — nombre d'entrees
    //   +0x10 : frame_count (uint32) — nombre de frames
    //   +0x14 : fps (float32) — framerate
    result.header.version     = read_u32(0x04);
    result.header.data_size   = read_u32(0x08);
    result.header.entry_count = read_u32(0x0C);
    result.header.frame_count = read_u32(0x10);

    // Le FPS peut ne pas etre present dans les fichiers les plus courts
    if (data.size() >= 0x18) {
        const float fps_candidate = read_f32(0x14);
        // Validation : un FPS raisonnable est entre 1 et 120
        if (fps_candidate >= 1.0f && fps_candidate <= 120.0f) {
            result.header.fps = fps_candidate;
        }
    }

    spdlog::info("anm_parse: type={} version={:#x} data_size={:#x} entries={} frames={} fps={}",
                 anm_type_name(type), result.header.version,
                 result.header.data_size, result.header.entry_count,
                 result.header.frame_count, result.header.fps);

    // ── Validation du nombre d'entrees ──────────────────────────────
    if (result.header.entry_count > ANM_MAX_ENTRIES) {
        spdlog::error("anm_parse: trop d'entrees ({}, max {})",
                      result.header.entry_count, ANM_MAX_ENTRIES);
        return std::nullopt;
    }

    if (result.header.entry_count == 0) {
        spdlog::warn("anm_parse: aucune entree d'animation");
        return result;
    }

    // ── Parser la table d'entrees ───────────────────────────────────
    // Les entrees commencent apres le header (offset 0x18).
    // Chaque entree de la table contient :
    //   +0x00 : target_hash (uint32) — CRC32 de la cible
    //   +0x04 : channel (uint32) — canal d'animation
    //   +0x08 : keyframe_count (uint32) — nombre de keyframes
    constexpr size_t ENTRY_TABLE_OFFSET = 0x18;

    const size_t entry_table_size =
        static_cast<size_t>(result.header.entry_count) * ANM_ENTRY_TABLE_STRIDE;

    if (!anm_bounds_check(data, ENTRY_TABLE_OFFSET, entry_table_size)) {
        spdlog::error("anm_parse: table d'entrees hors limites "
                      "(offset={:#x}, taille={:#x}, fichier={})",
                      ENTRY_TABLE_OFFSET, entry_table_size, data.size());
        // Reduire le nombre d'entrees au lieu de rejeter
        const size_t available = (data.size() > ENTRY_TABLE_OFFSET)
                                  ? (data.size() - ENTRY_TABLE_OFFSET) / ANM_ENTRY_TABLE_STRIDE
                                  : 0;
        result.header.entry_count = static_cast<uint32_t>(available);
        if (result.header.entry_count == 0) return result;
    }

    result.entries.reserve(result.header.entry_count);

    // Position des donnees keyframe apres la table d'entrees
    size_t keyframe_data_offset =
        ENTRY_TABLE_OFFSET + static_cast<size_t>(result.header.entry_count) * ANM_ENTRY_TABLE_STRIDE;

    for (uint32_t i = 0; i < result.header.entry_count; ++i) {
        const size_t entry_off =
            ENTRY_TABLE_OFFSET + static_cast<size_t>(i) * ANM_ENTRY_TABLE_STRIDE;

        AnmEntry entry;
        entry.target_hash    = read_u32(entry_off + 0x00);
        entry.channel        = read_u32(entry_off + 0x04);
        entry.keyframe_count = read_u32(entry_off + 0x08);

        spdlog::debug("anm_parse: entry[{}] target={:#010x} channel={} keyframes={}",
                       i, entry.target_hash, entry.channel, entry.keyframe_count);

        // Validation du nombre de keyframes
        if (entry.keyframe_count > ANM_MAX_KEYFRAMES) {
            spdlog::warn("anm_parse: entry[{}] trop de keyframes ({}), ignore",
                         i, entry.keyframe_count);
            entry.keyframe_count = 0;
        }

        // Lire les donnees de keyframes si present
        if (entry.keyframe_count > 0) {
            // Chaque keyframe contient un time (float) et une value (float) = 8 octets
            const size_t keyframe_data_size = static_cast<size_t>(entry.keyframe_count) * 8;

            if (anm_bounds_check(data, keyframe_data_offset, keyframe_data_size)) {
                entry.times.reserve(entry.keyframe_count);
                entry.values.reserve(entry.keyframe_count);

                for (uint32_t k = 0; k < entry.keyframe_count; ++k) {
                    const size_t kf_off = keyframe_data_offset + static_cast<size_t>(k) * 8;
                    entry.times.push_back(read_f32(kf_off));
                    entry.values.push_back(read_f32(kf_off + 4));
                }

                keyframe_data_offset += keyframe_data_size;
            } else {
                spdlog::warn("anm_parse: entry[{}] donnees keyframe hors limites "
                             "(offset={:#x}, taille={})",
                             i, keyframe_data_offset, keyframe_data_size);
                entry.keyframe_count = 0;
            }
        }

        result.entries.push_back(std::move(entry));
    }

    spdlog::info("anm_parse: {} entree(s) parsee(s) avec succes", result.entries.size());
    return result;
}

std::string anm_to_json(const AnmFile& anm) {
    nlohmann::json j;

    // Header
    j["header"] = {
        {"magic",       std::string(anm.header.magic, 4)},
        {"type",        std::string(anm_type_name(anm.header.type))},
        {"version",     anm.header.version},
        {"data_size",   anm.header.data_size},
        {"entry_count", anm.header.entry_count},
        {"frame_count", anm.header.frame_count},
        {"fps",         anm.header.fps},
    };

    // Entrees
    auto& entries_json = j["entries"];
    entries_json = nlohmann::json::array();

    for (const auto& entry : anm.entries) {
        nlohmann::json ej;
        ej["target_hash"]    = fmt::format("{:#010x}", entry.target_hash);
        ej["channel"]        = entry.channel;
        ej["keyframe_count"] = entry.keyframe_count;

        // Keyframes
        if (!entry.times.empty()) {
            auto& keyframes = ej["keyframes"];
            keyframes = nlohmann::json::array();

            for (size_t k = 0; k < entry.times.size(); ++k) {
                keyframes.push_back({
                    {"time",  entry.times[k]},
                    {"value", entry.values[k]},
                });
            }
        }

        entries_json.push_back(std::move(ej));
    }

    return j.dump(2);
}

} // namespace iecode::level5
