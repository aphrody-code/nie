#pragma once

/// @file inazuma_lzss.h
/// Decompression InazumaLZSS (variante LZSS specifique aux jeux Inazuma Eleven).
/// Magic "SSZL" (0x53 0x53 0x5A 0x4C).

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::compression {

/// Detecte si les donnees utilisent la compression InazumaLZSS (magic "SSZL").
[[nodiscard]] bool is_inazuma_lzss(std::span<const uint8_t> data);

/// Decompresse des donnees InazumaLZSS.
/// Format : magic "SSZL" (4 bytes) + decompressed_size (4 bytes LE) + donnees compressees.
/// Retourne std::nullopt si le format est invalide ou la decompression echoue.
[[nodiscard]] std::optional<std::vector<uint8_t>> inazuma_lzss_decompress(
    std::span<const uint8_t> data);

} // namespace iecode::compression
