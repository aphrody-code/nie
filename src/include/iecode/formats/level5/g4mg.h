#pragma once

/// @file g4mg.h
/// Parser de meshes G4MG (Level-5).
/// Les fichiers G4MG de production (ex: c000101.g4mg) NE contiennent PAS
/// de magic ASCII "G4MG" — ce sont des buffers de vertex bruts interleaves.
/// Le stride/format/count proviennent du G4MD associe (descripteur de mesh).

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Drapeaux de format vertex (bitfield).
enum class VertexFormatFlags : uint32_t {
    NONE        = 0x00,
    POSITION    = 0x01,   // float3, 12 octets
    BONE_WEIGHTS = 0x02,  // byte4, 4 octets
    BONE_INDICES = 0x04,  // byte4, 4 octets
    NORMAL      = 0x08,   // float3, 12 octets
    UV0         = 0x10,   // float2, 8 octets
    UV1         = 0x20,   // float2, 8 octets
    COLOR       = 0x40,   // byte4, 4 octets
    TANGENT     = 0x80,   // float3, 12 octets
    BINORMAL    = 0x100,  // float3, 12 octets
};

/// Operateurs bitwise pour VertexFormatFlags.
inline constexpr VertexFormatFlags operator|(VertexFormatFlags a, VertexFormatFlags b) noexcept {
    return static_cast<VertexFormatFlags>(
        static_cast<uint32_t>(a) | static_cast<uint32_t>(b));
}
inline constexpr VertexFormatFlags operator&(VertexFormatFlags a, VertexFormatFlags b) noexcept {
    return static_cast<VertexFormatFlags>(
        static_cast<uint32_t>(a) & static_cast<uint32_t>(b));
}
inline constexpr bool has_flag(VertexFormatFlags flags, VertexFormatFlags test) noexcept {
    return (static_cast<uint32_t>(flags) & static_cast<uint32_t>(test)) != 0;
}

/// Calcule le stride (taille en octets) d'un vertex pour un ensemble de drapeaux.
[[nodiscard]] constexpr uint32_t vertex_stride(VertexFormatFlags flags) noexcept {
    uint32_t stride = 0;
    if (has_flag(flags, VertexFormatFlags::POSITION))     stride += 12;
    if (has_flag(flags, VertexFormatFlags::BONE_WEIGHTS)) stride += 4;
    if (has_flag(flags, VertexFormatFlags::BONE_INDICES)) stride += 4;
    if (has_flag(flags, VertexFormatFlags::NORMAL))       stride += 12;
    if (has_flag(flags, VertexFormatFlags::UV0))          stride += 8;
    if (has_flag(flags, VertexFormatFlags::UV1))          stride += 8;
    if (has_flag(flags, VertexFormatFlags::COLOR))        stride += 4;
    if (has_flag(flags, VertexFormatFlags::TANGENT))      stride += 12;
    if (has_flag(flags, VertexFormatFlags::BINORMAL))     stride += 12;
    return stride;
}

/// Sous-mesh dans un G4MG (subdivision d'un mesh principal).
struct G4mgSubMesh {
    std::string name;
    int vertex_count = 0;
    int index_count = 0;
    int vertex_buffer_offset = 0;
    int index_buffer_offset = 0;
    int material_index = 0;
    VertexFormatFlags format = VertexFormatFlags::POSITION;
};

/// Vertex basique (position + normal + UV).
struct G4mgVertex {
    float position[3] = {};
    float normal[3] = {};
    float uv[2] = {};
};

/// Mesh individuel dans un G4MG.
struct G4mgMesh {
    std::string name;
    uint32_t flags = 0;
    std::vector<G4mgVertex> vertices;
    std::vector<uint32_t> indices;
    std::vector<G4mgSubMesh> sub_meshes;
};

/// Header G4MG parse.
struct G4mgHeader {
    uint32_t magic = 0;
    uint16_t header_size = 0;    // 0x04 (normalement 0x40)
    uint16_t file_type = 0;      // 0x06
    uint32_t version = 0;        // 0x08
    int32_t  content_size = 0;   // 0x0C
    int32_t  mesh_count = 0;     // 0x20
    int16_t  sub_mesh_count = 0; // 0x24
    int16_t  vertex_format_version = 0; // 0x26
    int16_t  unk1 = 0;           // 0x28
    int16_t  unk2 = 0;           // 0x2A
    bool is_big_endian = false;
};

/// Fichier G4MG complet.
/// En production les G4MG ne sont qu'un buffer brut de vertex ; le parseur
/// expose donc `raw_vertex_data` qui doit etre interprete a l'aide du G4MD
/// associe (stride, format, nombre de vertex).
struct G4mgFile {
    G4mgHeader header;
    uint32_t version = 0;
    std::vector<G4mgMesh> meshes;
    std::vector<uint8_t> raw_vertex_data;
};

/// Parse un fichier G4MG depuis un span brut.
[[nodiscard]] std::optional<G4mgFile> g4mg_parse(std::span<const uint8_t> data);

} // namespace iecode::level5
