#pragma once

/// @file cri_crypto.h
/// Chiffrement/dechiffrement XOR CRI Middleware.
/// Algorithme : CRC32-state-based XOR byte computation (reverse-engineered).

#include <cstdint>
#include <span>
#include <string_view>

namespace iecode::crypto {

/// Dechiffre (ou chiffre — XOR est symetrique) un buffer in-place.
/// Utilise file_offset=0 (buffer complet depuis le debut du fichier).
void cri_decrypt(std::span<uint8_t> data, uint32_t key);

/// Dechiffre un bloc a un offset donne dans le fichier.
/// Necessaire pour le dechiffrement par blocs (streaming).
void cri_decrypt_block(std::span<uint8_t> data, int64_t file_offset, uint32_t key);

/// Dechiffre une table CRI UTF in-place (xor_multiplier=0x15, xor=0x5f).
void cri_decrypt_table(std::span<uint8_t> data);

/// Derive la cle XOR a partir d'un nom de fichier (CRC32 sur le filename UTF-8).
[[nodiscard]] uint32_t cri_derive_key(std::string_view filename);

/// Derive la cle XOR avec prefixe AppID — format nie.exe : CRC32("XXXXXXXX-filename").
/// @param filename Nom du fichier CPK (ex: "e832856918ebb97cb4430f715e6bd525.cpk")
/// @param app_id   Steam AppID (2799860 pour IEVR). 0 = pas de prefixe (legacy).
/// nie.exe : FUN_1404a0670 — sprintf("%08X-%s", app_id, cpk_path) puis CRC32.
[[nodiscard]] uint32_t cri_derive_key(std::string_view filename, uint32_t app_id);

/// Verifie si les donnees semblent chiffrees (pas de magic CRI connu).
[[nodiscard]] bool cri_is_encrypted(std::span<const uint8_t> data);

} // namespace iecode::crypto
