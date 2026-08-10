#include "iecode/crypto/cfgbin_decrypt.h"

#include <array>
#include <cstring>

namespace iecode::crypto {

namespace {

/// Table CRC32 standard (polynome 0xEDB88320), equivalente a DAT_141771e00
/// dans nie.exe. Genere en constexpr pour coller exactement a la LUT du jeu.
constexpr std::array<uint32_t, 256> make_cfgbin_crc32_table() noexcept {
    std::array<uint32_t, 256> table{};
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t crc = i;
        for (int j = 0; j < 8; ++j) {
            crc = (crc & 1u) ? ((crc >> 1) ^ 0xEDB88320u) : (crc >> 1);
        }
        table[i] = crc;
    }
    return table;
}

constexpr auto CFGBIN_CRC_LUT = make_cfgbin_crc32_table();

/// Calcule l'etat 32-bit du stream cipher pour un bloc aligne sur 4.
/// Correspond au calcul de `uVar2` dans FUN_14048e560 quand (offset & 3) == 0.
[[nodiscard]] constexpr uint32_t compute_block_state(uint32_t aligned_offset,
                                                     uint32_t key) noexcept {
    // Seed = ~aligned_offset, puis 4 passes de LUT XOR cle byte-par-byte.
    uint32_t state = ~aligned_offset;
    state = (state >> 8) ^ CFGBIN_CRC_LUT[(state & 0xFFu) ^ (key & 0xFFu)];
    state = (state >> 8) ^ CFGBIN_CRC_LUT[(state & 0xFFu) ^ ((key >> 8) & 0xFFu)];
    state = (state >> 8) ^ CFGBIN_CRC_LUT[(state & 0xFFu) ^ ((key >> 16) & 0xFFu)];
    state = ~((state >> 8) ^ CFGBIN_CRC_LUT[(state & 0xFFu) ^ ((key >> 24) & 0xFFu)]);
    return state;
}

/// Derive l'octet de keystream pour un index dans un bloc a partir de l'etat.
/// Correspond a la permutation 2-bit appliquee dans FUN_14048e560.
[[nodiscard]] constexpr uint8_t keystream_byte(uint32_t state, uint32_t index_in_block) noexcept {
    const uint32_t s = (index_in_block & 3u) * 2u;
    const uint8_t b0 = static_cast<uint8_t>((state >> (s + 8u)) & 3u);
    const uint8_t b1 = static_cast<uint8_t>((state >> s) & 3u);
    const uint8_t b2 = static_cast<uint8_t>((state >> (s + 16u)) & 3u);
    const uint8_t b3 = static_cast<uint8_t>((state >> (s + 24u)) & 3u);
    return static_cast<uint8_t>(((((b1 << 2) | b0) << 2) | b2) << 2 | b3);
}

} // namespace

void cfgbin_decrypt(std::span<uint8_t> buf, uint32_t start_offset, uint32_t key) noexcept {
    if (buf.empty()) {
        return;
    }

    uint32_t state = 0;
    for (size_t i = 0; i < buf.size(); ++i) {
        const uint32_t offset = start_offset + static_cast<uint32_t>(i);
        if ((offset & 3u) == 0u) {
            state = compute_block_state(offset, key);
        }
        buf[i] ^= keystream_byte(state, offset);
    }
}

bool cfgbin_is_encrypted(std::span<const uint8_t> buf) noexcept {
    if (buf.size() < 8) {
        return false;
    }
    // T2B non chiffre : footer 4 bytes "01 74 32 62" ou magic RDBNP.
    // On considere chiffre tout buffer qui n'affiche AUCUN de ces marqueurs.
    if (std::memcmp(buf.data(), "RDBN", 4) == 0) {
        return false;
    }
    if (buf.size() >= 4) {
        const uint8_t* tail = buf.data() + buf.size() - 4;
        if (tail[0] == 0x01 && tail[1] == 0x74 && tail[2] == 0x32 && tail[3] == 0x62) {
            return false;
        }
    }
    return true;
}

} // namespace iecode::crypto
