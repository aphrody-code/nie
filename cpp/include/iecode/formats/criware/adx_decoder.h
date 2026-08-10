#pragma once

/// @file adx_decoder.h
/// Decodeur ADX (CRI ADPCM 4-bit) vers PCM 16-bit signe.
/// Format : 18 octets par frame -> 32 samples par canal.

#include <cstdint>
#include <span>
#include <vector>

namespace iecode::criware {

/// Resultat d'un decodage ADX.
struct AdxPcm {
    std::vector<int16_t> samples;    ///< Samples PCM 16-bit entrelaces
    uint32_t             sample_rate = 0;
    uint32_t             channels    = 0;
    uint32_t             frame_count = 0; ///< Nombre de frames par canal
};

/// Decode un flux ADX en PCM 16-bit.
/// Supporte l'encodage standard (type 3) avec coefficients fixes version 4.
/// @param data Donnees brutes du fichier ADX (incluant header)
/// @return Resultat PCM, ou resultat vide si le format est invalide.
[[nodiscard]] AdxPcm adx_decode(std::span<const uint8_t> data);

/// Detecte si un buffer commence par un header ADX valide.
[[nodiscard]] bool is_adx(std::span<const uint8_t> data) noexcept;

} // namespace iecode::criware
