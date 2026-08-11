#include "iecode/compression/zlib_decompress.h"

#include <spdlog/spdlog.h>
#include <zlib.h>

#include <cstddef>

namespace iecode::compression {

std::optional<std::vector<uint8_t>>
zlib_decompress(std::span<const uint8_t> data) {
    // Header Level-5 : 4 octets minimum
    constexpr size_t ZLIB_HEADER_SIZE = 4;

    if (data.size() < ZLIB_HEADER_SIZE) {
        spdlog::error("zlib: donnees trop courtes pour le header ({} < {})",
                      data.size(), ZLIB_HEADER_SIZE);
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
            spdlog::error("zlib: donnees trop courtes pour le header etendu ({} < 8)",
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

    // Limite de securite : 256 Mo max
    constexpr uint32_t MAX_DECOMPRESSED = 256u * 1024u * 1024u;
    if (decompressed_size > MAX_DECOMPRESSED) {
        spdlog::error("zlib: taille decompressee suspecte ({} > {})",
                      decompressed_size, MAX_DECOMPRESSED);
        return std::nullopt;
    }

    // Donnees compressees apres le header Level-5
    auto compressed = data.subspan(header_bytes);
    if (compressed.empty()) {
        spdlog::error("zlib: pas de donnees compressees apres le header");
        return std::nullopt;
    }

    // Decompression via zlib uncompress()
    std::vector<uint8_t> output(decompressed_size);
    uLongf dest_len = static_cast<uLongf>(decompressed_size);

    const int ret = ::uncompress(
        output.data(),
        &dest_len,
        compressed.data(),
        static_cast<uLong>(compressed.size()));

    if (ret != Z_OK) {
        const char* msg = "inconnu";
        switch (ret) {
            case Z_MEM_ERROR:    msg = "memoire insuffisante"; break;
            case Z_BUF_ERROR:    msg = "buffer de sortie trop petit"; break;
            case Z_DATA_ERROR:   msg = "donnees compressees corrompues"; break;
            default: break;
        }
        spdlog::error("zlib: echec de decompression (code={}, {})", ret, msg);
        return std::nullopt;
    }

    // Ajuster la taille si zlib a decompresse moins que prevu
    output.resize(static_cast<size_t>(dest_len));

    return output;
}

} // namespace iecode::compression
