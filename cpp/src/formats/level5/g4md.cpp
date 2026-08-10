#include "iecode/formats/level5/g4md.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>
#include <cstring>

namespace iecode::level5 {

/// Magic G4MD en little-endian et big-endian.
static constexpr uint32_t G4MD_MAGIC_LE = 0x444D3447; // "G4MD" lu en LE
static constexpr uint32_t G4MD_MAGIC_BE = 0x47344D44; // "G4MD" lu en BE

/// Taille du header G4MD = 0xA0 (160 octets).
static constexpr size_t G4MD_MIN_HEADER_SIZE = 0xA0;

/// Stride d'un sous-mesh (0x50 = 80 octets) — reverse FUN_1405534f0.
static constexpr size_t G4MD_SUBMESH_STRIDE = 0x50;

/// Limite de sanite : un G4MD realiste ne depasse pas ~500 sous-meshes.
static constexpr uint16_t G4MD_MAX_SUBMESHES = 500;

/// Verifie que [offset, offset+len) est dans les bornes.
static bool g4md_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

std::optional<G4mdFile> g4md_parse(std::span<const uint8_t> data) {
    if (data.size() < G4MD_MIN_HEADER_SIZE) {
        spdlog::error("g4md_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4MD_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    // Verification du magic (toujours lu en LE puisque c'est "G4MD")
    const uint32_t magic_le = iecode::read_u32_le(base);
    if (magic_le != G4MD_MAGIC_LE && iecode::read_u32_be(base) != MAGIC_G4MD) {
        spdlog::error("g4md_parse: magic invalide ({:#010x})", magic_le);
        return std::nullopt;
    }

    // L'endianness reelle est determinee par le flag @ 0x09 — pas par le magic.
    const uint8_t endian_flag = base[0x09];
    const bool is_big_endian = (endian_flag != 0);

    // Fonctions de lecture adaptees a l'endianness
    auto read_u16 = [is_big_endian, base](size_t off) -> uint16_t {
        return is_big_endian ? iecode::read_u16_be(base + off)
                             : iecode::read_u16_le(base + off);
    };
    auto read_u32 = [is_big_endian, base](size_t off) -> uint32_t {
        return is_big_endian ? iecode::read_u32_be(base + off)
                             : iecode::read_u32_le(base + off);
    };

    // ── Lecture du header (0xA0 octets) ─────────────────────────────
    G4mdHeader header;
    header.magic               = read_u32(0x00);
    header.header_size         = read_u16(0x04);
    header.version             = read_u16(0x06);
    header.platform_tag        = base[0x08];
    header.endian_flag         = endian_flag;
    header.base_offset_shift   = read_u16(0x0A);
    header.string_table_offset = read_u32(0x0C);

    header.submesh_count       = read_u16(0x20);
    header.bone_count          = read_u16(0x22);
    header.unk24               = read_u16(0x24);
    header.input_layout_count  = base[0x26];
    header.vertex_stream_count = base[0x28];
    header.morph_count         = read_u16(0x2A);

    header.total_vertex_count  = read_u32(0x50);
    header.total_index_count   = read_u32(0x54);
    header.vertex_buffer_size  = read_u32(0x58);
    header.index_buffer_size   = read_u32(0x5C);

    header.submesh_table_off   = read_u16(0x60);
    header.group_table_off     = read_u16(0x62);
    header.bone_idx_table_off  = read_u16(0x64);
    header.bone_matrix_off     = read_u16(0x66);
    header.anim_chunk_off      = read_u16(0x88);
    header.weights_off         = read_u16(0x8A);

    // Alias retro-compat
    header.file_type          = header.version;
    header.group_count        = header.input_layout_count;
    header.section_base       = header.string_table_offset;
    header.face_count         = static_cast<uint16_t>(header.total_index_count / 3u);
    header.vertex_data_offset = header.bone_matrix_off;
    header.bone_ref_offset    = header.weights_off;
    header.index_offset       = header.anim_chunk_off;
    header.is_big_endian      = is_big_endian;

    // Sanity check : borne haute realiste
    if (header.submesh_count > G4MD_MAX_SUBMESHES) {
        spdlog::error("g4md_parse: submesh_count={} invalide (>{})",
                      header.submesh_count, G4MD_MAX_SUBMESHES);
        return std::nullopt;
    }
    if (header.header_size != G4MD_MIN_HEADER_SIZE) {
        spdlog::warn("g4md_parse: header_size={:#x} inattendu (attendu {:#x})",
                     header.header_size, G4MD_MIN_HEADER_SIZE);
    }

    spdlog::info("g4md_parse: version={:#x} endian={} submeshes={} bones={} "
                 "verts={} indices={} vbsize={} ibsize={}",
                 header.version, is_big_endian ? "big" : "little",
                 header.submesh_count, header.bone_count,
                 header.total_vertex_count, header.total_index_count,
                 header.vertex_buffer_size, header.index_buffer_size);

    G4mdFile result;
    result.header  = header;
    result.version = header.version;

    // ── Parser les sous-meshes ──────────────────────────────────────
    if (header.submesh_count > 0) {
        const size_t submesh_table_offset = header.resolve(header.submesh_table_off);
        const size_t submesh_table_size = static_cast<size_t>(header.submesh_count) *
                                          G4MD_SUBMESH_STRIDE;

        // Sanity check avec marge 0x50 pour couvrir les paddings en fin de fichier.
        if (submesh_table_offset + submesh_table_size > data.size() + G4MD_SUBMESH_STRIDE) {
            spdlog::error("g4md_parse: table de sous-meshes hors limites "
                          "(offset={:#x} size={} file_size={})",
                          submesh_table_offset, submesh_table_size, data.size());
            return std::nullopt;
        }
        if (!g4md_bounds_check(data, submesh_table_offset,
                               std::min(submesh_table_size, data.size() - submesh_table_offset))) {
            spdlog::error("g4md_parse: table de sous-meshes invalide");
            return std::nullopt;
        }

        result.submeshes.reserve(header.submesh_count);
        for (uint16_t i = 0; i < header.submesh_count; ++i) {
            const size_t off = submesh_table_offset +
                               static_cast<size_t>(i) * G4MD_SUBMESH_STRIDE;
            // Si on depasse le buffer (tolerance marge), on s'arrete proprement.
            if (off + G4MD_SUBMESH_STRIDE > data.size()) {
                spdlog::warn("g4md_parse: troncature submesh[{}] (offset={:#x})", i, off);
                break;
            }

            G4mdSubMesh sub;
            // Matrice 3x4 (12 floats)
            for (int k = 0; k < 12; ++k) {
                const uint32_t bits = read_u32(off + static_cast<size_t>(k) * 4u);
                std::memcpy(&sub.matrix[k], &bits, sizeof(float));
            }
            sub.vertex_count     = static_cast<int>(read_u32(off + 0x30));
            sub.index_count      = static_cast<int>(read_u32(off + 0x34));
            sub.primitive_type   = read_u32(off + 0x38);
            sub.index_offset     = static_cast<int>(read_u32(off + 0x3C));
            sub.flags            = read_u16(off + 0x40);
            sub.material_index   = static_cast<int>(read_u16(off + 0x42));
            sub.vertex_stream_idx = base[off + 0x44];
            sub.bone_ref_count   = base[off + 0x46];
            sub.bone_flags       = base[off + 0x47];

            // Si vertex_count == 0, deduire depuis index_count (triangle list)
            if (sub.vertex_count == 0 && sub.index_count > 0) {
                sub.vertex_count = sub.index_count / 3;
            }

            // Alias retro-compat
            sub.vertex_format        = sub.primitive_type;
            sub.index_buffer_offset  = sub.index_offset;
            sub.index_buffer_size    = sub.index_count * 2; // approx (indices u16)
            sub.vertex_buffer_offset = 0;

            spdlog::debug("g4md_parse: submesh[{}] verts={} indices={} "
                          "prim={} ioff={:#x} mat={} stream={} bones={}",
                          i, sub.vertex_count, sub.index_count, sub.primitive_type,
                          sub.index_offset, sub.material_index,
                          sub.vertex_stream_idx, sub.bone_ref_count);

            result.submeshes.push_back(std::move(sub));
        }
    }

    spdlog::info("g4md_parse: {} sous-meshes parses, vbsize={} ibsize={}",
                 result.submeshes.size(), header.vertex_buffer_size,
                 header.index_buffer_size);
    return result;
}

} // namespace iecode::level5
