#pragma once

/// @file types.h
/// Types fondamentaux et helpers endian pour le parsing binaire.

#include <array>
#include <bit>
#include <cstdint>
#include <cstring>
#include <span>
#include <string_view>

namespace iecode {

// ── Aliases pratiques ───────────────────────────────────────────────
using ByteSpan = std::span<const uint8_t>;
using MutableByteSpan = std::span<uint8_t>;

// ── Constantes du jeu ───────────────────────────────────────────────
inline constexpr uint32_t CRI_XOR_KEY = 0x1717E18E;
inline constexpr uint32_t STEAM_APP_ID = 2799860;
inline constexpr uint64_t NIE_BASE_ADDRESS = 0x140000000;
inline constexpr std::string_view NIE_EXE_NAME = "nie.exe";
inline constexpr std::string_view NIE_INTERNAL_NAME = "nie1v2.exe";
inline constexpr std::string_view APP_VERSION = "5.00.24.00";

// ── Helpers de lecture little-endian ─────────────────────────────────

[[nodiscard]] inline constexpr uint16_t read_u16_le(const uint8_t* p) noexcept {
    return static_cast<uint16_t>(p[0]) |
           (static_cast<uint16_t>(p[1]) << 8);
}

[[nodiscard]] inline constexpr uint32_t read_u32_le(const uint8_t* p) noexcept {
    return static_cast<uint32_t>(p[0]) |
           (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) |
           (static_cast<uint32_t>(p[3]) << 24);
}

[[nodiscard]] inline constexpr uint64_t read_u64_le(const uint8_t* p) noexcept {
    return static_cast<uint64_t>(read_u32_le(p)) |
           (static_cast<uint64_t>(read_u32_le(p + 4)) << 32);
}

[[nodiscard]] inline constexpr int16_t read_i16_le(const uint8_t* p) noexcept {
    return static_cast<int16_t>(read_u16_le(p));
}

[[nodiscard]] inline constexpr int32_t read_i32_le(const uint8_t* p) noexcept {
    return static_cast<int32_t>(read_u32_le(p));
}

// ── Helpers de lecture big-endian ────────────────────────────────────

[[nodiscard]] inline constexpr uint16_t read_u16_be(const uint8_t* p) noexcept {
    return (static_cast<uint16_t>(p[0]) << 8) |
            static_cast<uint16_t>(p[1]);
}

[[nodiscard]] inline constexpr uint32_t read_u32_be(const uint8_t* p) noexcept {
    return (static_cast<uint32_t>(p[0]) << 24) |
           (static_cast<uint32_t>(p[1]) << 16) |
           (static_cast<uint32_t>(p[2]) << 8) |
            static_cast<uint32_t>(p[3]);
}

[[nodiscard]] inline constexpr uint64_t read_u64_be(const uint8_t* p) noexcept {
    return (static_cast<uint64_t>(read_u32_be(p)) << 32) |
            static_cast<uint64_t>(read_u32_be(p + 4));
}

[[nodiscard]] inline constexpr int16_t read_i16_be(const uint8_t* p) noexcept {
    return static_cast<int16_t>(read_u16_be(p));
}

[[nodiscard]] inline constexpr int32_t read_i32_be(const uint8_t* p) noexcept {
    return static_cast<int32_t>(read_u32_be(p));
}

// ── Helpers d'ecriture little-endian ────────────────────────────────

inline constexpr void write_u16_le(uint8_t* p, uint16_t v) noexcept {
    p[0] = static_cast<uint8_t>(v);
    p[1] = static_cast<uint8_t>(v >> 8);
}

inline constexpr void write_u32_le(uint8_t* p, uint32_t v) noexcept {
    p[0] = static_cast<uint8_t>(v);
    p[1] = static_cast<uint8_t>(v >> 8);
    p[2] = static_cast<uint8_t>(v >> 16);
    p[3] = static_cast<uint8_t>(v >> 24);
}

inline constexpr void write_u64_le(uint8_t* p, uint64_t v) noexcept {
    write_u32_le(p, static_cast<uint32_t>(v));
    write_u32_le(p + 4, static_cast<uint32_t>(v >> 32));
}

// ── Helpers d'ecriture big-endian ───────────────────────────────────

inline constexpr void write_u16_be(uint8_t* p, uint16_t v) noexcept {
    p[0] = static_cast<uint8_t>(v >> 8);
    p[1] = static_cast<uint8_t>(v);
}

inline constexpr void write_u32_be(uint8_t* p, uint32_t v) noexcept {
    p[0] = static_cast<uint8_t>(v >> 24);
    p[1] = static_cast<uint8_t>(v >> 16);
    p[2] = static_cast<uint8_t>(v >> 8);
    p[3] = static_cast<uint8_t>(v);
}

inline constexpr void write_u64_be(uint8_t* p, uint64_t v) noexcept {
    write_u32_be(p, static_cast<uint32_t>(v >> 32));
    write_u32_be(p + 4, static_cast<uint32_t>(v));
}

// ── Lecture avec span (safe) ────────────────────────────────────────

[[nodiscard]] inline constexpr uint16_t read_u16_le(ByteSpan data, size_t offset) noexcept {
    if (offset + 2 > data.size()) return 0;
    return read_u16_le(data.data() + offset);
}

[[nodiscard]] inline constexpr uint32_t read_u32_le(ByteSpan data, size_t offset) noexcept {
    if (offset + 4 > data.size()) return 0;
    return read_u32_le(data.data() + offset);
}

[[nodiscard]] inline constexpr uint16_t read_u16_be(ByteSpan data, size_t offset) noexcept {
    if (offset + 2 > data.size()) return 0;
    return read_u16_be(data.data() + offset);
}

[[nodiscard]] inline constexpr uint32_t read_u32_be(ByteSpan data, size_t offset) noexcept {
    if (offset + 4 > data.size()) return 0;
    return read_u32_be(data.data() + offset);
}

// ── Helpers de lecture float ────────────────────────────────────────

[[nodiscard]] inline float read_f32_le(const uint8_t* p) noexcept {
    uint32_t bits = read_u32_le(p);
    float result;
    std::memcpy(&result, &bits, sizeof(float));
    return result;
}

[[nodiscard]] inline float read_f32_le(ByteSpan data, size_t offset) noexcept {
    if (offset + 4 > data.size()) return 0.0f;
    return read_f32_le(data.data() + offset);
}

[[nodiscard]] inline float read_f32_be(const uint8_t* p) noexcept {
    uint32_t bits = read_u32_be(p);
    float result;
    std::memcpy(&result, &bits, sizeof(float));
    return result;
}

[[nodiscard]] inline float read_f32_be(ByteSpan data, size_t offset) noexcept {
    if (offset + 4 > data.size()) return 0.0f;
    return read_f32_be(data.data() + offset);
}

// ── Magics connus ───────────────────────────────────────────────────
inline constexpr uint32_t MAGIC_G4TX = 0x47345458;      // "G4TX" big-endian
inline constexpr uint32_t MAGIC_G4MG = 0x47344D47;      // "G4MG"
inline constexpr uint32_t MAGIC_G4MD = 0x47344D44;      // "G4MD"
inline constexpr uint32_t MAGIC_G4SK = 0x47345340;      // "G4SK@" (premier u32)
inline constexpr uint32_t MAGIC_G4MT = 0x544D3447;      // "G4MT" little-endian read
inline constexpr uint32_t MAGIC_G4PK = 0x47345040;      // "G4PK@"
inline constexpr uint32_t MAGIC_CPK  = 0x43504B20;      // "CPK " big-endian
inline constexpr uint32_t MAGIC_UTF  = 0x40555446;      // "@UTF"
inline constexpr uint32_t MAGIC_G4CM = 0x47344D43;      // "G4CM" big-endian
inline constexpr uint32_t MAGIC_RDBN = 0x5244424E;      // "RDBN"
inline constexpr uint32_t MAGIC_AFS2 = 0x32534641;      // "AFS2" little-endian
inline constexpr uint32_t MAGIC_G4NV = 0x564E3447;      // "G4NV" little-endian
inline constexpr uint32_t MAGIC_COL0 = 0x004C4F43;      // "COL\0" little-endian
inline constexpr uint32_t MAGIC_COLS = 0x534C4F43;      // "COLS" little-endian

} // namespace iecode
