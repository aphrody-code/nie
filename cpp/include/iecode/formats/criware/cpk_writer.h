#pragma once

/// @file cpk_writer.h
/// Ecriture/patching d'archives CPK (CRI Package).
///
/// Deux modes :
///   1. **Patch** : remplacer un fichier dans un CPK existant (si taille <= originale)
///   2. **Rebuild** : reconstruire un CPK complet depuis une liste de fichiers
///
/// Le format CPK est : "CPK " header + @UTF TOC + fichiers concatenes.
/// La TOC est une table @UTF avec FileName, DirName, FileOffset, FileSize, ExtractSize.

#include "iecode/formats/criware/cpk_reader.h"

#include <filesystem>
#include <string>
#include <vector>

namespace iecode::criware {

/// Fichier a inclure dans un CPK.
struct CpkWriteEntry {
    std::string filename;
    std::string directory;
    std::vector<uint8_t> data;
    bool compress = false;  // Si true, compresse en CRILAYLA
};

/// Reconstruit un fichier CPK complet depuis une liste d'entrees.
/// @param entries fichiers a empaqueter
/// @param output_path chemin de sortie
/// @return true si succes
[[nodiscard]] bool cpk_rebuild(const std::vector<CpkWriteEntry>& entries,
                                const std::filesystem::path& output_path);

/// Patche un fichier dans un CPK existant (remplacement in-place).
/// Le nouveau fichier doit etre <= a l'ancien en taille.
/// @param cpk_path chemin vers le CPK existant
/// @param filename nom du fichier a remplacer (avec directory)
/// @param new_data nouvelles donnees
/// @return true si succes
[[nodiscard]] bool cpk_patch_file(const std::filesystem::path& cpk_path,
                                    const std::string& filename,
                                    std::span<const uint8_t> new_data);

} // namespace iecode::criware
