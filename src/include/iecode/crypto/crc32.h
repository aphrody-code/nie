#pragma once

/// @file crc32.h
/// Calcul CRC32 (polynome 0xEDB88320, compatible zlib/Ethernet).

#include <cstdint>
#include <span>
#include <string_view>

namespace iecode::crypto {

/// Calcule le CRC32 d'un buffer, avec seed initiale 0.
[[nodiscard]] uint32_t crc32_compute(std::span<const uint8_t> data);

/// Calcule le CRC32 incrementalement avec une seed donnee.
[[nodiscard]] uint32_t crc32_compute(uint32_t seed, std::span<const uint8_t> data);

/// Calcule le CRC32 d'une chaine de caracteres.
[[nodiscard]] uint32_t crc32_compute(std::string_view str);

} // namespace iecode::crypto
