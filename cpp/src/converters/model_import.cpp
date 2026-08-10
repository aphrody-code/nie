#ifdef IECODE_HAS_TINYGLTF
// stb_image et stb_image_write deja inclus dans d'autres TU
#define TINYGLTF_NO_STB_IMAGE_WRITE
#define TINYGLTF_NO_STB_IMAGE
#define TINYGLTF_NO_INCLUDE_STB_IMAGE
#define TINYGLTF_NO_INCLUDE_STB_IMAGE_WRITE
#include <tiny_gltf.h>
#endif

#include "iecode/converters/model_import.h"
#include "iecode/formats/level5/g4mg.h"
#include "iecode/formats/level5/g4md.h"
#include "iecode/types.h"

#include <spdlog/spdlog.h>
#include <cstring>
#include <fstream>

namespace iecode::converters {

#ifdef IECODE_HAS_TINYGLTF

// ── Constantes ─────────────────────────────────────────────────────

static constexpr uint32_t G4MG_MAGIC_LE     = 0x474D3447;
static constexpr uint32_t G4MD_MAGIC_LE     = 0x444D3447;
static constexpr size_t   G4MG_HEADER_SIZE  = 0x40;
static constexpr size_t   G4MD_HEADER_SIZE  = 0x44;
static constexpr size_t   G4MD_SUBMESH_SIZE = 0x10;

// ── Helpers ────────────────────────────────────────────────────────

/// Lit les donnees d'un accessor tinygltf dans un vector de floats.
static std::vector<float> read_accessor_float(
    const tinygltf::Model& model, int accessor_idx, int expected_components)
{
    if (accessor_idx < 0 || accessor_idx >= static_cast<int>(model.accessors.size()))
        return {};

    const auto& accessor = model.accessors[static_cast<size_t>(accessor_idx)];
    const auto& buffer_view = model.bufferViews[static_cast<size_t>(accessor.bufferView)];
    const auto& buffer = model.buffers[static_cast<size_t>(buffer_view.buffer)];

    const size_t byte_stride = buffer_view.byteStride > 0
        ? buffer_view.byteStride
        : static_cast<size_t>(expected_components) * sizeof(float);

    std::vector<float> result(accessor.count * static_cast<size_t>(expected_components));

    for (size_t i = 0; i < accessor.count; ++i) {
        const size_t byte_offset = buffer_view.byteOffset + accessor.byteOffset + i * byte_stride;
        const auto* src = buffer.data.data() + byte_offset;

        for (int c = 0; c < expected_components; ++c) {
            if (accessor.componentType == TINYGLTF_COMPONENT_TYPE_FLOAT) {
                float val;
                std::memcpy(&val, src + static_cast<size_t>(c) * sizeof(float), sizeof(float));
                result[i * static_cast<size_t>(expected_components) + static_cast<size_t>(c)] = val;
            }
        }
    }
    return result;
}

/// Lit les indices d'un accessor tinygltf.
static std::vector<uint16_t> read_indices_u16(const tinygltf::Model& model, int accessor_idx) {
    if (accessor_idx < 0 || accessor_idx >= static_cast<int>(model.accessors.size()))
        return {};

    const auto& accessor = model.accessors[static_cast<size_t>(accessor_idx)];
    const auto& buffer_view = model.bufferViews[static_cast<size_t>(accessor.bufferView)];
    const auto& buffer = model.buffers[static_cast<size_t>(buffer_view.buffer)];

    std::vector<uint16_t> result(accessor.count);

    for (size_t i = 0; i < accessor.count; ++i) {
        const size_t byte_offset = buffer_view.byteOffset + accessor.byteOffset;
        const auto* src = buffer.data.data() + byte_offset;

        switch (accessor.componentType) {
            case TINYGLTF_COMPONENT_TYPE_UNSIGNED_SHORT: {
                uint16_t val;
                std::memcpy(&val, src + i * 2, 2);
                result[i] = val;
                break;
            }
            case TINYGLTF_COMPONENT_TYPE_UNSIGNED_INT: {
                uint32_t val;
                std::memcpy(&val, src + i * 4, 4);
                result[i] = static_cast<uint16_t>(val);
                break;
            }
            case TINYGLTF_COMPONENT_TYPE_UNSIGNED_BYTE: {
                result[i] = static_cast<uint16_t>(src[i]);
                break;
            }
            default:
                result[i] = 0;
                break;
        }
    }
    return result;
}

/// Serialise le header G4MG.
static std::vector<uint8_t> serialize_g4mg(
    int mesh_count, int sub_mesh_count, int content_size)
{
    std::vector<uint8_t> data(G4MG_HEADER_SIZE, 0);
    auto* p = data.data();

    write_u32_le(p + 0x00, G4MG_MAGIC_LE);
    write_u16_le(p + 0x04, static_cast<uint16_t>(G4MG_HEADER_SIZE));  // header_size
    write_u16_le(p + 0x06, 0x0001);                                    // file_type
    write_u32_le(p + 0x08, 0x00010000);                                // version
    write_u32_le(p + 0x0C, static_cast<uint32_t>(content_size));       // content_size
    write_u32_le(p + 0x20, static_cast<uint32_t>(mesh_count));
    write_u16_le(p + 0x24, static_cast<uint16_t>(sub_mesh_count));
    write_u16_le(p + 0x26, 0x0001);                                    // vertex_format_version

    return data;
}

/// Serialise un G4MD complet avec les donnees de vertex et d'index.
static std::vector<uint8_t> serialize_g4md(
    const std::vector<std::vector<float>>& positions,
    const std::vector<std::vector<float>>& normals,
    const std::vector<std::vector<float>>& uvs,
    const std::vector<std::vector<uint16_t>>& indices)
{
    const size_t mesh_count = positions.size();

    // Chaque mesh = 1 submesh dans G4MD
    const size_t submesh_table_size = mesh_count * G4MD_SUBMESH_SIZE;

    // section_base: on veut section_offset(0) = G4MD_HEADER_SIZE + submesh_table_size
    // => (section_base + 0) * 4 = G4MD_HEADER_SIZE + submesh_table_size
    // => section_base = (G4MD_HEADER_SIZE + submesh_table_size) / 4
    const size_t data_start = G4MD_HEADER_SIZE + submesh_table_size;
    // Aligner sur 4
    const size_t data_start_aligned = (data_start + 3) & ~static_cast<size_t>(3);
    const auto section_base = static_cast<uint16_t>(data_start_aligned / 4);

    // Calculer les tailles des buffers vertex et index
    // Vertex format: POSITION(12) + NORMAL(12) + UV0(8) = 32 octets/vertex
    constexpr uint32_t vertex_format = 0x19;  // POSITION | NORMAL | UV0

    // Preparer les buffers de donnees
    std::vector<uint8_t> vertex_buffer;
    std::vector<uint8_t> index_buffer;

    struct SubmeshInfo {
        uint16_t vertex_count;
        uint16_t index_count;
        uint16_t vertex_buf_offset;  // Relatif a section_base, en unites de 4 octets
        uint16_t index_buf_offset;
        uint16_t index_buf_size;
    };
    std::vector<SubmeshInfo> submesh_infos;

    for (size_t mi = 0; mi < mesh_count; ++mi) {
        const auto& pos = positions[mi];
        const auto& nrm = normals[mi];
        const auto& uv = uvs[mi];
        const auto& idx = indices[mi];

        const size_t vert_count = pos.size() / 3;
        const size_t idx_count = idx.size();

        SubmeshInfo info = {};
        info.vertex_count = static_cast<uint16_t>(vert_count);
        info.index_count = static_cast<uint16_t>(idx_count);

        // Offset du vertex buffer relatif a data_start_aligned (en u16, unites de 4 octets)
        info.vertex_buf_offset = static_cast<uint16_t>(vertex_buffer.size() / 4);

        // Ecrire les vertices
        for (size_t vi = 0; vi < vert_count; ++vi) {
            // Position (float3, 12 octets)
            uint8_t tmp[4];
            for (int c = 0; c < 3; ++c) {
                float val = (vi * 3 + static_cast<size_t>(c) < pos.size())
                    ? pos[vi * 3 + static_cast<size_t>(c)] : 0.0f;
                std::memcpy(tmp, &val, 4);
                vertex_buffer.insert(vertex_buffer.end(), tmp, tmp + 4);
            }
            // Normal (float3, 12 octets)
            for (int c = 0; c < 3; ++c) {
                float val = (vi * 3 + static_cast<size_t>(c) < nrm.size())
                    ? nrm[vi * 3 + static_cast<size_t>(c)] : 0.0f;
                std::memcpy(tmp, &val, 4);
                vertex_buffer.insert(vertex_buffer.end(), tmp, tmp + 4);
            }
            // UV0 (float2, 8 octets)
            for (int c = 0; c < 2; ++c) {
                float val = (vi * 2 + static_cast<size_t>(c) < uv.size())
                    ? uv[vi * 2 + static_cast<size_t>(c)] : 0.0f;
                std::memcpy(tmp, &val, 4);
                vertex_buffer.insert(vertex_buffer.end(), tmp, tmp + 4);
            }
        }

        // Aligner le vertex buffer sur 4 octets
        while (vertex_buffer.size() % 4 != 0) vertex_buffer.push_back(0);

        // Index buffer offset
        info.index_buf_offset = static_cast<uint16_t>(
            (vertex_buffer.size() + index_buffer.size()) / 4);

        // Ecrire les indices (u16)
        const size_t idx_start = index_buffer.size();
        for (const auto& i : idx) {
            uint8_t tmp[2];
            write_u16_le(tmp, i);
            index_buffer.insert(index_buffer.end(), tmp, tmp + 2);
        }
        info.index_buf_size = static_cast<uint16_t>(
            (index_buffer.size() - idx_start) / 4);

        // Aligner le index buffer sur 4 octets
        while (index_buffer.size() % 4 != 0) index_buffer.push_back(0);

        submesh_infos.push_back(info);
    }

    // vertex_data_offset relatif: 0 (les donnees commencent a section_offset(0))
    const uint16_t vertex_data_rel = 0;
    const auto index_rel = static_cast<uint16_t>(vertex_buffer.size() / 4);

    // Taille totale du fichier
    const size_t total_size = data_start_aligned + vertex_buffer.size() + index_buffer.size();

    std::vector<uint8_t> output(total_size, 0);
    auto* p = output.data();

    // ── Header G4MD ────────────────────────────────────────────────
    write_u32_le(p + 0x00, G4MD_MAGIC_LE);
    write_u16_le(p + 0x04, 0x0044);              // field04 (header+submesh)
    write_u16_le(p + 0x06, 0x0001);              // field06
    p[0x08] = 0;                                  // field08
    p[0x09] = 0;                                  // field09
    write_u16_le(p + 0x0A, section_base);
    write_u32_le(p + 0x0C, 0);                   // field0c
    write_u16_le(p + 0x20, static_cast<uint16_t>(mesh_count));  // submesh_count
    write_u16_le(p + 0x22, 0);                   // face_count (unused)
    p[0x24] = 0;                                  // bone_count
    write_u32_le(p + 0x28, 0);                   // field28
    write_u32_le(p + 0x2C, 0);                   // field2c
    write_u16_le(p + 0x30, vertex_data_rel);     // vertex_data_offset
    write_u16_le(p + 0x32, 0);                   // bone_ref_offset (pas de bones)
    write_u16_le(p + 0x3C, index_rel);           // index_offset
    write_u16_le(p + 0x40, 0);                   // field40
    write_u16_le(p + 0x42, 0);                   // field42

    // ── Submesh table (a offset 0x44, stride 0x10) ─────────────────
    for (size_t i = 0; i < mesh_count; ++i) {
        const auto& info = submesh_infos[i];
        auto* sm = p + G4MD_HEADER_SIZE + i * G4MD_SUBMESH_SIZE;

        write_u16_le(sm + 0x00, info.index_count);
        write_u16_le(sm + 0x02, 0);              // material_index
        write_u32_le(sm + 0x04, vertex_format);
        write_u16_le(sm + 0x08, info.vertex_count);
        write_u16_le(sm + 0x0A, info.vertex_buf_offset);
        write_u16_le(sm + 0x0C, info.index_buf_offset);
        write_u16_le(sm + 0x0E, info.index_buf_size);
    }

    // ── Donnees vertex + index ─────────────────────────────────────
    std::memcpy(p + data_start_aligned, vertex_buffer.data(), vertex_buffer.size());
    std::memcpy(p + data_start_aligned + vertex_buffer.size(),
                index_buffer.data(), index_buffer.size());

    return output;
}

// ── import_glb ─────────────────────────────────────────────────────

std::optional<ModelImportResult> import_glb(
    const std::filesystem::path& glb_path,
    const ModelImportOptions& options)
{
    if (!std::filesystem::exists(glb_path)) {
        spdlog::error("import_glb: fichier introuvable '{}'", glb_path.string());
        return std::nullopt;
    }

    // Charger le GLB via tinygltf
    tinygltf::Model model;
    tinygltf::TinyGLTF loader;
    std::string err, warn;

    bool ok = loader.LoadBinaryFromFile(&model, &err, &warn, glb_path.string());
    if (!warn.empty()) spdlog::warn("import_glb: {}", warn);
    if (!ok) {
        spdlog::error("import_glb: echec du chargement '{}' — {}", glb_path.string(), err);
        return std::nullopt;
    }

    if (model.meshes.empty()) {
        spdlog::error("import_glb: aucun mesh dans le GLB");
        return std::nullopt;
    }

    // Extraire les donnees de chaque mesh/primitive
    std::vector<std::vector<float>> all_positions;
    std::vector<std::vector<float>> all_normals;
    std::vector<std::vector<float>> all_uvs;
    std::vector<std::vector<uint16_t>> all_indices;

    int total_vertices = 0;
    int total_indices = 0;

    for (const auto& mesh : model.meshes) {
        for (const auto& prim : mesh.primitives) {
            // Positions
            int pos_idx = -1;
            int norm_idx = -1;
            int uv_idx = -1;

            auto it = prim.attributes.find("POSITION");
            if (it != prim.attributes.end()) pos_idx = it->second;

            it = prim.attributes.find("NORMAL");
            if (it != prim.attributes.end()) norm_idx = it->second;

            it = prim.attributes.find("TEXCOORD_0");
            if (it != prim.attributes.end()) uv_idx = it->second;

            if (pos_idx < 0) {
                spdlog::warn("import_glb: primitive sans POSITION, ignoree");
                continue;
            }

            auto positions = read_accessor_float(model, pos_idx, 3);
            auto normals = read_accessor_float(model, norm_idx, 3);
            auto uvs = read_accessor_float(model, uv_idx, 2);

            const size_t vert_count = positions.size() / 3;

            // Generer des normales nulles si absentes
            if (normals.empty()) {
                normals.resize(vert_count * 3, 0.0f);
            }
            // Generer des UVs nulles si absentes
            if (uvs.empty()) {
                uvs.resize(vert_count * 2, 0.0f);
            }

            // Indices
            auto indices = read_indices_u16(model, prim.indices);
            if (indices.empty()) {
                // Pas d'indices — generer un draw sequentiel
                indices.resize(vert_count);
                for (size_t i = 0; i < vert_count; ++i) {
                    indices[i] = static_cast<uint16_t>(i);
                }
            }

            total_vertices += static_cast<int>(vert_count);
            total_indices += static_cast<int>(indices.size());

            all_positions.push_back(std::move(positions));
            all_normals.push_back(std::move(normals));
            all_uvs.push_back(std::move(uvs));
            all_indices.push_back(std::move(indices));
        }
    }

    if (all_positions.empty()) {
        spdlog::error("import_glb: aucune primitive valide");
        return std::nullopt;
    }

    spdlog::info("import_glb: {} primitive(s), {} vertices, {} indices",
                 all_positions.size(), total_vertices, total_indices);

    // Calculer content_size pour G4MG (approximation)
    const int content_size = total_vertices * 32 + total_indices * 2;

    ModelImportResult result;
    result.g4mg_data = serialize_g4mg(
        static_cast<int>(all_positions.size()),
        static_cast<int>(all_positions.size()),
        content_size);

    if (options.export_g4md) {
        result.g4md_data = serialize_g4md(all_positions, all_normals, all_uvs, all_indices);
    }

    return result;
}

#else // !IECODE_HAS_TINYGLTF

std::optional<ModelImportResult> import_glb(
    const std::filesystem::path& /*glb_path*/,
    const ModelImportOptions& /*options*/)
{
    spdlog::error("import_glb: tinygltf non disponible (recompiler avec feature render)");
    return std::nullopt;
}

#endif // IECODE_HAS_TINYGLTF

// ── import_glb_to_g4mg ─────────────────────────────────────────────

bool import_glb_to_g4mg(
    const std::filesystem::path& glb_path,
    const std::filesystem::path& g4mg_path,
    const std::filesystem::path& g4md_path_in,
    const ModelImportOptions& options)
{
    auto result = import_glb(glb_path, options);
    if (!result) return false;

    // Creer les repertoires parents
    auto create_parent = [](const std::filesystem::path& p) {
        const auto parent = p.parent_path();
        if (!parent.empty()) {
            std::error_code ec;
            std::filesystem::create_directories(parent, ec);
        }
    };

    // Ecrire G4MG
    create_parent(g4mg_path);
    {
        std::ofstream out(g4mg_path, std::ios::binary);
        if (!out) {
            spdlog::error("import_glb_to_g4mg: impossible d'ouvrir '{}'", g4mg_path.string());
            return false;
        }
        out.write(reinterpret_cast<const char*>(result->g4mg_data.data()),
                  static_cast<std::streamsize>(result->g4mg_data.size()));
        if (!out.good()) return false;
    }

    // Ecrire G4MD
    if (options.export_g4md && !result->g4md_data.empty()) {
        auto g4md_path = g4md_path_in;
        if (g4md_path.empty()) {
            g4md_path = g4mg_path;
            g4md_path.replace_extension(".g4md");
        }
        create_parent(g4md_path);
        std::ofstream out(g4md_path, std::ios::binary);
        if (!out) {
            spdlog::error("import_glb_to_g4mg: impossible d'ouvrir '{}'", g4md_path.string());
            return false;
        }
        out.write(reinterpret_cast<const char*>(result->g4md_data.data()),
                  static_cast<std::streamsize>(result->g4md_data.size()));
        if (!out.good()) return false;

        spdlog::info("import_glb_to_g4mg: '{}' + '{}' crees",
                     g4mg_path.string(), g4md_path.string());
    } else {
        spdlog::info("import_glb_to_g4mg: '{}' cree", g4mg_path.string());
    }

    return true;
}

} // namespace iecode::converters
