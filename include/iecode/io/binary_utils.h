#pragma once

/// @file binary_utils.h
/// Utilitaires d'analyse binaire : entropie, hex dump, recherche de pattern.

#include <cstdint>
#include <optional>
#include <span>
#include <string>

namespace iecode::io {

/// Calcule l'entropie de Shannon (0.0 = uniforme, 8.0 = aleatoire).
[[nodiscard]] double entropy(std::span<const uint8_t> data);

/// Genere un hex dump lisible (style xxd), tronque a max_bytes.
[[nodiscard]] std::string hex_dump(std::span<const uint8_t> data, size_t max_bytes = 256);

/// Recherche un pattern dans un buffer. Retourne l'offset de la premiere occurrence.
[[nodiscard]] std::optional<size_t> find_pattern(std::span<const uint8_t> haystack,
                                                  std::span<const uint8_t> needle);

} // namespace iecode::io
