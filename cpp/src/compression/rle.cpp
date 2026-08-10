#include "iecode/compression/rle.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstddef>
#include <cstring>

namespace iecode::compression {

std::optional<std::vector<uint8_t>>
rle_decompress(std::span<const uint8_t> data) {
    // Header Level-5 : 4 octets minimum
    constexpr size_t RLE_HEADER_SIZE = 4;

    if (data.size() < RLE_HEADER_SIZE) {
        spdlog::error("rle: donnees trop courtes pour le header ({} < {})",
                      data.size(), RLE_HEADER_SIZE);
        return std::nullopt;
    }

    // Lire la taille decompressee (octets 1-3, 24-bit LE)
    uint32_t decompressed_size = static_cast<uint32_t>(data[1]) |
                                  (static_cast<uint32_t>(data[2]) << 8) |
                                  (static_cast<uint32_t>(data[3]) << 16);

    size_t header_bytes = 4;

    // Si la taille 24-bit vaut 0, lire la taille etendue sur 32 bits
    if (decompressed_size == 0) {
        if (data.size() < 8) {
            spdlog::error("rle: donnees trop courtes pour le header etendu ({} < 8)",
                          data.size());
            return std::nullopt;
        }
        decompressed_size = static_cast<uint32_t>(data[4]) |
                             (static_cast<uint32_t>(data[5]) << 8) |
                             (static_cast<uint32_t>(data[6]) << 16) |
                             (static_cast<uint32_t>(data[7]) << 24);
        header_bytes = 8;
    }

    if (decompressed_size == 0) {
        return std::vector<uint8_t>{};
    }

    // Limite de securite : 256 Mo max pour eviter les allocations excessives
    constexpr uint32_t MAX_DECOMPRESSED = 256u * 1024u * 1024u;
    if (decompressed_size > MAX_DECOMPRESSED) {
        spdlog::error("rle: taille decompressee suspecte ({} > {})",
                      decompressed_size, MAX_DECOMPRESSED);
        return std::nullopt;
    }

    std::vector<uint8_t> output;
    output.reserve(decompressed_size);

    size_t src_pos = header_bytes;

    while (output.size() < decompressed_size) {
        if (src_pos >= data.size()) {
            spdlog::error("rle: donnees compressees tronquees a l'offset {}", src_pos);
            return std::nullopt;
        }

        const uint8_t flag = data[src_pos++];

        if (flag & 0x80) [[likely]] {
            // Run compresse : repeter l'octet suivant (flag & 0x7F) + 3 fois
            if (src_pos >= data.size()) [[unlikely]] {
                spdlog::error("rle: octet de run manquant a l'offset {}", src_pos);
                return std::nullopt;
            }

            const uint8_t value = data[src_pos++];
            const size_t count  = static_cast<size_t>(flag & 0x7F) + 3;
            // Limiter a la taille decompressee restante
            const size_t actual = std::min(count, decompressed_size - output.size());

            const size_t old_size = output.size();
            output.resize(old_size + actual);
            std::memset(output.data() + old_size, value, actual);
        } else {
            // Run non-compresse : copier les (flag + 1) octets suivants
            const size_t count = static_cast<size_t>(flag) + 1;

            if (src_pos + count > data.size()) [[unlikely]] {
                spdlog::error("rle: donnees non-compressees tronquees ({} + {} > {})",
                              src_pos, count, data.size());
                return std::nullopt;
            }

            // Limiter a la taille decompressee restante
            const size_t actual = std::min(count, decompressed_size - output.size());

            const size_t old_size = output.size();
            output.resize(old_size + actual);
            std::memcpy(output.data() + old_size, &data[src_pos], actual);
            src_pos += actual;
        }
    }

    return output;
}

} // namespace iecode::compression
