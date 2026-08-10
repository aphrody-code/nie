#pragma once

/// @file cfgbin_decrypt.h
/// Dechiffrement des fichiers cfg.bin Level-5.
///
/// Algorithme stream cipher base sur une LUT CRC32 (polynome 0xEDB88320) :
/// - Par bloc aligne de 4 bytes, un etat 32-bit est calcule via 4 passes
///   de la LUT seedees par ~(offset & ~3) et melangees avec les 4 octets de la cle.
/// - Avant XOR, une permutation 2-bit est appliquee a l'etat pour chaque octet
///   du bloc, produisant l'octet de keystream final.
/// - Le keystream est XORe in-place sur le buffer.
///
/// Fonction originale : FUN_14048e560 dans nie.c.

#include <cstdint>
#include <span>

namespace iecode::crypto {

/// Dechiffre (ou chiffre — l'operation est involutive) un buffer cfg.bin in-place.
/// @param buf Buffer a traiter.
/// @param start_offset Offset absolu du premier octet de `buf` dans le flux original
///        (utilise pour reconstruire le keystream aligne sur 4).
/// @param key Cle 32-bit (0x1717E18E pour cpk_list.cfg.bin).
void cfgbin_decrypt(std::span<uint8_t> buf, uint32_t start_offset, uint32_t key) noexcept;

/// Heuristique : detecte si un buffer cfg.bin est chiffre en testant
/// la presence d'un magic T2B/RDBN non chiffre au debut/fin.
[[nodiscard]] bool cfgbin_is_encrypted(std::span<const uint8_t> buf) noexcept;

} // namespace iecode::crypto
