#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#include <stb_image.h>

#include "iecode/converters/texture_import.h"
#include "iecode/formats/level5/nxtch.h"
#include "iecode/crypto/crc32.h"
#include "iecode/types.h"

#include <DirectXTex.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstring>
#include <fstream>

namespace iecode::converters {

// ── Constantes G4TX binaires ───────────────────────────────────────

static constexpr uint32_t G4TX_MAGIC_LE     = 0x58543447;  // "G4TX" LE
static constexpr size_t   G4TX_HEADER_SIZE  = 0x60;
static constexpr size_t   G4TX_ENTRY_SIZE   = 0x30;

// ── Helpers ────────────────────────────────────────────────────────

/// Convertit G4txFormat en DXGI_FORMAT pour DirectXTex.
static DXGI_FORMAT g4tx_to_dxgi(level5::G4txFormat fmt) {
    switch (fmt) {
        case level5::G4txFormat::BC1:  return DXGI_FORMAT_BC1_UNORM;
        case level5::G4txFormat::BC2:  return DXGI_FORMAT_BC2_UNORM;
        case level5::G4txFormat::BC3:  return DXGI_FORMAT_BC3_UNORM;
        case level5::G4txFormat::BC4:  return DXGI_FORMAT_BC4_UNORM;
        case level5::G4txFormat::BC5:  return DXGI_FORMAT_BC5_UNORM;
        case level5::G4txFormat::BC7:  return DXGI_FORMAT_BC7_UNORM;
        case level5::G4txFormat::RGBA8: return DXGI_FORMAT_R8G8B8A8_UNORM;
        default: return DXGI_FORMAT_UNKNOWN;
    }
}

/// Compresse un buffer RGBA8 en BCn via DirectXTex.
/// @return donnees compressees, ou vide en cas d'erreur
static std::vector<uint8_t> compress_rgba8_to_bcn(
    const uint8_t* rgba, int width, int height,
    level5::G4txFormat target_format)
{
    if (target_format == level5::G4txFormat::RGBA8) {
        // Pas de compression, copie directe
        const size_t size = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
        return {rgba, rgba + size};
    }

    const DXGI_FORMAT dxgi_fmt = g4tx_to_dxgi(target_format);
    if (dxgi_fmt == DXGI_FORMAT_UNKNOWN) {
        spdlog::error("compress: format cible non supporte ({:#x})",
                      static_cast<uint32_t>(target_format));
        return {};
    }

    // Creer l'image source RGBA8
    DirectX::Image src_image = {};
    src_image.width = static_cast<size_t>(width);
    src_image.height = static_cast<size_t>(height);
    src_image.format = DXGI_FORMAT_R8G8B8A8_UNORM;
    src_image.rowPitch = static_cast<size_t>(width) * 4;
    src_image.slicePitch = src_image.rowPitch * static_cast<size_t>(height);
    src_image.pixels = const_cast<uint8_t*>(rgba);  // NOLINT — DirectXTex ne modifie pas src

    // Compresser
    DirectX::ScratchImage compressed;
    HRESULT hr = DirectX::Compress(
        src_image, dxgi_fmt,
        DirectX::TEX_COMPRESS_DEFAULT | DirectX::TEX_COMPRESS_PARALLEL,
        DirectX::TEX_THRESHOLD_DEFAULT,
        compressed);

    if (FAILED(hr)) {
        spdlog::error("compress: DirectXTex Compress() echoue (HRESULT={:#x})",
                      static_cast<uint32_t>(hr));
        return {};
    }

    const auto* result = compressed.GetImage(0, 0, 0);
    if (!result || !result->pixels) {
        spdlog::error("compress: resultat vide apres compression");
        return {};
    }

    return {result->pixels, result->pixels + result->slicePitch};
}

/// Construit un chunk NXTCH (header + donnees texture).
static std::vector<uint8_t> build_nxtch_chunk(
    const std::vector<uint8_t>& tex_data,
    int width, int height,
    level5::G4txFormat format, uint8_t mip_count)
{
    std::vector<uint8_t> chunk(level5::NXTCH_HEADER_SIZE + tex_data.size(), 0);
    auto* p = chunk.data();

    // Magic "NXTCH000" (8 octets)
    std::memcpy(p, "NXTCH000", 8);

    // Header NXTCH (9 x i32 apres le magic u64)
    write_u32_le(p + 0x08, static_cast<uint32_t>(tex_data.size()));  // texture_data_size
    write_u32_le(p + 0x0C, 0);                                       // unk1
    write_u32_le(p + 0x10, 0);                                       // unk2
    write_u32_le(p + 0x14, static_cast<uint32_t>(width));             // width
    write_u32_le(p + 0x18, static_cast<uint32_t>(height));            // height
    write_u32_le(p + 0x1C, 0);                                       // unk3
    write_u32_le(p + 0x20, 0);                                       // unk4
    write_u32_le(p + 0x24, static_cast<uint32_t>(format));            // format
    write_u32_le(p + 0x28, static_cast<uint32_t>(mip_count));         // mip_count

    // Donnees texture
    std::memcpy(p + level5::NXTCH_HEADER_SIZE, tex_data.data(), tex_data.size());

    return chunk;
}

// ── import_rgba8 ───────────────────────────────────────────────────

std::optional<level5::G4txTexture> import_rgba8(
    const uint8_t* rgba_data, int width, int height,
    const TextureImportOptions& options)
{
    if (!rgba_data || width <= 0 || height <= 0) {
        spdlog::error("import_rgba8: parametres invalides ({}x{})", width, height);
        return std::nullopt;
    }

    // Compresser RGBA8 -> BCn (ou copier si RGBA8)
    auto compressed = compress_rgba8_to_bcn(rgba_data, width, height, options.format);
    if (compressed.empty()) {
        spdlog::error("import_rgba8: echec de la compression");
        return std::nullopt;
    }

    level5::G4txTexture tex;
    tex.id = options.id;
    tex.name = options.name;
    tex.width = static_cast<uint16_t>(width);
    tex.height = static_cast<uint16_t>(height);
    tex.format = options.format;
    tex.mip_count = 1;
    tex.is_dds = false;
    tex.data = std::move(compressed);

    spdlog::info("import_rgba8: texture '{}' {}x{} format={:#x} ({} octets)",
                 tex.name, tex.width, tex.height,
                 static_cast<uint32_t>(tex.format), tex.data.size());

    return tex;
}

// ── import_png ─────────────────────────────────────────────────────

std::optional<level5::G4txTexture> import_png(
    const std::filesystem::path& png_path,
    const TextureImportOptions& options)
{
    if (!std::filesystem::exists(png_path)) {
        spdlog::error("import_png: fichier introuvable '{}'", png_path.string());
        return std::nullopt;
    }

    // Lire le PNG via stb_image
    int width = 0, height = 0, channels = 0;
    auto* rgba = stbi_load(png_path.string().c_str(), &width, &height, &channels, 4);
    if (!rgba) {
        spdlog::error("import_png: echec du chargement PNG '{}' — {}",
                      png_path.string(), stbi_failure_reason());
        return std::nullopt;
    }

    // Utiliser le stem du fichier comme nom si non specifie
    auto opts = options;
    if (opts.name.empty()) {
        opts.name = png_path.stem().string();
    }

    auto result = import_rgba8(reinterpret_cast<const uint8_t*>(rgba), width, height, opts);
    stbi_image_free(rgba);

    return result;
}

// ── g4tx_serialize ─────────────────────────────────────────────────

std::vector<uint8_t> g4tx_serialize(const level5::G4txFile& file) {
    if (file.textures.empty()) {
        spdlog::error("g4tx_serialize: aucune texture a serialiser");
        return {};
    }

    const auto texture_count = static_cast<int16_t>(file.textures.size());

    // Compter les sous-textures
    uint8_t sub_texture_count = 0;
    for (const auto& tex : file.textures) {
        sub_texture_count += static_cast<uint8_t>(tex.sub_textures.size());
    }

    // total_count = texture_count + sub_texture_count
    const auto total_count = static_cast<int16_t>(texture_count + sub_texture_count);

    // ── Construire les chunks NXTCH ────────────────────────────────
    std::vector<std::vector<uint8_t>> nxtch_chunks;
    nxtch_chunks.reserve(static_cast<size_t>(texture_count));

    for (const auto& tex : file.textures) {
        nxtch_chunks.push_back(
            build_nxtch_chunk(tex.data, tex.width, tex.height, tex.format, tex.mip_count));
    }

    // ── Calculer les tailles des sections de la table ──────────────
    const size_t entries_size = static_cast<size_t>(texture_count) * G4TX_ENTRY_SIZE;
    const size_t sub_entries_size = static_cast<size_t>(sub_texture_count) * 0x18;
    const size_t sub_entries_end = entries_size + sub_entries_size;

    // Hash table (total_count * 4, alignee sur 0x10)
    const size_t hash_table_offset = (sub_entries_end + 0x0F) & ~static_cast<size_t>(0x0F);
    const size_t hash_table_size = static_cast<size_t>(total_count) * 4;

    // IDs (total_count octets)
    const size_t ids_offset = hash_table_offset + hash_table_size;

    // String offsets (total_count * 2, aligne sur 4)
    const size_t string_offsets_start = (ids_offset + static_cast<size_t>(total_count) + 3)
                                        & ~static_cast<size_t>(3);
    const size_t string_offsets_size = static_cast<size_t>(total_count) * 2;

    // String pool
    const size_t string_pool_start = string_offsets_start + string_offsets_size;

    // Construire le pool de chaines et les offsets
    std::vector<std::string> all_names;
    all_names.reserve(static_cast<size_t>(total_count));
    for (const auto& tex : file.textures) {
        all_names.push_back(tex.name);
    }
    // Ajouter les noms des sous-textures (on reutilise le nom parent + suffixe)
    for (const auto& tex : file.textures) {
        for (size_t si = 0; si < tex.sub_textures.size(); ++si) {
            all_names.push_back(tex.name + "_sub" + std::to_string(si));
        }
    }

    // Calculer les offsets relatifs dans le string pool
    std::vector<uint16_t> string_offsets(static_cast<size_t>(total_count), 0);
    std::vector<uint8_t> string_pool;
    for (size_t i = 0; i < all_names.size(); ++i) {
        string_offsets[i] = static_cast<uint16_t>(string_pool.size());
        string_pool.insert(string_pool.end(), all_names[i].begin(), all_names[i].end());
        string_pool.push_back(0);  // null terminator
    }

    // table_size = tout ce qui est entre le header et la base NXTCH
    const size_t table_size = string_pool_start + string_pool.size();

    // nxtch_base aligne sur 0x10
    const size_t nxtch_base_rel = (table_size + 0x0F) & ~static_cast<size_t>(0x0F);

    // Calculer les offsets NXTCH relatifs et la taille totale des chunks
    std::vector<int32_t> nxtch_offsets(static_cast<size_t>(texture_count), 0);
    size_t nxtch_cursor = 0;
    for (int16_t i = 0; i < texture_count; ++i) {
        nxtch_offsets[static_cast<size_t>(i)] = static_cast<int32_t>(nxtch_cursor);
        nxtch_cursor += nxtch_chunks[static_cast<size_t>(i)].size();
        // Aligner chaque chunk sur 0x10
        nxtch_cursor = (nxtch_cursor + 0x0F) & ~static_cast<size_t>(0x0F);
    }
    const size_t total_nxtch_size = nxtch_cursor;

    // Taille totale du fichier
    const size_t file_size = G4TX_HEADER_SIZE + nxtch_base_rel + total_nxtch_size;

    // ── Ecrire le buffer de sortie ─────────────────────────────────
    std::vector<uint8_t> output(file_size, 0);
    auto* buf = output.data();

    // ── Header G4TX (0x60) ─────────────────────────────────────────
    write_u32_le(buf + 0x00, G4TX_MAGIC_LE);
    write_u16_le(buf + 0x04, static_cast<uint16_t>(G4TX_HEADER_SIZE));  // header_size
    write_u16_le(buf + 0x06, static_cast<uint16_t>(file.version));      // file_type
    write_u32_le(buf + 0x08, 0);                                        // unk
    write_u32_le(buf + 0x0C, static_cast<uint32_t>(table_size));        // table_size
    // 0x10-0x1F: zeros (unknown fields)
    write_u16_le(buf + 0x20, static_cast<uint16_t>(texture_count));     // texture_count
    write_u16_le(buf + 0x22, static_cast<uint16_t>(total_count));       // total_count
    buf[0x24] = static_cast<uint8_t>(texture_count);                    // entry_count_u8
    buf[0x25] = sub_texture_count;                                      // sub_texture_count
    // 0x26-0x2B: zeros
    write_u32_le(buf + 0x2C, static_cast<uint32_t>(total_nxtch_size));  // texture_data_size

    // ── Table d'entrees (a partir de header_size) ──────────────────
    auto* table = buf + G4TX_HEADER_SIZE;

    for (int16_t i = 0; i < texture_count; ++i) {
        const auto& tex = file.textures[static_cast<size_t>(i)];
        auto* entry = table + static_cast<size_t>(i) * G4TX_ENTRY_SIZE;

        write_u32_le(entry + 0x00, 0);  // unk1
        write_u32_le(entry + 0x04, static_cast<uint32_t>(
            nxtch_offsets[static_cast<size_t>(i)]));                    // nxtch_offset
        write_u32_le(entry + 0x08, static_cast<uint32_t>(
            nxtch_chunks[static_cast<size_t>(i)].size()));              // nxtch_size
        write_u32_le(entry + 0x0C, 0);  // unk2
        write_u32_le(entry + 0x10, 0);  // unk3
        write_u32_le(entry + 0x14, 0);  // unk4
        write_u16_le(entry + 0x18, tex.width);                          // width
        write_u16_le(entry + 0x1A, tex.height);                         // height
        write_u32_le(entry + 0x1C, 0x02);                               // const2
        // 0x20-0x2F: zeros (remaining entry padding)
    }

    // ── Sous-entrees ───────────────────────────────────────────────
    auto* sub_table = table + entries_size;
    size_t sub_idx = 0;
    for (int16_t ei = 0; ei < texture_count; ++ei) {
        const auto& tex = file.textures[static_cast<size_t>(ei)];
        for (const auto& sub : tex.sub_textures) {
            auto* se = sub_table + sub_idx * 0x18;
            write_u16_le(se + 0x00, static_cast<uint16_t>(sub.entry_id));
            write_u16_le(se + 0x02, static_cast<uint16_t>(sub.unk1));
            write_u16_le(se + 0x04, static_cast<uint16_t>(sub.x));
            write_u16_le(se + 0x06, static_cast<uint16_t>(sub.y));
            write_u16_le(se + 0x08, static_cast<uint16_t>(sub.width));
            write_u16_le(se + 0x0A, static_cast<uint16_t>(sub.height));
            write_u32_le(se + 0x0C, static_cast<uint32_t>(sub.unk2));
            write_u32_le(se + 0x10, static_cast<uint32_t>(sub.unk3));
            write_u32_le(se + 0x14, static_cast<uint32_t>(sub.unk4));
            ++sub_idx;
        }
    }

    // ── Hash table (CRC32 des noms) ────────────────────────────────
    auto* hash_ptr = table + hash_table_offset;
    for (size_t i = 0; i < all_names.size(); ++i) {
        const uint32_t hash = crypto::crc32_compute(all_names[i]);
        write_u32_le(hash_ptr + i * 4, hash);
    }

    // ── IDs ────────────────────────────────────────────────────────
    auto* ids_ptr = table + ids_offset;
    for (int16_t i = 0; i < texture_count; ++i) {
        ids_ptr[static_cast<size_t>(i)] = file.textures[static_cast<size_t>(i)].id;
    }
    // Sub-texture IDs: utiliser l'index parent
    size_t id_idx = static_cast<size_t>(texture_count);
    for (int16_t ei = 0; ei < texture_count; ++ei) {
        for (size_t si = 0; si < file.textures[static_cast<size_t>(ei)].sub_textures.size(); ++si) {
            if (id_idx < static_cast<size_t>(total_count)) {
                ids_ptr[id_idx++] = static_cast<uint8_t>(ei);
            }
        }
    }

    // ── String offsets ─────────────────────────────────────────────
    auto* str_off_ptr = table + string_offsets_start;
    for (size_t i = 0; i < string_offsets.size(); ++i) {
        write_u16_le(str_off_ptr + i * 2, string_offsets[i]);
    }

    // ── String pool ────────────────────────────────────────────────
    auto* str_pool_ptr = table + string_pool_start;
    std::memcpy(str_pool_ptr, string_pool.data(), string_pool.size());

    // ── Chunks NXTCH ───────────────────────────────────────────────
    auto* nxtch_base_ptr = buf + G4TX_HEADER_SIZE + nxtch_base_rel;
    for (int16_t i = 0; i < texture_count; ++i) {
        const auto& chunk = nxtch_chunks[static_cast<size_t>(i)];
        auto* dst = nxtch_base_ptr + nxtch_offsets[static_cast<size_t>(i)];
        std::memcpy(dst, chunk.data(), chunk.size());
    }

    spdlog::info("g4tx_serialize: {} texture(s), {} octets",
                 texture_count, output.size());
    return output;
}

// ── import_png_to_g4tx ─────────────────────────────────────────────

bool import_png_to_g4tx(
    const std::filesystem::path& png_path,
    const std::filesystem::path& output_path,
    const TextureImportOptions& options)
{
    auto tex = import_png(png_path, options);
    if (!tex) return false;

    level5::G4txFile file;
    file.version = 0x0001;  // Version standard observee
    file.textures.push_back(std::move(*tex));

    auto data = g4tx_serialize(file);
    if (data.empty()) return false;

    // Creer le repertoire parent si necessaire
    const auto parent = output_path.parent_path();
    if (!parent.empty()) {
        std::error_code ec;
        std::filesystem::create_directories(parent, ec);
    }

    std::ofstream out(output_path, std::ios::binary);
    if (!out) {
        spdlog::error("import_png_to_g4tx: impossible d'ouvrir '{}'", output_path.string());
        return false;
    }
    out.write(reinterpret_cast<const char*>(data.data()),
              static_cast<std::streamsize>(data.size()));

    spdlog::info("import_png_to_g4tx: '{}' -> '{}' ({} octets)",
                 png_path.string(), output_path.string(), data.size());
    return out.good();
}

} // namespace iecode::converters
