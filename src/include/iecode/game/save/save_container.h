#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::game {

/// Extrait le fichier interne `data.bin` d'un container de save dechiffre.
///
/// Strategie actuelle : scanne le magic G4PK ("G4PK"). Si aucun container
/// reconnu, retourne le buffer tel quel (les saves IEVR peuvent etre du
/// plaintext brut selon le slot).
///
/// @param decrypted_container  Buffer dechiffre issu de save_decrypt()
/// @return                     Bytes du data.bin interne, ou nullopt si erreur
[[nodiscard]] std::optional<std::vector<uint8_t>>
extract_data_bin(std::span<const uint8_t> decrypted_container);

} // namespace iecode::game
