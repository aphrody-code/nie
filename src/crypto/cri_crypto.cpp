#include "iecode/crypto/cri_crypto.h"

#include <array>
#include <cstring>

namespace iecode::crypto {

namespace {

/// Table CRC32 (polynome 0xEDB88320) — identique a crc32.cpp.
/// Dupliquee ici pour acces direct dans les hot paths UpdateCrcState/ComputeXorByte.
/// Noms prefixes cri_ pour eviter conflit en unity build avec crc32.cpp.
constexpr auto cri_make_crc32_table() noexcept {
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

constexpr auto CRI_CRC32_TABLE = cri_make_crc32_table();

/// Calcule l'etat CRC pour un offset de fichier donne + 4 octets de cle.
/// Reference : NativeCrypto.cs UpdateCrcState()
inline uint32_t update_crc_state(uint32_t seed, uint8_t k0, uint8_t k1,
                                  uint8_t k2, uint8_t k3) noexcept {
    uint32_t crc = ~seed;
    crc = (crc >> 8) ^ CRI_CRC32_TABLE[static_cast<uint8_t>(crc & 0xFF) ^ k0];
    crc = (crc >> 8) ^ CRI_CRC32_TABLE[static_cast<uint8_t>(crc & 0xFF) ^ k1];
    crc = (crc >> 8) ^ CRI_CRC32_TABLE[static_cast<uint8_t>(crc & 0xFF) ^ k2];
    crc = (crc >> 8) ^ CRI_CRC32_TABLE[static_cast<uint8_t>(crc & 0xFF) ^ k3];
    return ~crc;
}

/// Extrait l'octet XOR pour une position (0-3) dans un bloc de 4 octets.
/// Reference : NativeCrypto.cs ComputeXorByte()
inline uint8_t compute_xor_byte(uint32_t crc, int position) noexcept {
    const int base_shift = position * 2;
    uint32_t r8 = (crc >> (base_shift + 8)) & 3;
    r8 |= ((crc >> base_shift) & 0xFFu) << 2 & 0xFFu;
    r8 = ((r8 << 2) & 0xFFu) | ((crc >> (base_shift + 16)) & 3);
    r8 = ((r8 << 2) & 0xFFu) | ((crc >> (base_shift + 24)) & 3);
    return static_cast<uint8_t>(r8);
}

/// Calcule les 4 octets XOR d'un coup pour un etat CRC donne.
/// Optimisation : evite 4 appels separes a compute_xor_byte dans la boucle principale.
/// Retourne un uint32_t ou chaque octet correspond a xor_byte[0..3].
inline uint32_t compute_xor_u32(uint32_t crc) noexcept {
    return static_cast<uint32_t>(compute_xor_byte(crc, 0))
         | (static_cast<uint32_t>(compute_xor_byte(crc, 1)) << 8)
         | (static_cast<uint32_t>(compute_xor_byte(crc, 2)) << 16)
         | (static_cast<uint32_t>(compute_xor_byte(crc, 3)) << 24);
}

} // namespace

void cri_decrypt(std::span<uint8_t> data, uint32_t key) {
    cri_decrypt_block(data, 0, key);
}

void cri_decrypt_block(std::span<uint8_t> data, int64_t file_offset, uint32_t key) {
    if (data.empty()) return;

    const uint8_t k0 = static_cast<uint8_t>(key);
    const uint8_t k1 = static_cast<uint8_t>(key >> 8);
    const uint8_t k2 = static_cast<uint8_t>(key >> 16);
    const uint8_t k3 = static_cast<uint8_t>(key >> 24);

    const auto length = static_cast<int64_t>(data.size());
    int64_t i = 0;

    // Aligner sur une frontiere de 4 octets
    const int64_t align_offset = file_offset & 3;
    if (align_offset != 0) {
        const uint32_t current_crc = update_crc_state(
            static_cast<uint32_t>(file_offset & ~int64_t{3}), k0, k1, k2, k3);
        const int64_t align_count = std::min(int64_t{4} - align_offset, length);
        for (int64_t j = 0; j < align_count; ++j, ++i) {
            data[static_cast<size_t>(i)] ^= compute_xor_byte(
                current_crc, static_cast<int>((file_offset + i) & 3));
        }
    }

    // Boucle principale optimisee : XOR 4 octets a la fois avec un seul store u32
    int64_t base_offset = file_offset + i;
    while (i + 4 <= length) [[likely]] {
        const uint32_t crc = update_crc_state(
            static_cast<uint32_t>(base_offset), k0, k1, k2, k3);

        // Calculer les 4 octets XOR en un seul appel
        const uint32_t xor_mask = compute_xor_u32(crc);

        // Lire 4 octets, XOR, ecrire — une seule operation memoire
        uint32_t block;
        std::memcpy(&block, &data[static_cast<size_t>(i)], 4);
        block ^= xor_mask;
        std::memcpy(&data[static_cast<size_t>(i)], &block, 4);

        i += 4;
        base_offset += 4;
    }

    // Octets restants
    if (i < length) {
        const uint32_t crc = update_crc_state(
            static_cast<uint32_t>(base_offset), k0, k1, k2, k3);
        for (int pos = 0; i < length; ++i, ++pos) {
            data[static_cast<size_t>(i)] ^= compute_xor_byte(crc, pos);
        }
    }
}

void cri_decrypt_table(std::span<uint8_t> data) {
    if (data.empty()) return;

    constexpr uint8_t xor_multiplier = 0x15;
    uint8_t xor_val = 0x5F;

    for (size_t i = 0; i < data.size(); ++i) {
        data[i] ^= xor_val;
        xor_val = static_cast<uint8_t>(xor_val * xor_multiplier);
    }
}

uint32_t cri_derive_key(std::string_view filename) {
    // CRC32 sur le filename UTF-8 (polynome 0xEDB88320)
    uint32_t crc = 0xFFFFFFFFu;
    for (const auto c : filename) {
        crc = (crc >> 8) ^ CRI_CRC32_TABLE[static_cast<uint8_t>((crc ^ static_cast<uint8_t>(c)) & 0xFF)];
    }
    return ~crc;
}

uint32_t cri_derive_key(std::string_view filename, uint32_t app_id) {
    if (app_id == 0) {
        return cri_derive_key(filename);
    }
    // nie.exe FUN_1404a0670 : sprintf("%08X-%s", app_id, cpk_path) puis CRC32.
    // AppID 2799860 = 0x002AB8F4 → prefixe "002AB8F4-"
    char buf[512];
    const int len = std::snprintf(buf, sizeof(buf), "%08X-%.*s",
                                  app_id,
                                  static_cast<int>(filename.size()), filename.data());
    return cri_derive_key(std::string_view(buf, static_cast<size_t>(len)));
}

bool cri_is_encrypted(std::span<const uint8_t> data) {
    if (data.size() < 4) return false;

    uint32_t magic = 0;
    std::memcpy(&magic, data.data(), 4);

    switch (magic) {
        case 0x204B5043: // "CPK "
        case 0x46545540: // "@UTF"
        case 0x32534641: // "AFS2"
        case 0x20424341: // "ACB "
        case 0x20425741: // "AWB "
        case 0x474D3447: // "G4MG"
        case 0x444D3447: // "G4MD"
        case 0x58543447: // "G4TX"
            return false;
        default:
            return true;
    }
}

} // namespace iecode::crypto
