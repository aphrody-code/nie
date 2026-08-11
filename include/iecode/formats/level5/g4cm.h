#pragma once

/// @file g4cm.h
/// Parser de conteneurs G4CM (Level-5, Graphics 4 Character Model).
/// Un G4CM regroupe G4MG + G4TX + G4SK + G4MD pour un personnage complet.
/// Structure probable : header + table d'entrees + donnees embarquees.

#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Entree d'un sous-fichier dans un conteneur G4CM.
struct G4cmEntry {
    std::string type;       ///< Type detecte ("g4mg", "g4tx", "g4sk", "g4md", "unknown")
    std::string name;       ///< Nom du fichier (si present dans le conteneur)
    uint32_t offset = 0;    ///< Offset absolu dans le conteneur
    uint32_t size = 0;      ///< Taille du sous-fichier en octets
};

/// Fichier G4CM complet.
struct G4cmFile {
    uint32_t version = 0;           ///< Version du conteneur
    uint32_t header_size = 0;       ///< Taille du header en octets
    std::vector<G4cmEntry> entries; ///< Sous-fichiers embarques
};

/// Parse un fichier G4CM depuis un span brut.
/// Detecte le magic G4CM, puis parse la table d'entrees.
/// Si le magic est en realite G4PK, delegue a g4pk_parse via conversion.
/// @return le fichier parse, ou nullopt si le format est invalide.
[[nodiscard]] std::optional<G4cmFile> g4cm_parse(std::span<const uint8_t> data);

/// Extrait les donnees brutes d'une entree G4CM depuis le span du conteneur.
/// @return un span vers les donnees, ou un span vide si hors limites.
[[nodiscard]] std::span<const uint8_t> g4cm_extract_entry(
    std::span<const uint8_t> container_data,
    const G4cmEntry& entry);

/// Extrait tous les sous-fichiers d'un conteneur G4CM vers un repertoire.
/// @param container_data span brut du conteneur complet
/// @param file fichier G4CM parse
/// @param output_dir repertoire de destination (cree si necessaire)
/// @param verbose affiche chaque fichier extrait
/// @return nombre de fichiers extraits avec succes
[[nodiscard]] uint32_t g4cm_extract_all(
    std::span<const uint8_t> container_data,
    const G4cmFile& file,
    const std::filesystem::path& output_dir,
    bool verbose = false);

} // namespace iecode::level5
