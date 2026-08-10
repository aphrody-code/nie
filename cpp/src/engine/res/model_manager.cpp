/// @file model_manager.cpp
/// Implementation du ModelManager — chargement de modeles G4MG (CPU + GPU D3D11).

#include <iecode/engine/res/model_manager.h>
#include <iecode/formats/level5/g4mg.h>
#include <iecode/vfs/vfs.h>

#include <spdlog/spdlog.h>

#include <cstring>
#include <fstream>

#if defined(_WIN32)
#include <d3d11.h>
#endif

namespace lives {

#if defined(_WIN32)

ModelResource::~ModelResource() noexcept {
    if (d3d_index_buffer) {
        d3d_index_buffer->Release();
        d3d_index_buffer = nullptr;
    }
    if (d3d_vertex_buffer) {
        d3d_vertex_buffer->Release();
        d3d_vertex_buffer = nullptr;
    }
}

ModelResource::ModelResource(ModelResource&& other) noexcept
    : vertex_count(other.vertex_count),
      index_count(other.index_count),
      submesh_count(other.submesh_count),
      version(other.version),
      vertex_stride(other.vertex_stride),
      is_big_endian(other.is_big_endian),
      source_path(std::move(other.source_path)),
      raw_vertex_data(std::move(other.raw_vertex_data)),
      indices(std::move(other.indices)),
      d3d_vertex_buffer(other.d3d_vertex_buffer),
      d3d_index_buffer(other.d3d_index_buffer) {
    other.d3d_vertex_buffer = nullptr;
    other.d3d_index_buffer  = nullptr;
}

ModelResource& ModelResource::operator=(ModelResource&& other) noexcept {
    if (this != &other) {
        if (d3d_index_buffer)  d3d_index_buffer->Release();
        if (d3d_vertex_buffer) d3d_vertex_buffer->Release();

        vertex_count      = other.vertex_count;
        index_count       = other.index_count;
        submesh_count     = other.submesh_count;
        version           = other.version;
        vertex_stride     = other.vertex_stride;
        is_big_endian     = other.is_big_endian;
        source_path       = std::move(other.source_path);
        raw_vertex_data   = std::move(other.raw_vertex_data);
        indices           = std::move(other.indices);
        d3d_vertex_buffer = other.d3d_vertex_buffer;
        d3d_index_buffer  = other.d3d_index_buffer;

        other.d3d_vertex_buffer = nullptr;
        other.d3d_index_buffer  = nullptr;
    }
    return *this;
}

bool ModelManager::create_gpu_resources(ModelResource& res) const {
    if (!d3d_device_) return false;

    // Vertex buffer
    if (!res.raw_vertex_data.empty()) {
        D3D11_BUFFER_DESC vb_desc{};
        vb_desc.ByteWidth      = static_cast<UINT>(res.raw_vertex_data.size());
        vb_desc.Usage          = D3D11_USAGE_IMMUTABLE;
        vb_desc.BindFlags      = D3D11_BIND_VERTEX_BUFFER;
        vb_desc.CPUAccessFlags = 0;

        D3D11_SUBRESOURCE_DATA init{};
        init.pSysMem = res.raw_vertex_data.data();

        HRESULT hr = d3d_device_->CreateBuffer(&vb_desc, &init, &res.d3d_vertex_buffer);
        if (FAILED(hr)) {
            spdlog::error("ModelManager: CreateBuffer (VB) echec (HRESULT={:#x})",
                          static_cast<uint32_t>(hr));
            return false;
        }
    }

    // Index buffer (uint32)
    if (!res.indices.empty()) {
        D3D11_BUFFER_DESC ib_desc{};
        ib_desc.ByteWidth      = static_cast<UINT>(res.indices.size() * sizeof(uint32_t));
        ib_desc.Usage          = D3D11_USAGE_IMMUTABLE;
        ib_desc.BindFlags      = D3D11_BIND_INDEX_BUFFER;
        ib_desc.CPUAccessFlags = 0;

        D3D11_SUBRESOURCE_DATA init{};
        init.pSysMem = res.indices.data();

        HRESULT hr = d3d_device_->CreateBuffer(&ib_desc, &init, &res.d3d_index_buffer);
        if (FAILED(hr)) {
            spdlog::error("ModelManager: CreateBuffer (IB) echec (HRESULT={:#x})",
                          static_cast<uint32_t>(hr));
            return false;
        }
    }

    return true;
}

#endif // _WIN32

std::unique_ptr<ModelResource>
ModelManager::parse_buffer(std::span<const uint8_t> data, const std::string& source_path) {
    auto result = iecode::level5::g4mg_parse(data);
    if (!result.has_value()) {
        spdlog::error("ModelManager: echec parse G4MG '{}'", source_path);
        return nullptr;
    }

    const auto& g4mg = result.value();

    auto resource           = std::make_unique<ModelResource>();
    resource->version       = g4mg.version;
    resource->is_big_endian = g4mg.header.is_big_endian;
    resource->source_path   = source_path;

    // Totalise vertices/indices/submeshes sur tous les meshes
    uint32_t total_vertices  = 0;
    uint32_t total_indices   = 0;
    uint32_t total_submeshes = 0;
    for (const auto& mesh : g4mg.meshes) {
        total_vertices  += static_cast<uint32_t>(mesh.vertices.size());
        total_indices   += static_cast<uint32_t>(mesh.indices.size());
        total_submeshes += static_cast<uint32_t>(mesh.sub_meshes.size());

        // Concatene les indices CPU pour le buffer GPU
        resource->indices.insert(resource->indices.end(),
                                 mesh.indices.begin(), mesh.indices.end());
    }

    resource->vertex_count  = total_vertices;
    resource->index_count   = total_indices;
    resource->submesh_count = total_submeshes;

    // En production les G4MG sont des buffers vertex bruts : on les expose tels quels.
    // Sinon on serialise les G4mgVertex (POSITION + NORMAL + UV0 = 32 octets).
    if (!g4mg.raw_vertex_data.empty()) {
        resource->raw_vertex_data = g4mg.raw_vertex_data;
        if (total_vertices > 0) {
            resource->vertex_stride =
                static_cast<uint32_t>(g4mg.raw_vertex_data.size() / total_vertices);
        }
    } else if (total_vertices > 0) {
        constexpr uint32_t basic_stride = sizeof(float) * 8U; // pos3+norm3+uv2
        resource->vertex_stride = basic_stride;
        resource->raw_vertex_data.resize(static_cast<size_t>(total_vertices) * basic_stride);
        size_t cursor = 0;
        for (const auto& mesh : g4mg.meshes) {
            for (const auto& v : mesh.vertices) {
                std::memcpy(resource->raw_vertex_data.data() + cursor,
                            &v, basic_stride);
                cursor += basic_stride;
            }
        }
    }

    spdlog::info("ModelManager: parse '{}' ({} vertices, stride={}, {} indices, {} submeshes)",
                 source_path, resource->vertex_count, resource->vertex_stride,
                 resource->index_count, resource->submesh_count);
    return resource;
}

std::unique_ptr<ModelResource>
ModelManager::load_from_file(const std::string& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        spdlog::error("ModelManager: impossible d'ouvrir '{}'", path);
        return nullptr;
    }

    const auto file_size = file.tellg();
    if (file_size <= 0) {
        spdlog::error("ModelManager: fichier vide '{}'", path);
        return nullptr;
    }

    std::vector<uint8_t> buffer(static_cast<size_t>(file_size));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(buffer.data()), file_size);
    if (!file.good()) {
        spdlog::error("ModelManager: erreur lecture '{}'", path);
        return nullptr;
    }
    file.close();

    auto res = parse_buffer(buffer, path);
#if defined(_WIN32)
    if (res && d3d_device_) {
        create_gpu_resources(*res);
    }
#endif
    return res;
}

ResourceId ModelManager::load_from_vfs(iecode::vfs::Vfs& vfs, const std::string& vfs_path) {
    std::vector<uint8_t> data = vfs.read(vfs_path);
    if (data.empty()) {
        spdlog::error("ModelManager: VFS read echec '{}'", vfs_path);
        return INVALID_RESOURCE_ID;
    }

    auto res = parse_buffer(data, vfs_path);
    if (!res) {
        return INVALID_RESOURCE_ID;
    }

#if defined(_WIN32)
    if (d3d_device_) {
        create_gpu_resources(*res);
    }
#endif

    return insert_resource(vfs_path, std::move(res));
}

} // namespace lives
