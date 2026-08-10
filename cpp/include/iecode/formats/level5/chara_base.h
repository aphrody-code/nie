#pragma once

/// @file chara_base.h
/// Parser binaire pour chara_base_*.cfg.bin (format T2B Level-5).
///
/// Disposition memoire :
///   [Entry racine]  CRC32=0xB688E1A5 | 1 param : count (uint32)
///   [14 x col desc] CRC32=0x530F114B | 0 params (descripteurs de colonnes)
///   [Section dense] count * (uint32 id + 11 bytes data)

#include <array>
#include <cstdint>
#include <cstring>
#include <optional>
#include <span>
#include <vector>

namespace iecode::level5 {

// ── Constantes T2B chara_base ─────────────────────────────────────────

static constexpr uint32_t CHARA_BASE_ROOT_CRC   = 0xB688E1A5u;
static constexpr uint32_t CHARA_BASE_COL_CRC    = 0x530F114Bu;
static constexpr uint32_t CHARA_BASE_COL_COUNT  = 14u;
static constexpr uint32_t CHARA_BASE_DATA_BYTES = 11u;

// ── Structures ────────────────────────────────────────────────────────

/// Entree dense d'un personnage de base.
struct CharaBaseEntry {
    uint32_t id   = 0;
    std::array<uint8_t, CHARA_BASE_DATA_BYTES> data{};
};

/// Resultat du parse de chara_base_*.cfg.bin.
struct CharaBase {
    uint32_t count = 0;
    std::vector<CharaBaseEntry> entries;

    // ── API ───────────────────────────────────────────────────────────

    /// Parse un buffer binaire T2B chara_base.
    /// Retourne std::nullopt si le buffer est invalide ou trop court.
    [[nodiscard]] static std::optional<CharaBase> parse(std::span<const uint8_t> data) noexcept;

    /// Surcharge pour std::vector<uint8_t>.
    [[nodiscard]] static std::optional<CharaBase> parse(const std::vector<uint8_t>& data) noexcept {
        return parse(std::span<const uint8_t>{data.data(), data.size()});
    }
};

// ── Impl inline ───────────────────────────────────────────────────────

namespace detail {

/// Lit un uint32_t little-endian depuis un span, avance l'offset.
/// Retourne false si pas assez de donnees.
[[nodiscard]] inline bool read_u32_le(std::span<const uint8_t> buf, size_t& off, uint32_t& out) noexcept {
    if (off + 4u > buf.size()) return false;
    out = static_cast<uint32_t>(buf[off])
        | (static_cast<uint32_t>(buf[off + 1u]) << 8u)
        | (static_cast<uint32_t>(buf[off + 2u]) << 16u)
        | (static_cast<uint32_t>(buf[off + 3u]) << 24u);
    off += 4u;
    return true;
}

/// Avance l'offset de n bytes.
[[nodiscard]] inline bool skip(std::span<const uint8_t> buf, size_t& off, size_t n) noexcept {
    if (off + n > buf.size()) return false;
    off += n;
    return true;
}

/// Calcule la taille du header d'une entree T2B (sans le CRC32).
/// header_bytes = ceil(param_count / 4) + 1, aligne a 4.
[[nodiscard]] inline size_t t2b_header_bytes(uint8_t param_count) noexcept {
    size_t h = 1u + ((static_cast<size_t>(param_count) + 3u) / 4u);
    while ((h % 4u) != 0u) ++h;
    return h;
}

} // namespace detail

inline std::optional<CharaBase> CharaBase::parse(std::span<const uint8_t> data) noexcept {
    if (data.empty()) return std::nullopt;

    size_t off = 0u;

    // -- Entry racine : CRC32 + header + 1 param (count) -----------------
    uint32_t root_crc = 0u;
    if (!detail::read_u32_le(data, off, root_crc)) return std::nullopt;
    if (root_crc != CHARA_BASE_ROOT_CRC) return std::nullopt;

    // param_count de la racine = 1
    if (off >= data.size()) return std::nullopt;
    const uint8_t root_param_count = data[off];
    if (root_param_count == 0u) return std::nullopt;

    // Sauter le reste du header racine (param_count byte deja lu inclus)
    const size_t root_header = detail::t2b_header_bytes(root_param_count);
    if (!detail::skip(data, off, root_header)) return std::nullopt;

    // Lire le count (1er param uint32)
    uint32_t count = 0u;
    if (!detail::read_u32_le(data, off, count)) return std::nullopt;

    // -- 14 descripteurs de colonnes : CRC32 + header (0 params) ---------
    for (uint32_t col = 0u; col < CHARA_BASE_COL_COUNT; ++col) {
        uint32_t col_crc = 0u;
        if (!detail::read_u32_le(data, off, col_crc)) return std::nullopt;
        // CRC est attendu mais on ne rejette pas une valeur differente
        // (compatibilite avec variantes futures).

        if (off >= data.size()) return std::nullopt;
        const uint8_t col_param_count = data[off];
        const size_t col_header = detail::t2b_header_bytes(col_param_count);
        if (!detail::skip(data, off, col_header)) return std::nullopt;
        // Pas de params a sauter (col_param_count attendu = 0)
    }

    // -- Section dense : count * (4 bytes id + 11 bytes data) ------------
    CharaBase result;
    result.count = count;
    result.entries.reserve(count);

    for (uint32_t i = 0u; i < count; ++i) {
        CharaBaseEntry entry;
        if (!detail::read_u32_le(data, off, entry.id)) return std::nullopt;
        if (off + CHARA_BASE_DATA_BYTES > data.size()) return std::nullopt;
        std::memcpy(entry.data.data(), data.data() + off, CHARA_BASE_DATA_BYTES);
        off += CHARA_BASE_DATA_BYTES;
        result.entries.push_back(entry);
    }

    return result;
}

} // namespace iecode::level5
