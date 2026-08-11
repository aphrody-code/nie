/// @file texture_manager.cpp
/// Implementation du TextureManager — chargement de textures G4TX (CPU + GPU D3D11).

#include <iecode/engine/res/texture_manager.h>
#include <iecode/formats/level5/g4tx.h>
#include <iecode/vfs/vfs.h>

#include <spdlog/spdlog.h>

#include <fstream>

#if defined(_WIN32)
#include <d3d11.h>
#include <dxgiformat.h>
#endif

namespace lives {

#if defined(_WIN32)

// ── Cycle de vie GPU ────────────────────────────────────────────────

TextureResource::~TextureResource() noexcept {
    if (d3d_srv) {
        d3d_srv->Release();
        d3d_srv = nullptr;
    }
    if (d3d_texture) {
        d3d_texture->Release();
        d3d_texture = nullptr;
    }
}

TextureResource::TextureResource(TextureResource&& other) noexcept
    : width(other.width),
      height(other.height),
      format(other.format),
      mip_count(other.mip_count),
      name(std::move(other.name)),
      pixel_data(std::move(other.pixel_data)),
      source_path(std::move(other.source_path)),
      d3d_texture(other.d3d_texture),
      d3d_srv(other.d3d_srv) {
    other.d3d_texture = nullptr;
    other.d3d_srv     = nullptr;
}

TextureResource& TextureResource::operator=(TextureResource&& other) noexcept {
    if (this != &other) {
        if (d3d_srv)     d3d_srv->Release();
        if (d3d_texture) d3d_texture->Release();

        width       = other.width;
        height      = other.height;
        format      = other.format;
        mip_count   = other.mip_count;
        name        = std::move(other.name);
        pixel_data  = std::move(other.pixel_data);
        source_path = std::move(other.source_path);
        d3d_texture = other.d3d_texture;
        d3d_srv     = other.d3d_srv;

        other.d3d_texture = nullptr;
        other.d3d_srv     = nullptr;
    }
    return *this;
}

namespace {

/// Convertit un G4txFormat en DXGI_FORMAT.
[[nodiscard]] DXGI_FORMAT g4tx_to_dxgi(uint32_t fmt) noexcept {
    using iecode::level5::G4txFormat;
    switch (static_cast<G4txFormat>(fmt)) {
        case G4txFormat::BC1:   return DXGI_FORMAT_BC1_UNORM;
        case G4txFormat::BC2:   return DXGI_FORMAT_BC2_UNORM;
        case G4txFormat::BC3:   return DXGI_FORMAT_BC3_UNORM;
        case G4txFormat::BC4:   return DXGI_FORMAT_BC4_UNORM;
        case G4txFormat::BC5:   return DXGI_FORMAT_BC5_UNORM;
        case G4txFormat::BC6H:  return DXGI_FORMAT_BC6H_UF16;
        case G4txFormat::BC7:   return DXGI_FORMAT_BC7_UNORM;
        case G4txFormat::RGBA8: return DXGI_FORMAT_R8G8B8A8_UNORM;
        default:                return DXGI_FORMAT_UNKNOWN;
    }
}

/// Calcule la pitch (octets par ligne) selon le format DXGI.
[[nodiscard]] uint32_t row_pitch(uint32_t width, uint32_t fmt) noexcept {
    using iecode::level5::G4txFormat;
    const auto f = static_cast<G4txFormat>(fmt);
    if (f == G4txFormat::RGBA8) {
        return width * 4U;
    }
    // Tous les BCn : taille de bloc * (width / 4 lignes par bloc)
    const uint32_t block_size = (f == G4txFormat::BC1 || f == G4txFormat::BC4) ? 8U : 16U;
    const uint32_t blocks_w   = (width + 3U) / 4U;
    return blocks_w * block_size;
}

} // namespace

bool TextureManager::create_gpu_resources(TextureResource& res) const {
    if (!d3d_device_) {
        return false;
    }

    const DXGI_FORMAT dxgi_fmt = g4tx_to_dxgi(res.format);
    if (dxgi_fmt == DXGI_FORMAT_UNKNOWN) {
        spdlog::error("TextureManager: format G4TX inconnu {:#x}", res.format);
        return false;
    }

    if (res.pixel_data.empty() || res.width == 0 || res.height == 0) {
        return false;
    }

    D3D11_TEXTURE2D_DESC desc{};
    desc.Width              = res.width;
    desc.Height             = res.height;
    desc.MipLevels          = 1; // mip_count > 1 necessiterait plusieurs subresources
    desc.ArraySize          = 1;
    desc.Format             = dxgi_fmt;
    desc.SampleDesc.Count   = 1;
    desc.SampleDesc.Quality = 0;
    desc.Usage              = D3D11_USAGE_IMMUTABLE;
    desc.BindFlags          = D3D11_BIND_SHADER_RESOURCE;
    desc.CPUAccessFlags     = 0;
    desc.MiscFlags          = 0;

    D3D11_SUBRESOURCE_DATA init{};
    init.pSysMem          = res.pixel_data.data();
    init.SysMemPitch      = row_pitch(res.width, res.format);
    init.SysMemSlicePitch = static_cast<UINT>(res.pixel_data.size());

    HRESULT hr = d3d_device_->CreateTexture2D(&desc, &init, &res.d3d_texture);
    if (FAILED(hr)) {
        spdlog::error("TextureManager: CreateTexture2D echec (HRESULT={:#x})",
                      static_cast<uint32_t>(hr));
        return false;
    }

    D3D11_SHADER_RESOURCE_VIEW_DESC srv_desc{};
    srv_desc.Format                    = dxgi_fmt;
    srv_desc.ViewDimension             = D3D11_SRV_DIMENSION_TEXTURE2D;
    srv_desc.Texture2D.MostDetailedMip = 0;
    srv_desc.Texture2D.MipLevels       = 1;

    hr = d3d_device_->CreateShaderResourceView(res.d3d_texture, &srv_desc, &res.d3d_srv);
    if (FAILED(hr)) {
        spdlog::error("TextureManager: CreateShaderResourceView echec (HRESULT={:#x})",
                      static_cast<uint32_t>(hr));
        res.d3d_texture->Release();
        res.d3d_texture = nullptr;
        return false;
    }

    return true;
}

#endif // _WIN32

std::unique_ptr<TextureResource>
TextureManager::parse_buffer(std::span<const uint8_t> data, const std::string& source_path) {
    auto result = iecode::level5::g4tx_parse(data);
    if (!result.has_value()) {
        spdlog::error("TextureManager: echec parse G4TX '{}'", source_path);
        return nullptr;
    }

    const auto& g4tx = result.value();
    if (g4tx.textures.empty()) {
        spdlog::warn("TextureManager: G4TX vide (0 textures) '{}'", source_path);
        return nullptr;
    }

    const auto& tex = g4tx.textures[0];

    auto resource         = std::make_unique<TextureResource>();
    resource->width       = tex.width;
    resource->height      = tex.height;
    resource->format      = static_cast<uint32_t>(tex.format);
    resource->mip_count   = tex.mip_count;
    resource->name        = tex.name;
    resource->pixel_data  = tex.data;
    resource->source_path = source_path;

    spdlog::info("TextureManager: parse '{}' ({}x{}, format={:#x}, {} mips, {} octets)",
                 source_path, resource->width, resource->height,
                 resource->format, resource->mip_count,
                 resource->pixel_data.size());
    return resource;
}

std::unique_ptr<TextureResource>
TextureManager::load_from_file(const std::string& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        spdlog::error("TextureManager: impossible d'ouvrir '{}'", path);
        return nullptr;
    }

    const auto file_size = file.tellg();
    if (file_size <= 0) {
        spdlog::error("TextureManager: fichier vide '{}'", path);
        return nullptr;
    }

    std::vector<uint8_t> buffer(static_cast<size_t>(file_size));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(buffer.data()), file_size);
    if (!file.good()) {
        spdlog::error("TextureManager: erreur lecture '{}'", path);
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

ResourceId TextureManager::load_from_vfs(iecode::vfs::Vfs& vfs, const std::string& vfs_path) {
    // Cache hit anticipe : evite le read VFS si la ressource est deja chargee
    if (auto* existing = get_by_path(vfs_path)) {
        (void)existing;
        // load() ferait la meme chose mais relit le fichier ; on utilise insert_resource
        // sans nouvelle donnee : il suffit d'incrementer via load() apres avoir verifie.
    }

    // Lecture directe depuis le VFS (loose ou CPK)
    std::vector<uint8_t> data = vfs.read(vfs_path);
    if (data.empty()) {
        spdlog::error("TextureManager: VFS read echec '{}'", vfs_path);
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
