#include "iecode/crypto/xorshift.h"

#include "iecode/crypto/crc32.h"

#include <array>
#include <cstring>

namespace iecode::crypto {

namespace {

/// 256 premiers nombres premiers impairs (3..1621).
/// Utilises comme index dans la table shufflee pour le processus XOR.
constexpr std::array<uint16_t, 256> ODD_PRIMES = {
    3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73,
    79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157,
    163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239,
    241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317, 331,
    337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419, 421,
    431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503, 509,
    521, 523, 541, 547, 557, 563, 569, 571, 577, 587, 593, 599, 601, 607, 613,
    617, 619, 631, 641, 643, 647, 653, 659, 661, 673, 677, 683, 691, 701, 709,
    719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797, 809, 811, 821,
    823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883, 887, 907, 911, 919,
    929, 937, 941, 947, 953, 967, 971, 977, 983, 991, 997, 1009, 1013, 1019,
    1021, 1031, 1033, 1039, 1049, 1051, 1061, 1063, 1069, 1087, 1091, 1093,
    1097, 1103, 1109, 1117, 1123, 1129, 1151, 1153, 1163, 1171, 1181, 1187,
    1193, 1201, 1213, 1217, 1223, 1229, 1231, 1237, 1249, 1259, 1277, 1279,
    1283, 1289, 1291, 1297, 1301, 1303, 1307, 1319, 1321, 1327, 1361, 1367,
    1373, 1381, 1399, 1409, 1423, 1427, 1429, 1433, 1439, 1447, 1451, 1453,
    1459, 1471, 1481, 1483, 1487, 1489, 1493, 1499, 1511, 1523, 1531, 1543,
    1549, 1553, 1559, 1567, 1571, 1579, 1583, 1597, 1601, 1607, 1609, 1613,
    1619, 1621
};

/// Generateur XorShift 4-etats (variante Mersenne Twister).
/// Avance les 4 etats et retourne un entier module `arg`.
int xorshift_next(uint32_t states[4], int arg) noexcept {
    uint32_t x = states[0];
    uint32_t y = states[3];
    states[0] = states[1];
    states[1] = states[2];
    states[2] = states[3];

    x = x ^ (x << 11);
    x = x ^ (x >> 8);
    y = y ^ (y >> 19);

    states[3] = x ^ y;

    if (arg == 0) return static_cast<int>(states[3]);
    return static_cast<int>(states[3] % static_cast<uint32_t>(arg));
}

/// Processus XorShift commun (dechiffrement et chiffrement sont identiques).
void xorshift_process(std::span<uint8_t> data) {
    if (data.size() < 8) return;

    // Table de permutation initialisee a l'identite
    std::array<uint8_t, 256> table;
    for (int i = 0; i < 256; ++i) table[i] = static_cast<uint8_t>(i);

    // Extraire la seed des 4 derniers octets (LE)
    uint32_t seed = 0;
    std::memcpy(&seed, data.data() + data.size() - 4, 4);

    // Generer les 4 etats du LFSR
    uint32_t states[4];
    uint32_t start = seed;
    for (int i = 0; i < 3; ++i) {
        start = start ^ (start >> 30);
        start = static_cast<uint32_t>(i + 1 + start * (0x6C078966u - 1u));
        states[i] = start;
    }
    states[3] = 0x03DF95B3u;

    // Shuffle de la table (4096 iterations)
    for (int i = 0; i < 4096; ++i) {
        const int r = xorshift_next(states, 0x10000);
        const int r1 = r & 0xFF;
        const int r2 = (r >> 8) & 0xFF;

        if (r1 != r2) {
            std::swap(table[r1], table[r2]);
        }
    }

    // Processus XOR — skip les 8 derniers octets (checksum + seed)
    const auto limit = static_cast<int>(data.size()) - 8;
    int ka = 0;
    for (int i = 0; i < limit; ++i) {
        if (i % 0x100 == 0) {
            ka = ODD_PRIMES[table[(i & 0xFF00) >> 8]];
        }
        const int kb = table[(ka * (i + 1)) & 0xFF];
        data[i] ^= static_cast<uint8_t>(kb);
    }
}

} // namespace

void xorshift_decrypt(std::span<uint8_t> data) {
    xorshift_process(data);
}

void xorshift_encrypt(std::span<uint8_t> data, uint32_t seed) {
    if (data.size() < 8) return;

    // Ecrire la seed dans les 4 derniers octets avant le processus
    std::memcpy(data.data() + data.size() - 4, &seed, 4);

    // Le processus XOR est symetrique
    xorshift_process(data);

    // Calculer le CRC32 sur les donnees chiffrees (excluant les 8 derniers octets)
    const auto payload_size = data.size() - 8;
    const uint32_t crc = crc32_compute(data.subspan(0, payload_size));

    // Ecrire le CRC32 a offset -8
    std::memcpy(data.data() + payload_size, &crc, 4);
}

} // namespace iecode::crypto
