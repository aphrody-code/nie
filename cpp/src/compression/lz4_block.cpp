#include "iecode/compression/lz4_block.h"

#include <algorithm>
#include <cstring>

// Prefixe lz4_ dans le namespace anonyme pour eviter les collisions en unity build
namespace {

/// Magic number du format LZ4 frame (RFC 7230 / LZ4 framing format)
constexpr uint32_t lz4_frame_magic = 0x184D2204;

/// Longueur minimale d'un match LZ4 (spec: minmatch = 4)
constexpr uint32_t lz4_min_match = 4;

/// Lit la longueur etendue LZ4 : tant que l'octet vaut 255, accumuler
/// Retourne false si on deborde du buffer source
[[nodiscard]] inline bool lz4_read_extended_length(
    const uint8_t*& src, const uint8_t* src_end, uint32_t& length) {
    uint8_t byte = 0;
    do {
        if (src >= src_end) return false;
        byte = *src++;
        length += byte;
    } while (byte == 255);
    return true;
}

/// Decompresse un bloc LZ4 brut (sans frame header).
/// Format : sequences de (token, [longueur etendue literals], literals,
///           offset 2 octets LE, [longueur etendue match])
/// La derniere sequence peut n'avoir que des literals (pas d'offset/match).
[[nodiscard]] bool lz4_decompress_block(
    const uint8_t* src, size_t src_size,
    uint8_t* dst, size_t dst_capacity,
    size_t& bytes_written) {

    const uint8_t* const src_end = src + src_size;
    uint8_t* const dst_start = dst;
    uint8_t* const dst_end = dst + dst_capacity;

    while (src < src_end && dst < dst_end) {
        // Lire le token : 4 bits haut = longueur literals, 4 bits bas = longueur match
        const uint8_t token = *src++;
        uint32_t literal_length = token >> 4;
        uint32_t match_length = token & 0x0F;

        // Longueur etendue des literals
        if (literal_length == 15) {
            if (!lz4_read_extended_length(src, src_end, literal_length))
                return false;
        }

        // Copier les octets literals
        if (literal_length > 0) {
            if (src + literal_length > src_end) return false;
            if (dst + literal_length > dst_end) return false;
            std::memcpy(dst, src, literal_length);
            src += literal_length;
            dst += literal_length;
        }

        // Si on a consomme toute la source, c'est la derniere sequence
        // (pas de match apres les derniers literals)
        if (src >= src_end) break;

        // Lire l'offset de match : 2 octets little-endian
        if (src + 2 > src_end) return false;
        const uint16_t offset =
            static_cast<uint16_t>(src[0]) |
            (static_cast<uint16_t>(src[1]) << 8);
        src += 2;

        // Offset 0 est invalide dans LZ4
        if (offset == 0) return false;

        // Le match pointe en arriere dans le buffer de sortie
        const uint8_t* match_src = dst - offset;
        if (match_src < dst_start) return false;

        // Longueur etendue du match + longueur minimale (4)
        match_length += lz4_min_match;
        if (match_length == 15 + lz4_min_match) {
            if (!lz4_read_extended_length(src, src_end, match_length))
                return false;
        }

        if (dst + match_length > dst_end) return false;

        // Copie du match — attention aux overlaps (offset < match_length)
        // On ne peut pas utiliser memcpy si les zones se chevauchent
        if (offset >= match_length) {
            std::memcpy(dst, match_src, match_length);
            dst += match_length;
        } else {
            // Copie octet par octet pour les overlaps (pattern repetitif)
            for (uint32_t i = 0; i < match_length; ++i) {
                dst[i] = match_src[i % offset];
            }
            dst += match_length;
        }
    }

    bytes_written = static_cast<size_t>(dst - dst_start);
    return true;
}

/// Decompresse un frame LZ4 (magic 0x184D2204).
/// Structure simplifiee : magic(4) + FLG(1) + BD(1) + [content_size(8)] + checksum(1)
/// puis blocs avec taille sur 4 octets chacun, terminateur bloc de taille 0.
[[nodiscard]] bool lz4_decompress_frame(
    const uint8_t* src, size_t src_size,
    uint8_t* dst, size_t dst_capacity,
    size_t& bytes_written) {

    if (src_size < 7) return false; // magic(4) + FLG(1) + BD(1) + HC(1) minimum

    size_t pos = 4; // Sauter le magic

    const uint8_t flg = src[pos++];
    // const uint8_t bd = src[pos++]; // Block MaxSize descriptor — on le lit mais c'est informatif
    pos++; // BD

    // FLG bits :
    // bit 3 : Content Size present
    // bit 2 : Content Checksum present
    // bit 1 : Block Checksum present (chaque bloc a un checksum de 4 octets apres)
    const bool has_content_size = (flg >> 3) & 1;
    const bool has_block_checksum = (flg >> 4) & 1;
    // bit 0 : DictID present
    const bool has_dict_id = flg & 1;

    if (has_content_size) {
        if (pos + 8 > src_size) return false;
        pos += 8; // On saute la taille (on utilise dst_capacity)
    }

    if (has_dict_id) {
        if (pos + 4 > src_size) return false;
        pos += 4;
    }

    // Header checksum (1 octet)
    if (pos >= src_size) return false;
    pos++; // HC

    // Decompresser les blocs
    size_t total_written = 0;

    while (pos + 4 <= src_size) {
        // Taille du bloc : 4 octets LE. Bit 31 = 1 si non compresse.
        const uint32_t block_size_raw =
            static_cast<uint32_t>(src[pos]) |
            (static_cast<uint32_t>(src[pos + 1]) << 8) |
            (static_cast<uint32_t>(src[pos + 2]) << 16) |
            (static_cast<uint32_t>(src[pos + 3]) << 24);
        pos += 4;

        // Bloc de taille 0 = terminateur (EndMark)
        if (block_size_raw == 0) break;

        const bool is_uncompressed = (block_size_raw >> 31) & 1;
        const uint32_t block_data_size = block_size_raw & 0x7FFFFFFF;

        if (pos + block_data_size > src_size) return false;

        if (is_uncompressed) {
            if (total_written + block_data_size > dst_capacity) return false;
            std::memcpy(dst + total_written, src + pos, block_data_size);
            total_written += block_data_size;
        } else {
            size_t block_written = 0;
            if (!lz4_decompress_block(
                    src + pos, block_data_size,
                    dst + total_written, dst_capacity - total_written,
                    block_written))
                return false;
            total_written += block_written;
        }

        pos += block_data_size;

        // Sauter le block checksum si present
        if (has_block_checksum) {
            if (pos + 4 > src_size) return false;
            pos += 4;
        }
    }

    bytes_written = total_written;
    return true;
}

} // namespace anonyme

