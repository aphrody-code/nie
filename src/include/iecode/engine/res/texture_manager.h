#pragma once

/// @file texture_manager.h
/// Gestionnaire de textures G4TX pour le moteur Level-5.
/// Charge les fichiers .g4tx via le parser iecode_core et expose
/// les metadonnees + pixels decodes.

#include "resource_manager.h"

#include <cstdint>
#include <span>
#include <string>
#include <vector>

#if defined(_WIN32)
struct ID3D11Device;
struct ID3D11Texture2D;
struct ID3D11ShaderResourceView;
#endif

namespace iecode::vfs { class Vfs; }

namespace lives {

/// Ressource texture chargee depuis un G4TX.
/// Contient les pixels CPU + (optionnel) la ressource GPU D3D11.
struct TextureResource {
    uint32_t width  = 0;        // Largeur en pixels
    uint32_t height = 0;        // Hauteur en pixels
    uint32_t format = 0;        // Format GPU (G4txFormat cast)
    uint8_t  mip_count = 1;     // Nombre de niveaux de mipmap
    std::string name;           // Nom interne de la texture
    std::vector<uint8_t> pixel_data;  // Donnees brutes (BCn compresse ou RGBA8)
    std::string source_path;    // Chemin VFS source

#if defined(_WIN32)
    // Ressources GPU D3D11 (createes par TextureManager::create_gpu_resources()).
    // Ownership = TextureResource (Release() dans le destructeur).
    ID3D11Texture2D*          d3d_texture = nullptr;
    ID3D11ShaderResourceView* d3d_srv     = nullptr;

    ~TextureResource() noexcept;
    TextureResource() = default;
    TextureResource(const TextureResource&)            = delete;
    TextureResource& operator=(const TextureResource&) = delete;
    TextureResource(TextureResource&&) noexcept;
    TextureResource& operator=(TextureResource&&) noexcept;
#endif
};

/// Alias pour s'aligner sur la nomenclature lives:: de nie.exe.
using CResTexture = TextureResource;

/// Charge et cache les textures G4TX.
/// Thread-safe (lock interne sur le cache).
class TextureManager final : public ResourceManager<TextureResource> {
public:
#if defined(_WIN32)
    /// Definit le device D3D11 a utiliser pour creer les ressources GPU.
    /// Si nullptr, les chargements ne creent que les pixels CPU.
    void set_d3d_device(ID3D11Device* device) noexcept { d3d_device_ = device; }
#endif

    /// Charge une texture depuis le VFS (chemin interne ex:
    /// "data/common/chr/.../file.g4tx"). Cree aussi la ressource GPU si
    /// un device D3D11 est configure.
    [[nodiscard]] ResourceId load_from_vfs(iecode::vfs::Vfs& vfs, const std::string& vfs_path);

protected:
    /// Charge une texture depuis un fichier .g4tx (filesystem direct).
    std::unique_ptr<TextureResource> load_from_file(const std::string& path) override;

private:
    /// Decode les pixels G4TX d'un buffer en TextureResource (sans GPU).
    [[nodiscard]] static std::unique_ptr<TextureResource>
    parse_buffer(std::span<const uint8_t> data, const std::string& source_path);

#if defined(_WIN32)
    /// Cree le couple ID3D11Texture2D + SRV pour une ressource deja parse.
    /// Retourne false en cas d'echec (la ressource reste utilisable cote CPU).
    bool create_gpu_resources(TextureResource& res) const;

    ID3D11Device* d3d_device_ = nullptr;
#endif
};

} // namespace lives
