#pragma once

/// @file texture_import.h
/// Import de textures PNG vers le format G4TX (Level-5).

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include "iecode/formats/level5/g4tx.h"

namespace iecode::converters {

/// Options pour l'import PNG -> G4TX.
struct TextureImportOptions {
    level5::G4txFormat format = level5::G4txFormat::BC7;  // Format cible
    std::string name;            // Nom de la texture (defaut: stem du fichier)
    uint8_t id = 0;              // ID de la texture
    bool generate_mips = false;  // Generer des mipmaps (pas encore supporte)
};

/// Charge un PNG et le compresse dans un G4txTexture.
/// @param png_path chemin du fichier PNG
/// @param options options d'import (format BCn, nom, etc.)
/// @return G4txTexture pret a serialiser, ou nullopt en cas d'erreur
[[nodiscard]] std::optional<level5::G4txTexture> import_png(
    const std::filesystem::path& png_path,
    const TextureImportOptions& options = {});

/// Charge un buffer RGBA8 brut et le compresse dans un G4txTexture.
[[nodiscard]] std::optional<level5::G4txTexture> import_rgba8(
    const uint8_t* rgba_data, int width, int height,
    const TextureImportOptions& options = {});

/// Serialise un G4txFile complet en binaire G4TX.
/// @param file structure G4txFile a serialiser
/// @return buffer binaire G4TX, ou vide en cas d'erreur
[[nodiscard]] std::vector<uint8_t> g4tx_serialize(const level5::G4txFile& file);

/// Pipeline complet : PNG -> G4TX fichier sur disque.
/// @return true si l'ecriture a reussi
[[nodiscard]] bool import_png_to_g4tx(
    const std::filesystem::path& png_path,
    const std::filesystem::path& output_path,
    const TextureImportOptions& options = {});

} // namespace iecode::converters
