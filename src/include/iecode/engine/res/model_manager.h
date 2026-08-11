#pragma once

/// @file model_manager.h
/// Gestionnaire de modeles 3D G4MG pour le moteur Level-5.
/// Charge les fichiers .g4mg via le parser iecode_core et expose
/// les metadonnees de geometrie.

#include "resource_manager.h"

#include <cstdint>
#include <span>
#include <string>
#include <vector>

#if defined(_WIN32)
struct ID3D11Device;
struct ID3D11Buffer;
#endif

namespace iecode::vfs { class Vfs; }

namespace lives {

/// Ressource modele 3D chargee depuis un G4MG.
struct ModelResource {
    uint32_t vertex_count  = 0;   // Nombre total de vertices
    uint32_t index_count   = 0;   // Nombre total d'indices
    uint32_t submesh_count = 0;   // Nombre de sous-meshes
    uint32_t version       = 0;   // Version du format G4MG
    uint32_t vertex_stride = 0;   // Stride d'un vertex (octets)
    bool is_big_endian     = false;
    std::string source_path;      // Chemin VFS source

    // Donnees CPU brutes (a interpreter via le G4MD associe).
    std::vector<uint8_t> raw_vertex_data;
    std::vector<uint32_t> indices;

#if defined(_WIN32)
    // Ressources GPU D3D11.
    ID3D11Buffer* d3d_vertex_buffer = nullptr;
    ID3D11Buffer* d3d_index_buffer  = nullptr;

    ~ModelResource() noexcept;
    ModelResource() = default;
    ModelResource(const ModelResource&)            = delete;
    ModelResource& operator=(const ModelResource&) = delete;
    ModelResource(ModelResource&&) noexcept;
    ModelResource& operator=(ModelResource&&) noexcept;
#endif
};

/// Alias pour s'aligner sur la nomenclature lives:: de nie.exe.
using CResMesh = ModelResource;

/// Charge et cache les modeles G4MG.
/// Thread-safe (lock interne sur le cache).
class ModelManager final : public ResourceManager<ModelResource> {
public:
#if defined(_WIN32)
    /// Definit le device D3D11 a utiliser pour creer les buffers GPU.
    void set_d3d_device(ID3D11Device* device) noexcept { d3d_device_ = device; }
#endif

    /// Charge un modele depuis le VFS (chemin interne).
    [[nodiscard]] ResourceId load_from_vfs(iecode::vfs::Vfs& vfs, const std::string& vfs_path);

protected:
    /// Charge un modele depuis un fichier .g4mg (filesystem direct).
    std::unique_ptr<ModelResource> load_from_file(const std::string& path) override;

private:
    /// Decode un buffer G4MG en ModelResource (sans GPU).
    [[nodiscard]] static std::unique_ptr<ModelResource>
    parse_buffer(std::span<const uint8_t> data, const std::string& source_path);

#if defined(_WIN32)
    /// Cree les ID3D11Buffer pour vertex et index. false si echec.
    bool create_gpu_resources(ModelResource& res) const;

    ID3D11Device* d3d_device_ = nullptr;
#endif
};

} // namespace lives
