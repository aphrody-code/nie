#pragma once

/// @file merge.h
/// Fusion recursive de dossiers (Viola merge).
///
/// Copie recursivement tous les fichiers de source vers target,
/// avec option d'ecrasement. Utile pour combiner plusieurs mods.
///
/// Equivalent C++ de Viola.Core.Merge.Logic.CMerge (C#).

#include <cstdint>
#include <filesystem>
#include <string>

namespace iecode::viola {

/// Resultat d'une operation de fusion.
struct MergeResult {
    bool success = false;
    size_t files_copied = 0;      // Fichiers copies
    size_t files_skipped = 0;     // Fichiers non copies (deja existants, overwrite=false)
    size_t dirs_created = 0;      // Dossiers crees
    uint64_t bytes_copied = 0;    // Total d'octets copies
    std::string error;            // Message d'erreur si !success
};

/// Fusionne recursivement un dossier source dans un dossier cible.
///
/// Pour chaque fichier dans source :
///   - Si le fichier n'existe pas dans target : copie
///   - Si le fichier existe et overwrite=true : ecrase
///   - Si le fichier existe et overwrite=false : ignore
///
/// Les dossiers sont crees automatiquement dans target.
///
/// @param source     dossier source
/// @param target     dossier cible
/// @param overwrite  ecraser les fichiers existants
/// @return resultat de la fusion
[[nodiscard]] MergeResult merge_directories(
    const std::filesystem::path& source,
    const std::filesystem::path& target,
    bool overwrite = true);

} // namespace iecode::viola
