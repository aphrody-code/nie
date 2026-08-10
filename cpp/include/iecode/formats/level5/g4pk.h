#pragma once

/// @file g4pk.h
/// Parser d'archives G4PK (Level-5, Graphics 4 Package).
/// Basé sur le format Kuriimu2 et l'implementation .NET.

#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Entree d'un fichier dans une archive G4PK.
struct G4pkEntry {
    std::string name;       ///< Nom du fichier
    uint32_t offset = 0;    ///< Offset absolu dans l'archive
    uint32_t size = 0;      ///< Taille du fichier
    uint32_t hash = 0;      ///< CRC32 du nom de fichier
};

/// Fichier G4PK complet.
struct G4pkFile {
    uint32_t version = 0;
    uint16_t header_size = 0;
    uint16_t file_type = 0;
    uint32_t content_size = 0;
    std::vector<G4pkEntry> entries;
};

/// Parse un fichier G4PK depuis un span brut.
[[nodiscard]] std::optional<G4pkFile> g4pk_parse(std::span<const uint8_t> data);

/// Extrait les donnees brutes d'une entree G4PK depuis le span de l'archive.
/// Retourne un span vide si l'entree est hors limites.
[[nodiscard]] std::span<const uint8_t> g4pk_extract_entry(
    std::span<const uint8_t> archive_data,
    const G4pkEntry& entry);

/// Extrait tous les fichiers d'une archive G4PK vers un repertoire de sortie.
/// @param archive_data span brut de l'archive complete
/// @param file entree G4PK parsee
/// @param output_dir repertoire de destination (cree si necessaire)
/// @param verbose affiche chaque fichier extrait
/// @return nombre de fichiers extraits avec succes
[[nodiscard]] uint32_t g4pk_extract_all(
    std::span<const uint8_t> archive_data,
    const G4pkFile& file,
    const std::filesystem::path& output_dir,
    bool verbose = false);

} // namespace iecode::level5
