#ifdef IECODE_HAS_TINYGLTF
// Eviter les symboles dupliques avec texture_export.cpp
// qui inclut deja STB_IMAGE_WRITE_IMPLEMENTATION
#define TINYGLTF_NO_STB_IMAGE_WRITE
#define TINYGLTF_NO_STB_IMAGE
#define TINYGLTF_IMPLEMENTATION
// tiny_gltf.h fait `#include "json.hpp"` : le single-header de nlohmann, tel que le
// distribuait son dépôt. vcpkg l'installe sous `nlohmann/json.hpp`. On coupe l'inclusion
// automatique et on fournit l'en-tête nous-mêmes — c'est le contrat de la macro.
#define TINYGLTF_NO_INCLUDE_JSON
#include <nlohmann/json.hpp>
#include <tiny_gltf.h>
#endif

#include "iecode/converters/model_export.h"

#include <spdlog/spdlog.h>
#include <cstring>
#include <numeric>

namespace iecode::converters {

#ifdef IECODE_HAS_TINYGLTF

bool export_glb(const level5::G4mgFile& model,
                 const std::filesystem::path& output_path) {
    // Creer le repertoire parent si necessaire
    const auto parent = output_path.parent_path();
    if (!parent.empty()) {
        std::error_code ec;
        std::filesystem::create_directories(parent, ec);
        if (ec) {
            spdlog::error("export_glb: impossible de creer le repertoire '{}'",
                          parent.string());
            return false;
        }
    }

    tinygltf::Model gltf_model;
    gltf_model.asset.version = "2.0";
    gltf_model.asset.generator = "iecode";

    // Scene par defaut
    tinygltf::Scene scene;
    scene.name = "Scene";

    if (model.meshes.empty()) {
        // Modele vide — creer un GLB minimal avec une scene vide
        spdlog::warn("export_glb: modele sans meshes, creation d'un GLB minimal");
        gltf_model.scenes.push_back(scene);
        gltf_model.defaultScene = 0;

        tinygltf::TinyGLTF writer;
        const bool ok = writer.WriteGltfSceneToFile(
            &gltf_model, output_path.string(),
            false,  // embedImages
            true,   // embedBuffers
            true,   // prettyPrint
            true);  // writeBinary (GLB)

        if (!ok) {
            spdlog::error("export_glb: echec de l'ecriture GLB pour '{}'",
                          output_path.string());
            return false;
        }
        spdlog::info("export_glb: GLB minimal exporte vers '{}'", output_path.string());
        return true;
    }

    // ── Buffer unique pour toutes les donnees geometriques ──────────
    tinygltf::Buffer buffer;

    int mesh_idx = 0;
    for (const auto& mesh : model.meshes) {
        if (mesh.vertices.empty()) {
            spdlog::debug("export_glb: mesh '{}' sans vertices, ignore", mesh.name);
            continue;
        }

        tinygltf::Mesh gltf_mesh;
        gltf_mesh.name = mesh.name.empty()
            ? "mesh_" + std::to_string(mesh_idx)
            : mesh.name;

        // ── Positions (float3) ──────────────────────────────────────
        const size_t pos_byte_offset = buffer.data.size();
        const size_t pos_byte_length = mesh.vertices.size() * 3 * sizeof(float);
        buffer.data.resize(pos_byte_offset + pos_byte_length);

        // Calculer les bornes min/max
        float min_pos[3] = { 1e30f,  1e30f,  1e30f};
        float max_pos[3] = {-1e30f, -1e30f, -1e30f};

        for (size_t vi = 0; vi < mesh.vertices.size(); ++vi) {
            const auto& v = mesh.vertices[vi];
            for (int c = 0; c < 3; ++c) {
                if (v.position[c] < min_pos[c]) min_pos[c] = v.position[c];
                if (v.position[c] > max_pos[c]) max_pos[c] = v.position[c];
            }
            std::memcpy(&buffer.data[pos_byte_offset + vi * 12],
                        v.position, 12);
        }

        // BufferView pour les positions
        const auto pos_bv_idx = static_cast<int>(gltf_model.bufferViews.size());
        tinygltf::BufferView pos_bv;
        pos_bv.buffer = 0;
        pos_bv.byteOffset = pos_byte_offset;
        pos_bv.byteLength = pos_byte_length;
        pos_bv.target = TINYGLTF_TARGET_ARRAY_BUFFER;
        gltf_model.bufferViews.push_back(pos_bv);

        // Accessor pour les positions
        const auto pos_acc_idx = static_cast<int>(gltf_model.accessors.size());
        tinygltf::Accessor pos_acc;
        pos_acc.bufferView = pos_bv_idx;
        pos_acc.byteOffset = 0;
        pos_acc.componentType = TINYGLTF_COMPONENT_TYPE_FLOAT;
        pos_acc.count = mesh.vertices.size();
        pos_acc.type = TINYGLTF_TYPE_VEC3;
        pos_acc.minValues = {min_pos[0], min_pos[1], min_pos[2]};
        pos_acc.maxValues = {max_pos[0], max_pos[1], max_pos[2]};
        gltf_model.accessors.push_back(pos_acc);

        // ── Normales (float3) ───────────────────────────────────────
        const size_t norm_byte_offset = buffer.data.size();
        const size_t norm_byte_length = mesh.vertices.size() * 3 * sizeof(float);
        buffer.data.resize(norm_byte_offset + norm_byte_length);

        for (size_t vi = 0; vi < mesh.vertices.size(); ++vi) {
            std::memcpy(&buffer.data[norm_byte_offset + vi * 12],
                        mesh.vertices[vi].normal, 12);
        }

        const auto norm_bv_idx = static_cast<int>(gltf_model.bufferViews.size());
        tinygltf::BufferView norm_bv;
        norm_bv.buffer = 0;
        norm_bv.byteOffset = norm_byte_offset;
        norm_bv.byteLength = norm_byte_length;
        norm_bv.target = TINYGLTF_TARGET_ARRAY_BUFFER;
        gltf_model.bufferViews.push_back(norm_bv);

        const auto norm_acc_idx = static_cast<int>(gltf_model.accessors.size());
        tinygltf::Accessor norm_acc;
        norm_acc.bufferView = norm_bv_idx;
        norm_acc.byteOffset = 0;
        norm_acc.componentType = TINYGLTF_COMPONENT_TYPE_FLOAT;
        norm_acc.count = mesh.vertices.size();
        norm_acc.type = TINYGLTF_TYPE_VEC3;
        gltf_model.accessors.push_back(norm_acc);

        // ── UVs (float2) ───────────────────────────────────────────
        const size_t uv_byte_offset = buffer.data.size();
        const size_t uv_byte_length = mesh.vertices.size() * 2 * sizeof(float);
        buffer.data.resize(uv_byte_offset + uv_byte_length);

        for (size_t vi = 0; vi < mesh.vertices.size(); ++vi) {
            std::memcpy(&buffer.data[uv_byte_offset + vi * 8],
                        mesh.vertices[vi].uv, 8);
        }

        const auto uv_bv_idx = static_cast<int>(gltf_model.bufferViews.size());
        tinygltf::BufferView uv_bv;
        uv_bv.buffer = 0;
        uv_bv.byteOffset = uv_byte_offset;
        uv_bv.byteLength = uv_byte_length;
        uv_bv.target = TINYGLTF_TARGET_ARRAY_BUFFER;
        gltf_model.bufferViews.push_back(uv_bv);

        const auto uv_acc_idx = static_cast<int>(gltf_model.accessors.size());
        tinygltf::Accessor uv_acc;
        uv_acc.bufferView = uv_bv_idx;
        uv_acc.byteOffset = 0;
        uv_acc.componentType = TINYGLTF_COMPONENT_TYPE_FLOAT;
        uv_acc.count = mesh.vertices.size();
        uv_acc.type = TINYGLTF_TYPE_VEC2;
        gltf_model.accessors.push_back(uv_acc);

        // ── Indices ─────────────────────────────────────────────────
        int index_acc_idx = -1;
        if (!mesh.indices.empty()) {
            // Aligner le buffer sur 4 octets pour les u32
            while (buffer.data.size() % 4 != 0) {
                buffer.data.push_back(0);
            }

            const size_t idx_byte_offset = buffer.data.size();
            const size_t idx_byte_length = mesh.indices.size() * sizeof(uint32_t);
            buffer.data.resize(idx_byte_offset + idx_byte_length);
            std::memcpy(&buffer.data[idx_byte_offset],
                        mesh.indices.data(), idx_byte_length);

            const auto idx_bv_idx = static_cast<int>(gltf_model.bufferViews.size());
            tinygltf::BufferView idx_bv;
            idx_bv.buffer = 0;
            idx_bv.byteOffset = idx_byte_offset;
            idx_bv.byteLength = idx_byte_length;
            idx_bv.target = TINYGLTF_TARGET_ELEMENT_ARRAY_BUFFER;
            gltf_model.bufferViews.push_back(idx_bv);

            index_acc_idx = static_cast<int>(gltf_model.accessors.size());
            tinygltf::Accessor idx_acc;
            idx_acc.bufferView = idx_bv_idx;
            idx_acc.byteOffset = 0;
            idx_acc.componentType = TINYGLTF_COMPONENT_TYPE_UNSIGNED_INT;
            idx_acc.count = mesh.indices.size();
            idx_acc.type = TINYGLTF_TYPE_SCALAR;
            gltf_model.accessors.push_back(idx_acc);
        }

        // ── Primitive ───────────────────────────────────────────────
        tinygltf::Primitive prim;
        prim.attributes["POSITION"] = pos_acc_idx;
        prim.attributes["NORMAL"] = norm_acc_idx;
        prim.attributes["TEXCOORD_0"] = uv_acc_idx;
        if (index_acc_idx >= 0) {
            prim.indices = index_acc_idx;
        }
        prim.mode = TINYGLTF_MODE_TRIANGLES;

        gltf_mesh.primitives.push_back(prim);
        const auto gltf_mesh_idx = static_cast<int>(gltf_model.meshes.size());
        gltf_model.meshes.push_back(gltf_mesh);

        // Node pour ce mesh
        tinygltf::Node node;
        node.name = gltf_mesh.name;
        node.mesh = gltf_mesh_idx;
        const auto node_idx = static_cast<int>(gltf_model.nodes.size());
        gltf_model.nodes.push_back(node);
        scene.nodes.push_back(node_idx);

        ++mesh_idx;
    }

    // Buffer global
    gltf_model.buffers.push_back(buffer);

    // Scene
    gltf_model.scenes.push_back(scene);
    gltf_model.defaultScene = 0;

    // Ecriture GLB
    tinygltf::TinyGLTF writer;
    const bool ok = writer.WriteGltfSceneToFile(
        &gltf_model, output_path.string(),
        false,  // embedImages
        true,   // embedBuffers
        true,   // prettyPrint
        true);  // writeBinary (GLB)

    if (!ok) {
        spdlog::error("export_glb: echec de l'ecriture GLB pour '{}'",
                      output_path.string());
        return false;
    }

    spdlog::info("export_glb: {} mesh(es) exporte(s) vers '{}'",
                 mesh_idx, output_path.string());
    return true;
}

#else // !IECODE_HAS_TINYGLTF

bool export_glb(const level5::G4mgFile& /*model*/,
                 const std::filesystem::path& /*output_path*/) {
    spdlog::error("export_glb: tinygltf non disponible (recompiler avec feature render)");
    return false;
}

#endif // IECODE_HAS_TINYGLTF

} // namespace iecode::converters
