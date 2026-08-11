// Implementation unique des librairies vendored (un seul .cpp)
#define BCDEC_IMPLEMENTATION
#include <bcdec.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include "iecode/converters/texture_export.h"
#include "iecode/formats/level5/nxtch.h"

#include <spdlog/spdlog.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <vector>

namespace iecode::converters {

// ── Decodage BCn vers RGBA8 ─────────────────────────────────────────

/// Decode un buffer BCn en RGBA8 (4 octets/pixel).
/// @param src donnees compressees
/// @param width largeur en pixels
/// @param height hauteur en pixels
/// @param format format BCn (G4txFormat)
/// @return buffer RGBA8 ou vide en cas d'erreur
[[nodiscard]] static std::vector<uint8_t> decode_bcn_to_rgba8(
    const uint8_t* src, size_t src_size,
    int width, int height,
    level5::G4txFormat format)
{
    if (width <= 0 || height <= 0) {
        spdlog::error("decode_bcn: dimensions invalides ({}x{})", width, height);
        return {};
    }

    const size_t pixel_count = static_cast<size_t>(width) * static_cast<size_t>(height);
    std::vector<uint8_t> output(pixel_count * 4, 0);

    // Nombre de blocs 4x4
    const int blocks_x = (width + 3) / 4;
    const int blocks_y = (height + 3) / 4;

    // Taille d'un bloc compresse
    size_t block_size = 0;
    switch (format) {
        case level5::G4txFormat::BC1:  block_size = BCDEC_BC1_BLOCK_SIZE; break;
        case level5::G4txFormat::BC2:  block_size = BCDEC_BC2_BLOCK_SIZE; break;
        case level5::G4txFormat::BC3:  block_size = BCDEC_BC3_BLOCK_SIZE; break;
        case level5::G4txFormat::BC4:  block_size = BCDEC_BC4_BLOCK_SIZE; break;
        case level5::G4txFormat::BC5:  block_size = BCDEC_BC5_BLOCK_SIZE; break;
        case level5::G4txFormat::BC7:  block_size = BCDEC_BC7_BLOCK_SIZE; break;
        default:
            spdlog::error("decode_bcn: format non supporte ({:#x})",
                          static_cast<uint32_t>(format));
            return {};
    }

    const size_t expected_size = static_cast<size_t>(blocks_x) *
                                 static_cast<size_t>(blocks_y) * block_size;
    if (src_size < expected_size) {
        spdlog::warn("decode_bcn: donnees trop courtes ({} octets, attendu {} pour {}x{} format {:#x})",
                     src_size, expected_size, width, height, static_cast<uint32_t>(format));
        // On continue quand meme, les blocs manquants resteront noirs
    }

    // Buffer temporaire pour un bloc 4x4 decode
    // BC1/2/3/7 => 4x4 RGBA8 = 64 octets
    // BC4 => 4x4 R8 = 16 octets
    // BC5 => 4x4 RG8 = 32 octets
    uint8_t block_rgba[4 * 4 * 4]; // 64 octets max

    size_t src_offset = 0;

    for (int by = 0; by < blocks_y; ++by) {
        for (int bx = 0; bx < blocks_x; ++bx) {
            if (src_offset + block_size > src_size) {
                break; // Plus de donnees
            }

            const auto* block_src = src + src_offset;
            src_offset += block_size;

            // Decoder le bloc
            switch (format) {
                case level5::G4txFormat::BC1:
                    bcdec_bc1(block_src, block_rgba, 4 * 4);
                    break;
                case level5::G4txFormat::BC2:
                    bcdec_bc2(block_src, block_rgba, 4 * 4);
                    break;
                case level5::G4txFormat::BC3:
                    bcdec_bc3(block_src, block_rgba, 4 * 4);
                    break;
                case level5::G4txFormat::BC4: {
                    // BC4 decode en R8 (1 octet/pixel, pitch=1*4=4 pour un bloc 4 pixels wide)
                    uint8_t block_r[4 * 4]; // 16 octets R8
                    bcdec_bc4(block_src, block_r, 4 * 1);
                    // Convertir R8 -> RGBA8 (R, R, R, 255)
                    for (int py = 0; py < 4; ++py) {
                        for (int px = 0; px < 4; ++px) {
                            const int idx = py * 4 + px;
                            block_rgba[idx * 4 + 0] = block_r[idx];
                            block_rgba[idx * 4 + 1] = block_r[idx];
                            block_rgba[idx * 4 + 2] = block_r[idx];
                            block_rgba[idx * 4 + 3] = 255;
                        }
                    }
                    break;
                }
                case level5::G4txFormat::BC5: {
                    // BC5 decode en RG8 (2 octets/pixel, pitch=2*4=8)
                    uint8_t block_rg[4 * 4 * 2]; // 32 octets RG8
                    bcdec_bc5(block_src, block_rg, 4 * 2);
                    // Convertir RG8 -> RGBA8 (R, G, recalcul B pour normal map, 255)
                    for (int py = 0; py < 4; ++py) {
                        for (int px = 0; px < 4; ++px) {
                            const int idx = py * 4 + px;
                            const uint8_t r = block_rg[idx * 2 + 0];
                            const uint8_t g = block_rg[idx * 2 + 1];
                            // Reconstruction du canal B pour les normal maps
                            // B = sqrt(1 - R^2 - G^2) mappe sur [0, 255]
                            const float nr = (static_cast<float>(r) / 255.0f) * 2.0f - 1.0f;
                            const float ng = (static_cast<float>(g) / 255.0f) * 2.0f - 1.0f;
                            float nb_sq = 1.0f - nr * nr - ng * ng;
                            if (nb_sq < 0.0f) nb_sq = 0.0f;
                            const float nb = std::sqrt(nb_sq);
                            const auto b = static_cast<uint8_t>(
                                std::clamp((nb * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
                            block_rgba[idx * 4 + 0] = r;
                            block_rgba[idx * 4 + 1] = g;
                            block_rgba[idx * 4 + 2] = b;
                            block_rgba[idx * 4 + 3] = 255;
                        }
                    }
                    break;
                }
                case level5::G4txFormat::BC7:
                    bcdec_bc7(block_src, block_rgba, 4 * 4);
                    break;
                default:
                    break;
            }

            // Copier le bloc 4x4 dans le buffer de sortie
            for (int py = 0; py < 4; ++py) {
                const int dst_y = by * 4 + py;
                if (dst_y >= height) break;
                for (int px = 0; px < 4; ++px) {
                    const int dst_x = bx * 4 + px;
                    if (dst_x >= width) break;
                    const size_t dst_idx = (static_cast<size_t>(dst_y) *
                                            static_cast<size_t>(width) +
                                            static_cast<size_t>(dst_x)) * 4;
                    const int src_idx = (py * 4 + px) * 4;
                    std::memcpy(&output[dst_idx], &block_rgba[src_idx], 4);
                }
            }
        }
    }

    return output;
}

// ── Export PNG ───────────────────────────────────────────────────────

bool export_png(const level5::G4txTexture& texture,
                 const std::filesystem::path& output_path) {
    if (texture.data.empty()) {
        spdlog::error("export_png: texture '{}' sans donnees", texture.name);
        return false;
    }

    if (texture.width == 0 || texture.height == 0) {
        spdlog::error("export_png: texture '{}' dimensions invalides ({}x{})",
                      texture.name, texture.width, texture.height);
        return false;
    }

    std::vector<uint8_t> rgba;

    if (texture.format == level5::G4txFormat::RGBA8) {
        // Deja en RGBA8, pas de decodage necessaire
        const size_t expected = static_cast<size_t>(texture.width) *
                                static_cast<size_t>(texture.height) * 4;
        if (texture.data.size() < expected) {
            spdlog::error("export_png: texture '{}' RGBA8 tronquee ({} < {})",
                          texture.name, texture.data.size(), expected);
            return false;
        }
        rgba.resize(expected);
        std::memcpy(rgba.data(), texture.data.data(), expected);
    } else {
        // Decodage BCn -> RGBA8
        rgba = decode_bcn_to_rgba8(
            texture.data.data(), texture.data.size(),
            texture.width, texture.height,
            texture.format);

        if (rgba.empty()) {
            spdlog::error("export_png: echec du decodage BCn pour '{}'", texture.name);
            return false;
        }
    }

    // Creer le repertoire parent si necessaire
    const auto parent = output_path.parent_path();
    if (!parent.empty()) {
        std::error_code ec;
        std::filesystem::create_directories(parent, ec);
        if (ec) {
            spdlog::error("export_png: impossible de creer le repertoire '{}'", parent.string());
            return false;
        }
    }

    // Ecrire le PNG via stb_image_write
    const int result = stbi_write_png(
        output_path.string().c_str(),
        texture.width, texture.height,
        4, // RGBA
        rgba.data(),
        texture.width * 4); // stride

    if (result == 0) {
        spdlog::error("export_png: echec de l'ecriture PNG pour '{}'", texture.name);
        return false;
    }

    spdlog::info("export_png: '{}' exporte ({}x{}, format={:#x})",
                 texture.name, texture.width, texture.height,
                 static_cast<uint32_t>(texture.format));
    return true;
}

// ── Export DDS brut ─────────────────────────────────────────────────

bool export_dds(const level5::G4txTexture& texture,
                 const std::filesystem::path& output_path) {
    if (texture.data.empty()) {
        spdlog::error("export_dds: texture '{}' sans donnees", texture.name);
        return false;
    }

    // Creer le repertoire parent si necessaire
    const auto parent = output_path.parent_path();
    if (!parent.empty()) {
        std::error_code ec;
        std::filesystem::create_directories(parent, ec);
    }

    // Ecrire les donnees brutes (pour les textures DDS on a deja les donnees BCn)
    std::ofstream file(output_path, std::ios::binary);
    if (!file) {
        spdlog::error("export_dds: impossible d'ouvrir '{}'", output_path.string());
        return false;
    }

    file.write(reinterpret_cast<const char*>(texture.data.data()),
               static_cast<std::streamsize>(texture.data.size()));

    spdlog::info("export_dds: '{}' exporte ({} octets)", texture.name, texture.data.size());
    return true;
}

// ── Export batch ────────────────────────────────────────────────────

size_t export_all_png(const level5::G4txFile& file,
                       const std::filesystem::path& output_dir,
                       const TextureExportOptions& options) {
    size_t count = 0;
    for (const auto& tex : file.textures) {
        if (options.export_dds) {
            const auto path = output_dir / (tex.name + ".dds");
            if (export_dds(tex, path)) {
                ++count;
            }
        } else {
            const auto path = output_dir / (tex.name + ".png");
            if (export_png(tex, path)) {
                ++count;
            }
        }
    }
    return count;
}

// ── decode_to_rgba8 ─────────────────────────────────────────────────

std::vector<uint8_t> decode_to_rgba8(const level5::G4txTexture& texture) {
    if (texture.data.empty() || texture.width == 0 || texture.height == 0) return {};

    if (texture.format == level5::G4txFormat::RGBA8) {
        const size_t expected = static_cast<size_t>(texture.width) *
                                static_cast<size_t>(texture.height) * 4;
        if (texture.data.size() < expected) return {};
        return {texture.data.begin(), texture.data.begin() + static_cast<ptrdiff_t>(expected)};
    }

    return decode_bcn_to_rgba8(texture.data.data(), texture.data.size(),
                                texture.width, texture.height, texture.format);
}

// ── export_webp (conditional) ───────────────────────────────────────

#ifdef IECODE_HAS_WEBP
#include <webp/encode.h>

namespace {
/// Guard RAII pour la liberation du buffer alloue par libwebp.
struct WebPBufferGuard {
    uint8_t* ptr = nullptr;
    explicit WebPBufferGuard(uint8_t* p) noexcept : ptr(p) {}
    ~WebPBufferGuard() { if (ptr) WebPFree(ptr); }
    WebPBufferGuard(const WebPBufferGuard&) = delete;
    WebPBufferGuard& operator=(const WebPBufferGuard&) = delete;
};
} // namespace

bool export_webp(const level5::G4txTexture& texture,
                  const std::filesystem::path& output_path,
                  int quality, bool lossless) {
    auto rgba = decode_to_rgba8(texture);
    if (rgba.empty()) return false;

    const auto parent = output_path.parent_path();
    if (!parent.empty()) {
        std::error_code ec;
        std::filesystem::create_directories(parent, ec);
    }

    uint8_t* output = nullptr;
    size_t output_size = 0;
    if (lossless) {
        output_size = WebPEncodeLosslessRGBA(rgba.data(), texture.width, texture.height,
                                              texture.width * 4, &output);
    } else {
        output_size = WebPEncodeRGBA(rgba.data(), texture.width, texture.height,
                                      texture.width * 4, static_cast<float>(quality), &output);
    }

    if (output_size == 0 || output == nullptr) return false;

    // Guard RAII : libere le buffer webp meme si l'ouverture du fichier echoue
    WebPBufferGuard guard(output);

    // Ecriture via FILE* (plus rapide que ofstream pour gros buffers)
    // + buffer thread-local 256 KB via setvbuf pour reduire les syscalls
#ifdef _WIN32
    FILE* f = nullptr;
    _wfopen_s(&f, output_path.wstring().c_str(), L"wb");
#else
    FILE* f = std::fopen(output_path.string().c_str(), "wb");
#endif
    if (!f) {
        spdlog::error("export_webp: impossible d'ouvrir '{}'", output_path.string());
        return false;
    }

    static thread_local char tls_webp_buf[256 * 1024];
    std::setvbuf(f, tls_webp_buf, _IOFBF, sizeof(tls_webp_buf));

    const bool write_ok = std::fwrite(output, 1, output_size, f) == output_size;
    std::fclose(f);
    return write_ok;
}
#else
bool export_webp(const level5::G4txTexture& /*texture*/,
                  const std::filesystem::path& /*output_path*/,
                  int /*quality*/, bool /*lossless*/) {
    spdlog::error("export_webp: libwebp non disponible");
    return false;
}
#endif

} // namespace iecode::converters
