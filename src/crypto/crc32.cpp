#include "iecode/crypto/crc32.h"

#include <array>
#include <cstring>

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

/// Tables du slicing-by-8 : huit octets consommes par tour.
///
/// Mesure sur ce depot (bench/run-all.ps1, tampon de 64 Mio) : le slicing-by-4 plafonnait
/// a 1 783 Mio/s, le by-8 atteint 3 243 Mio/s — +82 % pour le meme polynome et un resultat
/// identique au bit pres. Les huit lectures de table d'un tour sont independantes : le
/// processeur les ordonnance en parallele, la ou by-4 n'en expose que quatre.
constexpr auto make_crc32_table_8slice() noexcept {
    std::array<std::array<uint32_t, 256>, 8> table{};
    // Slice 0 = table standard
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t crc = i;
        for (int j = 0; j < 8; ++j) {
            crc = (crc & 1) ? ((crc >> 1) ^ 0xEDB88320u) : (crc >> 1);
        }
        table[0][i] = crc;
    }
    // Slices 1-7 : chaque slice[k][i] = table[0][slice[k-1][i] & 0xFF] ^ (slice[k-1][i] >> 8)
    for (int k = 1; k < 8; ++k) {
        for (uint32_t i = 0; i < 256; ++i) {
            table[k][i] = (table[k - 1][i] >> 8) ^ table[0][table[k - 1][i] & 0xFF];
        }
    }
    return table;
}

constexpr auto CRC32_TABLE = make_crc32_table();
constexpr auto CRC32_TABLE_8S = make_crc32_table_8slice();

/// Implementation logicielle slicing-by-8.
uint32_t crc32_software(uint32_t crc, std::span<const uint8_t> data) noexcept {
    crc = ~crc;
    const auto* p = data.data();
    auto len = data.size();

    // Traiter 8 octets a la fois. `memcpy` plutot qu'un assemblage octet par octet :
    // MSVC le replie en un seul `mov` non aligne, sans supposer l'alignement du pointeur.
    while (len >= 8) {
        uint32_t lo;
        uint32_t hi;
        std::memcpy(&lo, p, 4);
        std::memcpy(&hi, p + 4, 4);
        lo ^= crc;
        crc = CRC32_TABLE_8S[7][(lo      ) & 0xFF]
            ^ CRC32_TABLE_8S[6][(lo >>  8) & 0xFF]
            ^ CRC32_TABLE_8S[5][(lo >> 16) & 0xFF]
            ^ CRC32_TABLE_8S[4][(lo >> 24) & 0xFF]
            ^ CRC32_TABLE_8S[3][(hi      ) & 0xFF]
            ^ CRC32_TABLE_8S[2][(hi >>  8) & 0xFF]
            ^ CRC32_TABLE_8S[1][(hi >> 16) & 0xFF]
            ^ CRC32_TABLE_8S[0][(hi >> 24) & 0xFF];

        p += 8;
        len -= 8;
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
