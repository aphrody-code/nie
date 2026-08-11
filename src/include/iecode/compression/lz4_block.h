#pragma once

/// @file lz4_block.h
/// Decompression LZ4 block (sans frame header).

#include <cstdint>
#include <span>
#include <vector>

namespace iecode::compression {

/// Verifie si les donnees ressemblent a un bloc LZ4.
[[nodiscard]] bool is_lz4_block(std::span<const uint8_t> data);

/// Decompresse un bloc LZ4. decompressed_size doit etre connu a l'avance.
/// Retourne un vecteur vide en cas d'erreur.
[[nodiscard]] std::vector<uint8_t> lz4_decompress(std::span<const uint8_t> data,
                                                   uint32_t decompressed_size);

} // namespace iecode::compression
