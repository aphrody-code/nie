#pragma once

/// @file level5_compress.h
/// Dispatcher de compression/decompression Level-5.
/// Header commun : octet 0 = methode, octets 1-3 = taille decompressee (24-bit LE).
/// Si la taille 24-bit vaut 0, les octets 4-7 contiennent la taille 32-bit complete.

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::compression {

/// Methode de compression Level-5.
enum class Level5Method : uint8_t {
    NONE     = 0,
    LZ10     = 1,
    HUFFMAN4 = 2,
    HUFFMAN8 = 3,
    RLE      = 4,
    ZLIB     = 5,
};

/// Detecte la methode de compression Level-5 depuis le premier octet du header.
/// Retourne Level5Method::NONE si les donnees sont trop courtes ou si la methode
/// est inconnue.
[[nodiscard]] Level5Method detect_level5_method(std::span<const uint8_t> data);

/// Lit la taille decompressée depuis le header Level-5.
/// Octets 1-3 en little-endian 24-bit ; si la valeur vaut 0, lit les octets 4-7
/// comme un uint32_t little-endian.
/// Retourne 0 si les donnees sont trop courtes.
[[nodiscard]] uint32_t level5_decompressed_size(std::span<const uint8_t> data);

/// Decompresse des donnees Level-5 avec dispatch automatique par methode.
/// Retourne std::nullopt en cas d'erreur (methode inconnue, donnees corrompues).
[[nodiscard]] std::optional<std::vector<uint8_t>>
level5_decompress(std::span<const uint8_t> data);

} // namespace iecode::compression
