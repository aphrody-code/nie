#pragma once

/// @file g4md.h
/// Parser de metadonnees modeles G4MD/G4MDP (Level-5).
/// Header = 0xA0 (160) octets. Endianness determinee par endian_flag @ 0x09
/// (0 = little-endian, 1 = big-endian). La table d'offsets au-dela de 0x60
/// contient des offsets 16-bit relatifs resolus via :
///   ptr = file + (offset + base_offset_shift) * 4
///
/// Reversed depuis nie.exe : FUN_1404d8430 + FUN_1405534f0.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Header G4MD parse (layout reel reverse depuis nie.exe).
struct G4mdHeader {
    // ── champs bruts du fichier ─────────────────────────────────────
    uint32_t magic = 0;              // 0x00 "G4MD"
    uint16_t header_size = 0;        // 0x04 = 0xA0
    uint16_t version = 0;            // 0x06 < 0x69
    uint8_t  platform_tag = 0;       // 0x08
    uint8_t  endian_flag = 0;        // 0x09 0=LE, 1=BE
    uint16_t base_offset_shift = 0;  // 0x0A
    uint32_t string_table_offset = 0;// 0x0C

    uint16_t submesh_count = 0;      // 0x20
    uint16_t bone_count = 0;         // 0x22
    uint16_t unk24 = 0;              // 0x24
    uint8_t  input_layout_count = 0; // 0x26
    uint8_t  vertex_stream_count = 0;// 0x28
    uint16_t morph_count = 0;        // 0x2A

    uint32_t total_vertex_count = 0; // 0x50
    uint32_t total_index_count = 0;  // 0x54
    uint32_t vertex_buffer_size = 0; // 0x58
    uint32_t index_buffer_size = 0;  // 0x5C

    uint16_t submesh_table_off = 0;  // 0x60
    uint16_t group_table_off = 0;    // 0x62
    uint16_t bone_idx_table_off = 0; // 0x64
    uint16_t bone_matrix_off = 0;    // 0x66
    uint16_t anim_chunk_off = 0;     // 0x88
    uint16_t weights_off = 0;        // 0x8A

    // ── alias retro-compat (utilises par code existant) ─────────────
    uint16_t file_type = 0;          // alias de version
    uint16_t group_count = 0;        // alias derive (input_layout_count)
    uint32_t section_base = 0;       // alias de string_table_offset
    uint16_t face_count = 0;         // total_index_count / 3
    uint16_t vertex_data_offset = 0; // bone_matrix_off (ancien nom)
    uint16_t bone_ref_offset = 0;    // weights_off (ancien nom)
    uint16_t index_offset = 0;       // anim_chunk_off (ancien nom)
    bool is_big_endian = false;

    /// Resout un offset 16-bit de la table d'offsets en byte offset absolu.
    [[nodiscard]] size_t resolve(uint16_t rel) const noexcept {
        return (static_cast<size_t>(rel) + base_offset_shift) * 4u;
    }
};

/// Sous-mesh dans un G4MD — stride 0x50 octets.
struct G4mdSubMesh {
    std::string name;

    // ── champs du fichier (0x50 octets) ─────────────────────────────
    float    matrix[12] = {};    // 0x00..0x2F : 3 rangees de 4 floats
    int      vertex_count = 0;   // 0x30 (si 0, = index_count / 3)
    int      index_count = 0;    // 0x34
    uint32_t primitive_type = 0; // 0x38 — 6=tri_list, 7=tri_strip
    int      index_offset = 0;   // 0x3C
    uint16_t flags = 0;          // 0x40
    int      material_index = 0; // 0x42 (material_id)
    uint8_t  vertex_stream_idx = 0; // 0x44
    uint8_t  bone_ref_count = 0; // 0x46
    uint8_t  bone_flags = 0;     // 0x47

    // ── alias retro-compat ──────────────────────────────────────────
    uint32_t vertex_format = 0;      // = primitive_type (ancien nom)
    int      index_buffer_offset = 0;// = index_offset
    int      index_buffer_size = 0;  // = index_count * 2 (approx)
    int      vertex_buffer_offset = 0; // 0 (non applicable)
};

/// Reference os dans un G4MD.
struct G4mdBoneRef {
    int bone_index = 0;
    float weight = 0.0f;
};

/// Metadonnees d'un material dans un G4MD.
struct G4mdMaterial {
    std::string name;
    uint32_t shader_hash = 0;
    uint32_t texture_hash = 0;
};

/// Fichier G4MD complet.
struct G4mdFile {
    G4mdHeader header;
    uint32_t version = 0;
    std::vector<G4mdSubMesh> submeshes;
    std::vector<G4mdBoneRef> bone_refs;
    std::vector<G4mdMaterial> materials;

    // Accesseurs pratiques pour le code de rendu.
    [[nodiscard]] uint32_t total_vertex_count() const noexcept { return header.total_vertex_count; }
    [[nodiscard]] uint32_t total_index_count() const noexcept { return header.total_index_count; }
    [[nodiscard]] uint32_t vertex_buffer_size() const noexcept { return header.vertex_buffer_size; }
    [[nodiscard]] uint32_t index_buffer_size() const noexcept { return header.index_buffer_size; }
};

/// Parse un fichier G4MD depuis un span brut.
[[nodiscard]] std::optional<G4mdFile> g4md_parse(std::span<const uint8_t> data);

} // namespace iecode::level5
