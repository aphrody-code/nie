/// @file col.cpp
/// Implementation du parser COL (geometrie de collision).

#include "iecode/formats/level5/col_parser.h"
#include "iecode/types.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <cstddef>

namespace iecode::level5 {

// ── Constantes du format ────────────────────────────────────────────

/// Header : magic(4) + version(4) + vertex_count(4) + triangle_count(4) + bbox(24)
static constexpr size_t COL_HEADER_SIZE = 0x28;

/// Taille d'un sommet (3 floats = 12 octets)
static constexpr size_t COL_VERTEX_SIZE = 12;

/// Taille d'un triangle (3 uint16 indices + uint16 flags = 8 octets)
static constexpr size_t COL_TRIANGLE_SIZE = 8;

/// Limites raisonnables pour eviter les allocations catastrophiques
static constexpr uint32_t COL_MAX_VERTICES  = 10'000'000;
static constexpr uint32_t COL_MAX_TRIANGLES = 10'000'000;

// ── Parsing ─────────────────────────────────────────────────────────

std::optional<ColFile> col_parse(std::span<const uint8_t> data) {
    if (data.size() < COL_HEADER_SIZE) {
        spdlog::debug("col: donnees trop petites ({} octets, minimum {})",
                      data.size(), COL_HEADER_SIZE);
        return std::nullopt;
    }

    const uint32_t magic = read_u32_le(data, 0x00);

    // Verifier le magic : "COL\0" ou "COLS"
    if (magic != MAGIC_COL0 && magic != MAGIC_COLS) {
        spdlog::error("col: magic invalide {:#010x} (attendu COL\\0 ou COLS)", magic);
        return std::nullopt;
    }

    const uint32_t version = read_u32_le(data, 0x04);
    const uint32_t vertex_count = read_u32_le(data, 0x08);
    const uint32_t triangle_count = read_u32_le(data, 0x0C);

    // Validation des compteurs
    if (vertex_count > COL_MAX_VERTICES) {
        spdlog::error("col: nombre de sommets suspect ({}, max {})",
                      vertex_count, COL_MAX_VERTICES);
        return std::nullopt;
    }
    if (triangle_count > COL_MAX_TRIANGLES) {
        spdlog::error("col: nombre de triangles suspect ({}, max {})",
                      triangle_count, COL_MAX_TRIANGLES);
        return std::nullopt;
    }

    // Calcul des tailles necessaires
    const size_t vertices_size = static_cast<size_t>(vertex_count) * COL_VERTEX_SIZE;
    const size_t triangles_size = static_cast<size_t>(triangle_count) * COL_TRIANGLE_SIZE;
    const size_t total_needed = COL_HEADER_SIZE + vertices_size + triangles_size;

    if (total_needed > data.size()) {
        spdlog::error("col: donnees insuffisantes ({} octets, besoin {})",
                      data.size(), total_needed);
        return std::nullopt;
    }

    ColFile file;
    file.version = version;

    // Bounding box (6 floats a l'offset 0x10)
    file.bbox_min[0] = read_f32_le(data, 0x10);
    file.bbox_min[1] = read_f32_le(data, 0x14);
    file.bbox_min[2] = read_f32_le(data, 0x18);
    file.bbox_max[0] = read_f32_le(data, 0x1C);
    file.bbox_max[1] = read_f32_le(data, 0x20);
    file.bbox_max[2] = read_f32_le(data, 0x24);

    // Sommets
    file.vertices.reserve(vertex_count);
    size_t offset = COL_HEADER_SIZE;
    for (uint32_t i = 0; i < vertex_count; ++i) {
        ColVertex v;
        v.x = read_f32_le(data, offset);
        v.y = read_f32_le(data, offset + 4);
        v.z = read_f32_le(data, offset + 8);
        file.vertices.push_back(v);
        offset += COL_VERTEX_SIZE;
    }

    // Triangles
    file.triangles.reserve(triangle_count);
    for (uint32_t i = 0; i < triangle_count; ++i) {
        ColTriangle tri;
        tri.a = read_u16_le(data, offset);
        tri.b = read_u16_le(data, offset + 2);
        tri.c = read_u16_le(data, offset + 4);
        tri.flags = read_u16_le(data, offset + 6);

        // Verification des indices de sommets
        if (tri.a >= vertex_count || tri.b >= vertex_count || tri.c >= vertex_count) {
            spdlog::warn("col: triangle {} reference un sommet hors limites "
                         "(a={}, b={}, c={}, max={})",
                         i, tri.a, tri.b, tri.c, vertex_count);
        }

        file.triangles.push_back(tri);
        offset += COL_TRIANGLE_SIZE;
    }

    spdlog::debug("col: parse OK — version={}, {} sommets, {} triangles",
                  version, vertex_count, triangle_count);
    return file;
}

// ── Export JSON ─────────────────────────────────────────────────────

std::string col_to_json(const ColFile& file) {
    nlohmann::json j;
    j["format"] = "COL";
    j["version"] = file.version;
    j["vertex_count"] = file.vertices.size();
    j["triangle_count"] = file.triangles.size();
    j["bbox_min"] = { file.bbox_min[0], file.bbox_min[1], file.bbox_min[2] };
    j["bbox_max"] = { file.bbox_max[0], file.bbox_max[1], file.bbox_max[2] };

    auto verts_json = nlohmann::json::array();
    for (const auto& v : file.vertices) {
        verts_json.push_back({ v.x, v.y, v.z });
    }
    j["vertices"] = std::move(verts_json);

    auto tris_json = nlohmann::json::array();
    for (const auto& t : file.triangles) {
        tris_json.push_back({
            {"a", t.a}, {"b", t.b}, {"c", t.c}, {"flags", t.flags}
        });
    }
    j["triangles"] = std::move(tris_json);

    return j.dump(2);
}

} // namespace iecode::level5
