#pragma once

/// @file asset_converter.h
/// Facade de conversion unifiee avec auto-detection de format.
///
/// Convertit automatiquement les fichiers Level-5 et CRI Middleware
/// vers des formats standards (PNG, WebP, GLB, JSON) en se basant
/// sur l'extension ou la detection par magic bytes.

#include <cstdint>
#include <filesystem>
#include <set>
#include <string>

namespace iecode::converters {

namespace fs = std::filesystem;

/// Options de conversion applicables a un fichier ou un repertoire.
struct ConvertOptions {
    std::string format;              // "png","webp","glb","json","" = auto
    std::set<std::string> languages; // vide = toutes, {"fr"} = francais only
    bool skip_duplicates = true;     // dedup par chemin de sortie predit
    int webp_quality = 90;           // qualite WebP (1-100)
};

/// Resultat d'une conversion batch (repertoire).
struct ConvertResult {
    size_t files_processed = 0;
    size_t files_converted = 0;
    size_t files_skipped = 0;
    size_t errors = 0;
    uint64_t elapsed_ms = 0;
};

/// Convertit un fichier unique. Auto-detecte le format par extension.
/// @param input chemin du fichier source
/// @param output chemin de sortie (fichier ou repertoire selon le format)
/// @param opts options de conversion
/// @return true si la conversion a reussi
[[nodiscard]] bool convert_file(const fs::path& input, const fs::path& output,
                                 const ConvertOptions& opts = {});

/// Convertit un repertoire entier en parallele.
/// @param input_dir repertoire source
/// @param output_dir repertoire de sortie
/// @param recursive parcourir les sous-dossiers
/// @param opts options de conversion
/// @return statistiques de la conversion
[[nodiscard]] ConvertResult convert_directory(const fs::path& input_dir,
                                               const fs::path& output_dir,
                                               bool recursive,
                                               const ConvertOptions& opts = {});

} // namespace iecode::converters
