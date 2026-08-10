#pragma once

/// @file rle.h
/// Decompression RLE (Run-Length Encoding, format Nintendo/Level-5).

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::compression {

/// Decompresse des donnees RLE (methode Level-5 #4).
/// Le header Level-5 (4 ou 8 octets) doit etre present.
[[nodiscard]] std::optional<std::vector<uint8_t>>
rle_decompress(std::span<const uint8_t> data);

} // namespace iecode::compression
