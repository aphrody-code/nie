#pragma once

/// @file crilayla.h
/// Decompression CRILAYLA (compression CRI Middleware).

#include <cstdint>
#include <span>
#include <vector>

namespace iecode::compression {

/// Verifie si les donnees commencent par le magic "CRILAYLA".
[[nodiscard]] bool is_crilayla(std::span<const uint8_t> data);

/// Decompresse un bloc CRILAYLA. Retourne un vecteur vide en cas d'erreur.
[[nodiscard]] std::vector<uint8_t> crilayla_decompress(std::span<const uint8_t> data);

} // namespace iecode::compression
