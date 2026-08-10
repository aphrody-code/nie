#pragma once

/// @file hash_types.h
/// Types de hash CRC32 et references indexees du moteur Level-5.
/// Le VFS utilise CRC32 pour resoudre les chemins prefixes '#/'.
/// Fonction de hash : FUN_1402b5cb0.

#include <cstdint>
#include <compare>

namespace lives {

/// CRC32 hash 32-bit (lives::hash32).
struct hash32 {
    uint32_t value = 0;

    constexpr hash32() = default;
    constexpr explicit hash32(uint32_t v) : value(v) {}

    [[nodiscard]] constexpr bool operator==(const hash32& o) const { return value == o.value; }
    [[nodiscard]] constexpr bool operator!=(const hash32& o) const { return value != o.value; }
    [[nodiscard]] constexpr auto operator<=>(const hash32& o) const = default;
};

/// CRC32 hash 64-bit (lives::hash64).
struct hash64 {
    uint64_t value = 0;

    constexpr hash64() = default;
    constexpr explicit hash64(uint64_t v) : value(v) {}

    [[nodiscard]] constexpr bool operator==(const hash64& o) const { return value == o.value; }
    [[nodiscard]] constexpr auto operator<=>(const hash64& o) const = default;
};

/// Reference 16-bit indexee (lives::REF16).
struct REF16 {
    uint16_t index = 0xFFFF;

    [[nodiscard]] constexpr bool valid() const { return index != 0xFFFF; }
};

/// Reference 32-bit indexee (lives::REF32).
struct REF32 {
    uint32_t index = 0xFFFFFFFF;

    [[nodiscard]] constexpr bool valid() const { return index != 0xFFFFFFFF; }
};

} // namespace lives
