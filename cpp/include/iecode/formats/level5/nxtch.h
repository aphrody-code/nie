#pragma once

/// @file nxtch.h
/// Header NXTCH (44 octets) et constantes de formats BCn pour les textures Level-5.

#include <cstdint>
#include <cstring>

namespace iecode::level5 {

/// Identifiants de format BCn (valeurs observees dans les fichiers G4TX PC).
inline constexpr uint32_t BCN_FORMAT_BC1  = 0x01;
inline constexpr uint32_t BCN_FORMAT_BC2  = 0x02;
inline constexpr uint32_t BCN_FORMAT_BC3  = 0x03;
inline constexpr uint32_t BCN_FORMAT_BC4  = 0x04;
inline constexpr uint32_t BCN_FORMAT_BC5  = 0x05;
inline constexpr uint32_t BCN_FORMAT_BC6H = 0x06;
inline constexpr uint32_t BCN_FORMAT_BC7  = 0x07;
inline constexpr uint32_t BCN_FORMAT_RGBA8 = 0x1F;

/// Header NXTCH — 44 octets (magic u64 + 9 x i32).
/// Layout exact dans les fichiers G4TX :
///   0x00: magic u64 = "NXTCH000" (les 5 premiers octets doivent etre "NXTCH")
///   0x08: texture_data_size i32
///   0x0C: unk1 i32
///   0x10: unk2 i32
///   0x14: width i32
///   0x18: height i32
///   0x1C: unk3 i32
///   0x20: unk4 i32
///   0x24: format i32 (BCN_FORMAT_*)
///   0x28: mip_count i32
struct NxtchHeader {
    uint64_t magic = 0;              // "NXTCH000"
    int32_t  texture_data_size = 0;  // Taille des donnees texture (sans header)
    int32_t  unk1 = 0;
    int32_t  unk2 = 0;
    int32_t  width = 0;
    int32_t  height = 0;
    int32_t  unk3 = 0;
    int32_t  unk4 = 0;
    int32_t  format = 0;             // BCN_FORMAT_*
    int32_t  mip_count = 0;
};

/// Taille du header NXTCH en octets.
inline constexpr size_t NXTCH_HEADER_SIZE = 44;

/// Verifie que les 5 premiers octets correspondent a "NXTCH".
[[nodiscard]] inline bool nxtch_is_valid(const uint8_t* data, size_t size) noexcept {
    if (size < NXTCH_HEADER_SIZE) return false;
    return std::memcmp(data, "NXTCH", 5) == 0;
}

/// Retourne la taille en octets d'un bloc compresse 4x4 pour le format donne.
[[nodiscard]] constexpr uint32_t bcn_block_size(uint32_t format) noexcept {
    switch (format) {
        case BCN_FORMAT_BC1:
        case BCN_FORMAT_BC4:
            return 8;
        case BCN_FORMAT_BC2:
        case BCN_FORMAT_BC3:
        case BCN_FORMAT_BC5:
        case BCN_FORMAT_BC6H:
        case BCN_FORMAT_BC7:
            return 16;
        case BCN_FORMAT_RGBA8:
            return 4; // octets par pixel, pas par bloc
        default:
            return 0;
    }
}

} // namespace iecode::level5
