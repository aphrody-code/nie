#pragma once

/// @file lz10.h
/// Decompression LZ10 (variante Level-5).

#include <cstdint>
#include <span>
#include <vector>

namespace iecode::compression {

/// Verifie si les donnees commencent par un header LZ10 valide.
[[nodiscard]] bool is_lz10(std::span<const uint8_t> data);

/// Decompresse un bloc LZ10. Retourne un vecteur vide en cas d'erreur.
[[nodiscard]] std::vector<uint8_t> lz10_decompress(std::span<const uint8_t> data);

} // namespace iecode::compression
