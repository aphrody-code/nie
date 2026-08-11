#pragma once

/// @file huffman.h
/// Decompression Huffman 4-bit et 8-bit (format Nintendo/Level-5).

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::compression {

/// Decompresse des donnees Huffman 4-bit (methode Level-5 #2).
/// Le header Level-5 (4 ou 8 octets) doit etre present.
[[nodiscard]] std::optional<std::vector<uint8_t>>
huffman4_decompress(std::span<const uint8_t> data);

/// Decompresse des donnees Huffman 8-bit (methode Level-5 #3).
/// Le header Level-5 (4 ou 8 octets) doit etre present.
[[nodiscard]] std::optional<std::vector<uint8_t>>
huffman8_decompress(std::span<const uint8_t> data);

} // namespace iecode::compression
