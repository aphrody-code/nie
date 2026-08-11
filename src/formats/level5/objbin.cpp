/// @file objbin.cpp
/// Implementation du parser OBJBIN (placement d'objets de scene).

#include "iecode/formats/level5/objbin_parser.h"
#include "iecode/types.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstddef>

namespace iecode::level5 {

// ── Constantes du format ────────────────────────────────────────────

/// Taille minimale du header OBJBIN (magic + version + count + string_pool_offset)
static constexpr size_t OBJBIN_HEADER_SIZE = 0x10;

/// Taille d'une entree objet (crc32 + pos[3] + rot[4] + scale[3] + flags + layer)
static constexpr size_t OBJBIN_ENTRY_SIZE = 52;

/// Nombre maximum raisonnable d'objets (protection contre les fichiers corrompus)
static constexpr uint32_t OBJBIN_MAX_OBJECTS = 100'000;

// ── Magics possibles (heuristique) ──────────────────────────────────

/// Verifie si le magic ressemble a un fichier OBJBIN connu.
/// Retourne true si c'est un magic connu, false si on tente un parsing speculatif.
[[nodiscard]] static bool is_known_objbin_magic(uint32_t magic) {
    // "OBJB" en little-endian
    constexpr uint32_t MAGIC_OBJB = 0x424A424F;
    // "OBJ\0" en little-endian
    constexpr uint32_t MAGIC_OBJ0 = 0x004A424F;

    return magic == MAGIC_OBJB || magic == MAGIC_OBJ0;
}

// ── Parsing ─────────────────────────────────────────────────────────

std::optional<ObjbinFile> objbin_parse(std::span<const uint8_t> data) {
    if (data.size() < OBJBIN_HEADER_SIZE) {
        spdlog::debug("objbin: donnees trop petites ({} octets, minimum {})",
                      data.size(), OBJBIN_HEADER_SIZE);
        return std::nullopt;
    }

    const uint32_t magic = read_u32_le(data, 0x00);
    const bool known_magic = is_known_objbin_magic(magic);

    if (!known_magic) {
        spdlog::warn("objbin: magic inconnu {:#010x}, tentative de parsing speculatif", magic);
    }

    const uint32_t version = read_u32_le(data, 0x04);
    const uint32_t object_count = read_u32_le(data, 0x08);
    const uint32_t string_pool_offset = read_u32_le(data, 0x0C);

    // Validation du nombre d'objets
    if (object_count > OBJBIN_MAX_OBJECTS) {
        spdlog::error("objbin: nombre d'objets suspect ({}, maximum {})",
                      object_count, OBJBIN_MAX_OBJECTS);
        return std::nullopt;
    }

    // Verification que les donnees contiennent assez d'espace pour les entrees
    const size_t entries_end = OBJBIN_HEADER_SIZE +
                               static_cast<size_t>(object_count) * OBJBIN_ENTRY_SIZE;
    if (entries_end > data.size()) {
        spdlog::error("objbin: donnees insuffisantes pour {} objets "
                      "(besoin {} octets, disponible {})",
                      object_count, entries_end, data.size());
        return std::nullopt;
    }

    ObjbinFile file;
    file.version = version;
    file.objects.reserve(object_count);

    for (uint32_t i = 0; i < object_count; ++i) {
        const size_t base = OBJBIN_HEADER_SIZE + static_cast<size_t>(i) * OBJBIN_ENTRY_SIZE;

        ObjbinObject obj;
        obj.model_crc32 = read_u32_le(data, base + 0);

        // Position XYZ (3 floats, 12 octets)
        obj.transform.position[0] = read_f32_le(data, base + 4);
        obj.transform.position[1] = read_f32_le(data, base + 8);
        obj.transform.position[2] = read_f32_le(data, base + 12);

        // Rotation quaternion XYZW (4 floats, 16 octets)
        obj.transform.rotation[0] = read_f32_le(data, base + 16);
        obj.transform.rotation[1] = read_f32_le(data, base + 20);
        obj.transform.rotation[2] = read_f32_le(data, base + 24);
        obj.transform.rotation[3] = read_f32_le(data, base + 28);

        // Echelle XYZ (3 floats, 12 octets)
        obj.transform.scale[0] = read_f32_le(data, base + 32);
        obj.transform.scale[1] = read_f32_le(data, base + 36);
        obj.transform.scale[2] = read_f32_le(data, base + 40);

        // Flags + layer (2 x uint32)
        obj.flags = read_u32_le(data, base + 44);
        obj.layer = read_u32_le(data, base + 48);

        // Tenter de resoudre le nom depuis le string pool
        if (string_pool_offset > 0 && string_pool_offset < data.size()) {
            // Recherche lineaire dans le pool : chaque entree est
            // crc32(4) + offset_or_null_terminated_string
            // Pour l'instant, on laisse le nom vide — le format exact du pool
            // sera precise apres analyse de fichiers reels.
            obj.model_name = fmt::format("model_{:#010x}", obj.model_crc32);
        } else {
            obj.model_name = fmt::format("model_{:#010x}", obj.model_crc32);
        }

        file.objects.push_back(std::move(obj));
    }

    spdlog::debug("objbin: parse OK — version={}, {} objets", version, object_count);
    return file;
}

// ── Export JSON ─────────────────────────────────────────────────────

std::string objbin_to_json(const ObjbinFile& file) {
    nlohmann::json j;
    j["format"] = "OBJBIN";
    j["version"] = file.version;
    j["object_count"] = file.objects.size();

    auto objects_json = nlohmann::json::array();
    for (const auto& obj : file.objects) {
        nlohmann::json entry;
        entry["model_crc32"] = fmt::format("{:#010x}", obj.model_crc32);
        entry["model_name"] = obj.model_name;
        entry["position"] = {
            obj.transform.position[0],
            obj.transform.position[1],
            obj.transform.position[2]
        };
        entry["rotation"] = {
            obj.transform.rotation[0],
            obj.transform.rotation[1],
            obj.transform.rotation[2],
            obj.transform.rotation[3]
        };
        entry["scale"] = {
            obj.transform.scale[0],
            obj.transform.scale[1],
            obj.transform.scale[2]
        };
        entry["flags"] = obj.flags;
        entry["layer"] = obj.layer;
        objects_json.push_back(std::move(entry));
    }

    j["objects"] = std::move(objects_json);
    return j.dump(2);
}

} // namespace iecode::level5
