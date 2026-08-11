#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::game {

/// Dechiffre un fichier save IEVR (AES-128-CBC).
///
/// Format attendu : IV[16] || ciphertext (multiple de 16 bytes).
/// Applique un unpadding PKCS7 apres dechiffrement.
///
/// @param data  Contenu brut du fichier *LIVE
/// @param key   Cle AES-128 (16 bytes) extraite de nie.exe
/// @return      Plaintext dechiffre, ou nullopt si erreur
[[nodiscard]] std::optional<std::vector<uint8_t>>
save_decrypt(std::span<const uint8_t> data,
             std::span<const uint8_t, 16> key);

/// Chiffre un plaintext IEVR (AES-128-CBC) avec IV aleatoire (BCryptGenRandom).
///
/// Applique un padding PKCS7 avant chiffrement.
///
/// @param plaintext  Donnees a chiffrer
/// @param key        Cle AES-128 (16 bytes)
/// @return           IV[16] || ciphertext, ou nullopt si erreur
[[nodiscard]] std::optional<std::vector<uint8_t>>
save_encrypt(std::span<const uint8_t> plaintext,
             std::span<const uint8_t, 16> key);

} // namespace iecode::game