namespace iecode::compression {

bool is_lz4_block(std::span<const uint8_t> data) {
    // LZ4 block n'a pas de magic specifique.
    // On verifie qu'il y a au moins un token byte et que les donnees
    // ne commencent pas par un magic connu d'un autre format.
    if (data.size() < 1) return false;

    // Detecter le format LZ4 frame par son magic
    if (data.size() >= 4) {
        const uint32_t magic =
            static_cast<uint32_t>(data[0]) |
            (static_cast<uint32_t>(data[1]) << 8) |
            (static_cast<uint32_t>(data[2]) << 16) |
            (static_cast<uint32_t>(data[3]) << 24);
        if (magic == lz4_frame_magic) return true;
    }

    // Heuristique basique pour bloc brut : au moins quelques octets
    return data.size() >= 4;
}

std::vector<uint8_t> lz4_decompress(std::span<const uint8_t> data,
                                     uint32_t decompressed_size) {
    if (data.empty() || decompressed_size == 0) return {};

    // Allouer le buffer de sortie
    std::vector<uint8_t> output(decompressed_size);

    // Detecter le format : frame (magic 0x184D2204) ou bloc brut
    bool is_frame = false;
    if (data.size() >= 4) {
        const uint32_t magic =
            static_cast<uint32_t>(data[0]) |
            (static_cast<uint32_t>(data[1]) << 8) |
            (static_cast<uint32_t>(data[2]) << 16) |
            (static_cast<uint32_t>(data[3]) << 24);
        is_frame = (magic == lz4_frame_magic);
    }

    size_t bytes_written = 0;
    bool ok = false;

    if (is_frame) {
        ok = lz4_decompress_frame(
            data.data(), data.size(),
            output.data(), decompressed_size,
            bytes_written);
    } else {
        ok = lz4_decompress_block(
            data.data(), data.size(),
            output.data(), decompressed_size,
            bytes_written);
    }

    if (!ok) return {};

    // Tronquer si on a ecrit moins que prevu (pas une erreur fatale)
    output.resize(bytes_written);
    return output;
}

} // namespace iecode::compression
