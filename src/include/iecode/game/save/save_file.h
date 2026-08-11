#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <vector>

namespace iecode::game {

/// Resultat du chargement d'un fichier save IEVR.
struct SaveFile {
    std::vector<uint8_t> raw;       ///< Contenu brut du fichier *LIVE
    std::vector<uint8_t> decrypted; ///< Apres AES-128-CBC decrypt
    std::vector<uint8_t> data_bin;  ///< Inner data.bin extrait du container
};

/// Charge et dechiffre un fichier save *LIVE.
///
/// @param path  Chemin vers le fichier (ex. "002AB8F4-USERDATALIVE")
/// @param key   Cle AES-128 (16 bytes)
/// @return      SaveFile rempli, ou nullopt si erreur
[[nodiscard]] std::optional<SaveFile>
load_save_file(const std::filesystem::path& path,
               std::span<const uint8_t, 16> key);

} // namespace iecode::game
