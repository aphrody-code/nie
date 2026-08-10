#pragma once

/// @file xorshift.h
/// Dechiffrement XorShift Level-5 (cfg.bin / save data).
/// Algorithme : LFSR 4-etats + table OddPrimes + shuffle 4096 iterations.
/// Source originale : yw_save.py par togenyan, C# par Tinifan/Antigravity.

#include <cstdint>
#include <span>

namespace iecode::crypto {

/// Dechiffre un buffer cfg.bin in-place avec XorShift Level-5.
/// La seed est extraite des 4 derniers octets.
/// Les 8 derniers octets (checksum + seed) ne sont pas modifies.
void xorshift_decrypt(std::span<uint8_t> data);

/// Chiffre un buffer cfg.bin in-place avec une seed donnee.
/// Ecrit le CRC32 a offset -8 et la seed a offset -4.
void xorshift_encrypt(std::span<uint8_t> data, uint32_t seed);

} // namespace iecode::crypto
