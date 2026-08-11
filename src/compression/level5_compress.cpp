#include "iecode/compression/level5_compress.h"

#include "iecode/compression/huffman.h"
#include "iecode/compression/lz10.h"
#include "iecode/compression/rle.h"
#include "iecode/compression/zlib_decompress.h"

#include <spdlog/spdlog.h>

namespace iecode::compression {

Level5Method detect_level5_method(std::span<const uint8_t> data) {
    if (data.empty()) return Level5Method::NONE;

    const uint8_t method = data[0];
    switch (method) {
        case 1: return Level5Method::LZ10;
        case 2: return Level5Method::HUFFMAN4;
        case 3: return Level5Method::HUFFMAN8;
        case 4: return Level5Method::RLE;
        case 5: return Level5Method::ZLIB;
        default:
            spdlog::debug("level5: methode de compression inconnue ({:#04x})",
                          method);
            return Level5Method::NONE;
    }
}

uint32_t level5_decompressed_size(std::span<const uint8_t> data) {
    if (data.size() < 4) return 0;

    // Octets 1-3 : taille 24-bit LE
    uint32_t size = static_cast<uint32_t>(data[1]) |
                    (static_cast<uint32_t>(data[2]) << 8) |
                    (static_cast<uint32_t>(data[3]) << 16);

    if (size != 0) return size;

    // Taille etendue : octets 4-7, 32-bit LE
    if (data.size() < 8) return 0;

    return static_cast<uint32_t>(data[4]) |
           (static_cast<uint32_t>(data[5]) << 8) |
           (static_cast<uint32_t>(data[6]) << 16) |
           (static_cast<uint32_t>(data[7]) << 24);
}

std::optional<std::vector<uint8_t>>
level5_decompress(std::span<const uint8_t> data) {
    const auto method = detect_level5_method(data);

    switch (method) {
        case Level5Method::LZ10: {
            // Le LZ10 existant attend le header Nintendo (0x10 + taille 24-bit).
            // On reconstruit un header compatible : remplacer l'octet de methode
            // Level-5 (0x01) par le magic Nintendo (0x10).
            std::vector<uint8_t> patched(data.begin(), data.end());
            patched[0] = 0x10;
            auto result = lz10_decompress(patched);
            if (result.empty()) {
                spdlog::error("level5: echec de decompression LZ10");
                return std::nullopt;
            }
            return result;
        }

        case Level5Method::HUFFMAN4:
            return huffman4_decompress(data);

        case Level5Method::HUFFMAN8:
            return huffman8_decompress(data);

        case Level5Method::RLE:
            return rle_decompress(data);

        case Level5Method::ZLIB:
            return zlib_decompress(data);

        case Level5Method::NONE:
        default:
            spdlog::error("level5: methode de compression non supportee ({:#04x})",
                          data.empty() ? 0 : data[0]);
            return std::nullopt;
    }
}

} // namespace iecode::compression
