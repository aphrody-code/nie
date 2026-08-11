#pragma once

/// @file texture_export.h
/// Export de textures G4TX vers PNG ou DDS brut.

#include <filesystem>
#include "iecode/formats/level5/g4tx.h"

namespace iecode::converters {

/// Format de sortie pour l'export de textures.
enum class ExportFormat { PNG, DDS, WebP };

/// Options d'export de texture.
struct TextureExportOptions {
    bool export_dds = false;  // Si true, exporte le DDS brut au lieu de convertir en PNG
};

/// Exporte une texture G4TX en fichier PNG (decompresse BCn -> RGBA8).
/// @return true si l'export a reussi
[[nodiscard]] bool export_png(const level5::G4txTexture& texture,
                               const std::filesystem::path& output_path);

/// Exporte une texture G4TX en fichier DDS brut (copie directe du chunk).
/// @return true si l'export a reussi
[[nodiscard]] bool export_dds(const level5::G4txTexture& texture,
                               const std::filesystem::path& output_path);

/// Decode une texture BCn vers RGBA8.
[[nodiscard]] std::vector<uint8_t> decode_to_rgba8(const level5::G4txTexture& texture);

/// Exporte une texture en WebP (requiert IECODE_HAS_WEBP).
[[nodiscard]] bool export_webp(const level5::G4txTexture& texture,
                                const std::filesystem::path& output_path,
                                int quality = 90, bool lossless = false);

/// Nom d'extension pour un format.
[[nodiscard]] inline const char* format_ext(ExportFormat fmt) {
    switch (fmt) {
        case ExportFormat::PNG:  return ".png";
        case ExportFormat::DDS:  return ".dds";
        case ExportFormat::WebP: return ".webp";
    }
    return ".png";
}

/// Exporte toutes les textures d'un G4TX dans un repertoire.
/// @param options controle le format de sortie (PNG par defaut)
/// @return nombre de textures exportees avec succes
[[nodiscard]] size_t export_all_png(const level5::G4txFile& file,
                                     const std::filesystem::path& output_dir,
                                     const TextureExportOptions& options = {});

} // namespace iecode::converters
