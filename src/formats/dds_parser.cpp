#include "iecode/formats/dds_parser.h"

#include "iecode/types.h"
#include <bcdec.h>
#include <fmt/format.h>
#include <spdlog/spdlog.h>
#include <cstring>

namespace iecode::formats {

// ── Validation ─────────────────────────────────────────────────────

bool dds_is_valid(std::span<const uint8_t> data) {
    if (data.size() < 4) return false;
    return read_u32_le(data.data()) == DDS_MAGIC;
}

// ── Parsing du header ──────────────────────────────────────────────

std::optional<DdsHeader> dds_parse_header(std::span<const uint8_t> data) {
    if (data.size() < DDS_HEADER_TOTAL_SIZE) {
        spdlog::error("dds_parse_header: donnees trop courtes ({} octets, minimum {})",
                      data.size(), DDS_HEADER_TOTAL_SIZE);
        return std::nullopt;
    }

    const auto* p = data.data();
    const uint32_t magic = read_u32_le(p);
    if (magic != DDS_MAGIC) {
        spdlog::error("dds_parse_header: magic invalide ({:#010x}, attendu {:#010x})",
                      magic, DDS_MAGIC);
        return std::nullopt;
    }

    DdsHeader hdr;
    hdr.magic = magic;

    // Struct DDS_HEADER (124 octets a partir de l'offset 4)
    hdr.size                 = read_u32_le(p + 0x04);
    hdr.flags                = read_u32_le(p + 0x08);
    hdr.height               = read_u32_le(p + 0x0C);
    hdr.width                = read_u32_le(p + 0x10);
    hdr.pitch_or_linear_size = read_u32_le(p + 0x14);
    hdr.depth                = read_u32_le(p + 0x18);
    hdr.mipmap_count         = read_u32_le(p + 0x1C);
    // reserved[11] a partir de 0x20 — skip 44 octets

    // Pixel format a l'offset 0x4C (76 = 4 + 4*4 + 4*4 + 44)
    // Offset absolu dans le fichier : magic(4) + header offset
    // dwSize(4) + dwFlags(4) + dwHeight(4) + dwWidth(4) + dwPitchOrLinearSize(4)
    // + dwDepth(4) + dwMipMapCount(4) + dwReserved1[11](44) = 76
    // Pixel format commence a l'offset absolu 4 + 76 = 80 = 0x50
    constexpr size_t PF_OFFSET = 0x4C + 4; // +4 pour le magic
    hdr.pf_size          = read_u32_le(p + PF_OFFSET);
    hdr.pf_flags         = read_u32_le(p + PF_OFFSET + 0x04);
    hdr.pf_fourcc        = read_u32_le(p + PF_OFFSET + 0x08);
    hdr.pf_rgb_bit_count = read_u32_le(p + PF_OFFSET + 0x0C);
    hdr.pf_r_mask        = read_u32_le(p + PF_OFFSET + 0x10);
    hdr.pf_g_mask        = read_u32_le(p + PF_OFFSET + 0x14);
    hdr.pf_b_mask        = read_u32_le(p + PF_OFFSET + 0x18);
    hdr.pf_a_mask        = read_u32_le(p + PF_OFFSET + 0x1C);

    // Caps a l'offset absolu 0x50 + 0x20 = 0x70
    constexpr size_t CAPS_OFFSET = PF_OFFSET + DDS_PIXELFORMAT_SIZE;
    hdr.caps1 = read_u32_le(p + CAPS_OFFSET);
    hdr.caps2 = read_u32_le(p + CAPS_OFFSET + 0x04);

    // Validation basique
    if (hdr.size != DDS_HEADER_STRUCT_SIZE) {
        spdlog::warn("dds_parse_header: taille header inattendue ({}, attendu {})",
                     hdr.size, DDS_HEADER_STRUCT_SIZE);
    }

    if (hdr.width == 0 || hdr.height == 0) {
        spdlog::error("dds_parse_header: dimensions invalides ({}x{})",
                      hdr.width, hdr.height);
        return std::nullopt;
    }

    // Verifier que les donnees sont suffisantes si extension DX10
    if (hdr.has_dx10_extension() && data.size() < 148) {
        spdlog::error("dds_parse_header: extension DX10 mais donnees trop courtes ({} < 148)",
                      data.size());
        return std::nullopt;
    }

    spdlog::debug("dds_parse_header: {}x{} mips={} fourcc={:#010x} flags={:#x}",
                  hdr.width, hdr.height, hdr.mipmap_count,
                  hdr.pf_fourcc, hdr.pf_flags);

    return hdr;
}

// ── Acces aux donnees pixel ────────────────────────────────────────

std::span<const uint8_t> dds_pixel_data(std::span<const uint8_t> data) {
    auto hdr = dds_parse_header(data);
    if (!hdr) return {};

    const size_t offset = hdr->data_offset();
    if (offset >= data.size()) return {};

    return data.subspan(offset);
}

// ── Decompression BC1 (DXT1) ───────────────────────────────────────

std::vector<uint8_t> dds_decompress_bc1(
    std::span<const uint8_t> block_data, uint32_t width, uint32_t height)
{
    if (width == 0 || height == 0) {
        spdlog::error("dds_decompress_bc1: dimensions invalides ({}x{})", width, height);
        return {};
    }

    const uint32_t blocks_x = (width + 3) / 4;
    const uint32_t blocks_y = (height + 3) / 4;
    const size_t expected_size = static_cast<size_t>(blocks_x) *
                                 static_cast<size_t>(blocks_y) * BCDEC_BC1_BLOCK_SIZE;

    if (block_data.size() < expected_size) {
        spdlog::error("dds_decompress_bc1: donnees trop courtes ({} octets, attendu {})",
                      block_data.size(), expected_size);
        return {};
    }

    const size_t pixel_count = static_cast<size_t>(width) * static_cast<size_t>(height);
    std::vector<uint8_t> output(pixel_count * 4, 0);

    // Buffer temporaire pour un bloc 4x4 RGBA8
    uint8_t block_rgba[4 * 4 * 4];

    size_t src_offset = 0;
    for (uint32_t by = 0; by < blocks_y; ++by) {
        for (uint32_t bx = 0; bx < blocks_x; ++bx) {
            bcdec_bc1(block_data.data() + src_offset, block_rgba, 4 * 4);
            src_offset += BCDEC_BC1_BLOCK_SIZE;

            // Copier le bloc 4x4 dans le buffer de sortie
            for (uint32_t py = 0; py < 4; ++py) {
                const uint32_t dst_y = by * 4 + py;
                if (dst_y >= height) break;
                for (uint32_t px = 0; px < 4; ++px) {
                    const uint32_t dst_x = bx * 4 + px;
                    if (dst_x >= width) break;
                    const size_t dst_idx = (static_cast<size_t>(dst_y) *
                                            static_cast<size_t>(width) +
                                            static_cast<size_t>(dst_x)) * 4;
                    const size_t src_idx = static_cast<size_t>(py * 4 + px) * 4;
                    std::memcpy(&output[dst_idx], &block_rgba[src_idx], 4);
                }
            }
        }
    }

    return output;
}

// ── Decompression BC3 (DXT5) ───────────────────────────────────────

std::vector<uint8_t> dds_decompress_bc3(
    std::span<const uint8_t> block_data, uint32_t width, uint32_t height)
{
    if (width == 0 || height == 0) {
        spdlog::error("dds_decompress_bc3: dimensions invalides ({}x{})", width, height);
        return {};
    }

    const uint32_t blocks_x = (width + 3) / 4;
    const uint32_t blocks_y = (height + 3) / 4;
    const size_t expected_size = static_cast<size_t>(blocks_x) *
                                 static_cast<size_t>(blocks_y) * BCDEC_BC3_BLOCK_SIZE;

    if (block_data.size() < expected_size) {
        spdlog::error("dds_decompress_bc3: donnees trop courtes ({} octets, attendu {})",
                      block_data.size(), expected_size);
        return {};
    }

    const size_t pixel_count = static_cast<size_t>(width) * static_cast<size_t>(height);
    std::vector<uint8_t> output(pixel_count * 4, 0);

    // Buffer temporaire pour un bloc 4x4 RGBA8
    uint8_t block_rgba[4 * 4 * 4];

    size_t src_offset = 0;
    for (uint32_t by = 0; by < blocks_y; ++by) {
        for (uint32_t bx = 0; bx < blocks_x; ++bx) {
            bcdec_bc3(block_data.data() + src_offset, block_rgba, 4 * 4);
            src_offset += BCDEC_BC3_BLOCK_SIZE;

            // Copier le bloc 4x4 dans le buffer de sortie
            for (uint32_t py = 0; py < 4; ++py) {
                const uint32_t dst_y = by * 4 + py;
                if (dst_y >= height) break;
                for (uint32_t px = 0; px < 4; ++px) {
                    const uint32_t dst_x = bx * 4 + px;
                    if (dst_x >= width) break;
                    const size_t dst_idx = (static_cast<size_t>(dst_y) *
                                            static_cast<size_t>(width) +
                                            static_cast<size_t>(dst_x)) * 4;
                    const size_t src_idx = static_cast<size_t>(py * 4 + px) * 4;
                    std::memcpy(&output[dst_idx], &block_rgba[src_idx], 4);
                }
            }
        }
    }

    return output;
}

// ── FourCC vers string ─────────────────────────────────────────────

std::string dds_fourcc_to_string(uint32_t fourcc) {
    // Verifier si les 4 octets sont des caracteres ASCII imprimables
    char chars[4];
    std::memcpy(chars, &fourcc, 4);

    bool all_printable = true;
    for (char c : chars) {
        if (c < 0x20 || c > 0x7E) {
            all_printable = false;
            break;
        }
    }

    if (all_printable) {
        return std::string(chars, 4);
    }

    // Fallback en hexadecimal
    return fmt::format("{:#010x}", fourcc);
}

} // namespace iecode::formats
