#include "iecode/crypto/crc32.h"

#include <array>

// CRC32 hardware via SSE4.2 (_mm_crc32_u8/u32/u64)
#if defined(IECODE_HAS_SSE42) && IECODE_HAS_SSE42
    #ifdef _MSC_VER
        #include <intrin.h>
    #else
        #include <nmmintrin.h>
    #endif
    #define IECODE_CRC32_HW 1
#endif

namespace iecode::crypto {

namespace {

/// Table CRC32 precalculee (polynome 0xEDB88320, compatible zlib/Ethernet).
/// Utilisee en fallback si SSE4.2 non disponible.
constexpr auto make_crc32_table() noexcept {
    std::array<uint32_t, 256> table{};
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t crc = i;
        for (int j = 0; j < 8; ++j) {
            if (crc & 1) {
                crc = (crc >> 1) ^ 0xEDB88320u;
            } else {
                crc >>= 1;
            }
        }
        table[i] = crc;
    }
    return table;
}

/// Table CRC32 4-slices pour le calcul logiciel optimise.
/// Traite 4 octets a la fois (slicing-by-4) au lieu de 1.
constexpr auto make_crc32_table_4slice() noexcept {
    std::array<std::array<uint32_t, 256>, 4> table{};
    // Slice 0 = table standard
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t crc = i;
        for (int j = 0; j < 8; ++j) {
            crc = (crc & 1) ? ((crc >> 1) ^ 0xEDB88320u) : (crc >> 1);
        }
        table[0][i] = crc;
    }
    // Slices 1-3 : chaque slice[k][i] = table[0][slice[k-1][i] & 0xFF] ^ (slice[k-1][i] >> 8)
    for (int k = 1; k < 4; ++k) {
        for (uint32_t i = 0; i < 256; ++i) {
            table[k][i] = (table[k - 1][i] >> 8) ^ table[0][table[k - 1][i] & 0xFF];
        }
    }
    return table;
}

constexpr auto CRC32_TABLE = make_crc32_table();
constexpr auto CRC32_TABLE_4S = make_crc32_table_4slice();

/// Implementation logicielle slicing-by-4 (4x plus rapide que naive).
uint32_t crc32_software(uint32_t crc, std::span<const uint8_t> data) noexcept {
    crc = ~crc;
    const auto* p = data.data();
    auto len = data.size();

    // Traiter 4 octets a la fois
    while (len >= 4) {
        crc ^= static_cast<uint32_t>(p[0])
             | (static_cast<uint32_t>(p[1]) << 8)
             | (static_cast<uint32_t>(p[2]) << 16)
             | (static_cast<uint32_t>(p[3]) << 24);

        crc = CRC32_TABLE_4S[3][(crc      ) & 0xFF]
            ^ CRC32_TABLE_4S[2][(crc >>  8) & 0xFF]
            ^ CRC32_TABLE_4S[1][(crc >> 16) & 0xFF]
            ^ CRC32_TABLE_4S[0][(crc >> 24) & 0xFF];

        p += 4;
        len -= 4;
    }

    // Octets restants
    while (len-- > 0) {
        crc = CRC32_TABLE[(crc ^ *p++) & 0xFF] ^ (crc >> 8);
    }

    return ~crc;
}

#if IECODE_CRC32_HW
/// Implementation hardware SSE4.2 — utilise l'instruction CRC32C.
/// Note : SSE4.2 utilise le polynome CRC32C (Castagnoli, 0x1EDC6F41),
/// PAS le polynome CRC32 standard (0xEDB88320/Ethernet).
/// Le jeu utilise le polynome standard, donc on reste sur le logiciel
/// sauf si on confirme que c'est CRC32C.
///
/// Pour le moment on garde le slicing-by-4 logiciel qui est deja 4x
/// plus rapide que la version naive. L'instruction hardware CRC32C
/// n'est pas compatible avec le polynome 0xEDB88320 utilise par le jeu.
#endif

} // namespace

uint32_t crc32_compute(std::span<const uint8_t> data) {
    return crc32_software(0, data);
}

uint32_t crc32_compute(uint32_t seed, std::span<const uint8_t> data) {
    return crc32_software(seed, data);
}

uint32_t crc32_compute(std::string_view str) {
    return crc32_compute(std::span<const uint8_t>(
        reinterpret_cast<const uint8_t*>(str.data()), str.size()));
}

} // namespace iecode::crypto
