#pragma once

/// @file binary_reader.h
/// Lecteur binaire sequentiel zero-copy sur std::span.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>

namespace iecode::io {

/// Lecteur binaire sequentiel wrappant un span constant.
/// Toutes les lectures avancent automatiquement la position.
/// Retourne 0 / vide si la lecture depasse la fin du buffer.
class BinaryReader {
public:
    explicit BinaryReader(std::span<const uint8_t> data) noexcept;

    // ── Lecture little-endian ────────────────────────────────────
    [[nodiscard]] uint8_t  read_u8() noexcept;
    [[nodiscard]] uint16_t read_u16_le() noexcept;
    [[nodiscard]] uint32_t read_u32_le() noexcept;
    [[nodiscard]] uint64_t read_u64_le() noexcept;
    [[nodiscard]] int16_t  read_i16_le() noexcept;
    [[nodiscard]] int32_t  read_i32_le() noexcept;
    [[nodiscard]] float    read_f32_le() noexcept;

    // ── Lecture big-endian ───────────────────────────────────────
    [[nodiscard]] uint16_t read_u16_be() noexcept;
    [[nodiscard]] uint32_t read_u32_be() noexcept;
    [[nodiscard]] uint64_t read_u64_be() noexcept;
    [[nodiscard]] int16_t  read_i16_be() noexcept;
    [[nodiscard]] int32_t  read_i32_be() noexcept;
    [[nodiscard]] float    read_f32_be() noexcept;

    // ── Lecture de donnees brutes ────────────────────────────────
    [[nodiscard]] std::span<const uint8_t> read_bytes(size_t count) noexcept;
    [[nodiscard]] std::string read_string(size_t length);
    [[nodiscard]] std::string read_null_terminated_string();

    // ── Navigation ──────────────────────────────────────────────
    void seek(size_t position) noexcept;
    void skip(size_t count) noexcept;
    void align(size_t alignment) noexcept;

    // ── Etat ────────────────────────────────────────────────────
    [[nodiscard]] size_t position() const noexcept { return position_; }
    [[nodiscard]] size_t size() const noexcept { return data_.size(); }
    [[nodiscard]] size_t remaining() const noexcept;
    [[nodiscard]] bool eof() const noexcept;
    [[nodiscard]] std::span<const uint8_t> data() const noexcept { return data_; }

    /// Retourne un sous-span a partir de la position courante.
    [[nodiscard]] std::span<const uint8_t> remaining_span() const noexcept;

private:
    std::span<const uint8_t> data_;
    size_t position_ = 0;
};

} // namespace iecode::io
