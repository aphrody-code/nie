#pragma once

/// @file zlib_decompress.h
/// Decompression ZLib/deflate (methode Level-5 #5).

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::compression {

/// Decompresse des donnees ZLib/deflate (methode Level-5 #5).
/// Le header Level-5 (4 ou 8 octets) doit etre present.
/// Les donnees compressees (apres le header) sont un flux zlib standard.
[[nodiscard]] std::optional<std::vector<uint8_t>>
zlib_decompress(std::span<const uint8_t> data);

} // namespace iecode::compression
