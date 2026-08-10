#include "iecode/compression/inazuma_lzss.h"

#include <algorithm>
#include <cstring>
#include <spdlog/spdlog.h>

namespace iecode::compression {

namespace {

/// Magic "SSZL" : octets 0x53 0x53 0x5A 0x4C.
constexpr uint8_t SSZL_MAGIC[4] = {0x53, 0x53, 0x5A, 0x4C};

/// Taille minimale d'un bloc InazumaLZSS : 4 (magic) + 4 (decompressed_size) = 8 octets.
constexpr size_t SSZL_HEADER_SIZE = 8;

/// Limite raisonnable pour la taille decompressée (256 Mo).
constexpr size_t SSZL_MAX_DECOMPRESSED_SIZE = 256 * 1024 * 1024;

/// Lecture little-endian d'un uint32.
[[nodiscard]] inline uint32_t sszl_read_u32_le(const uint8_t* p) noexcept {
    return static_cast<uint32_t>(p[0]) |
           (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) |
           (static_cast<uint32_t>(p[3]) << 24);
}

} // namespace

bool is_inazuma_lzss(std::span<const uint8_t> data) {
    if (data.size() < 4) return false;
    return std::memcmp(data.data(), SSZL_MAGIC, 4) == 0;
}

std::optional<std::vector<uint8_t>> inazuma_lzss_decompress(std::span<const uint8_t> data) {
    if (!is_inazuma_lzss(data)) {
        spdlog::error("inazuma_lzss: magic SSZL absent");
        return std::nullopt;
    }

    if (data.size() < SSZL_HEADER_SIZE) {
        spdlog::error("inazuma_lzss: donnees trop courtes ({} octets, minimum {})",
                      data.size(), SSZL_HEADER_SIZE);
        return std::nullopt;
    }

    // Taille decompressée en little-endian a l'offset 4
    const uint32_t decompressed_size = sszl_read_u32_le(data.data() + 4);

    if (decompressed_size == 0) {
        spdlog::warn("inazuma_lzss: taille decompressée nulle");
        return std::vector<uint8_t>{};
    }

    if (decompressed_size > SSZL_MAX_DECOMPRESSED_SIZE) {
        spdlog::error("inazuma_lzss: taille decompressée trop grande ({} octets, max {})",
                      decompressed_size, SSZL_MAX_DECOMPRESSED_SIZE);
        return std::nullopt;
    }

    spdlog::debug("inazuma_lzss: decompressed_size={}, compressed_size={}",
                  decompressed_size, data.size() - SSZL_HEADER_SIZE);

    std::vector<uint8_t> output;
    output.reserve(decompressed_size);

    size_t src_pos = SSZL_HEADER_SIZE; // Donnees compressees apres le header

    while (output.size() < decompressed_size) {
        // Lire un octet de flags
        if (src_pos >= data.size()) {
            spdlog::error("inazuma_lzss: fin prematuree des donnees compressees "
                          "(position src={}, sortie={}/{})",
                          src_pos, output.size(), decompressed_size);
            return std::nullopt;
        }

        const uint8_t flags = data[src_pos++];

        // Traiter 8 bits de flags, MSB en premier
        for (int bit = 7; bit >= 0 && output.size() < decompressed_size; --bit) {
            if (flags & (1 << bit)) {
                // Bit a 1 : octet litteral, copier directement
                if (src_pos >= data.size()) {
                    spdlog::error("inazuma_lzss: fin prematuree lors de la lecture d'un litteral");
                    return std::nullopt;
                }
                output.push_back(data[src_pos++]);
            } else {
                // Bit a 0 : reference arriere (2 octets)
                if (src_pos + 1 >= data.size()) {
                    spdlog::error("inazuma_lzss: fin prematuree lors de la lecture d'une reference");
                    return std::nullopt;
                }

                const uint8_t byte1 = data[src_pos++];
                const uint8_t byte2 = data[src_pos++];

                // Offset 12 bits : ((byte2 & 0xF0) << 4) | byte1
                const size_t offset =
                    (static_cast<size_t>(byte2 & 0xF0) << 4) | static_cast<size_t>(byte1);
                // Longueur 4 bits : (byte2 & 0x0F) + 3
                const size_t length = static_cast<size_t>(byte2 & 0x0F) + 3;

                // Position source dans la sortie
                // L'offset represente la distance depuis la position courante - 1
                if (offset == 0) {
                    spdlog::error("inazuma_lzss: offset de reference nul");
                    return std::nullopt;
                }

                const size_t current_pos = output.size();
                if (offset > current_pos) {
                    spdlog::error("inazuma_lzss: reference hors limites "
                                  "(offset={}, position courante={})",
                                  offset, current_pos);
                    return std::nullopt;
                }

                const size_t src_start = current_pos - offset;
                const size_t actual = std::min(length, decompressed_size - output.size());

                if (offset >= actual) [[likely]] {
                    // Pas de chevauchement : copie memcpy en bloc
                    const size_t old_size = output.size();
                    output.resize(old_size + actual);
                    std::memcpy(output.data() + old_size,
                                output.data() + src_start, actual);
                } else {
                    // Chevauchement (run-length) : copie octet par octet
                    for (size_t i = 0; i < actual; ++i) {
                        output.push_back(output[src_start + i]);
                    }
                }
            }
        }
    }

    if (output.size() != decompressed_size) {
        spdlog::warn("inazuma_lzss: taille finale ({}) != taille attendue ({})",
                     output.size(), decompressed_size);
    }

    spdlog::debug("inazuma_lzss: decompression reussie ({} octets)", output.size());
    return output;
}

} // namespace iecode::compression
