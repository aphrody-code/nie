#pragma once

/// @file awb_reader.h
/// Lecteur de fichiers AWB (AFS2) — CRI Atom Wave Bank.
///
/// Le format AFS2 est un conteneur simple utilise par CRI ADX2 pour stocker
/// des pistes audio (typiquement HCA). Structure little-endian.

#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::criware {

/// Entree dans un fichier AWB (une piste audio).
struct AwbEntry {
    uint16_t cue_id = 0;   ///< Identifiant du cue (index dans le CueSheet)
    uint32_t offset = 0;   ///< Offset absolu dans le fichier AWB
    uint32_t size = 0;     ///< Taille en octets des donnees audio
};

/// Fichier AWB (AFS2) parse.
struct AwbFile {
    uint32_t version = 0;       ///< Version du format (0x01 ou 0x02)
    uint32_t block_size = 0;    ///< Alignement des donnees (typiquement 0x20)
    uint32_t key = 0;           ///< Sous-cle pour le dechiffrement HCA
    std::vector<AwbEntry> entries;
};

/// Parse un fichier AWB (AFS2) depuis un span brut.
/// @param data Donnees brutes du fichier AWB
/// @return AwbFile parse, ou nullopt si le format est invalide
[[nodiscard]] std::optional<AwbFile> awb_parse(std::span<const uint8_t> data);

/// Extrait les donnees d'une entree AWB.
/// @param data Donnees brutes du fichier AWB complet
/// @param entry Entree a extraire
/// @return Span vers les donnees de l'entree (zero-copy), ou vide si hors bornes
[[nodiscard]] std::span<const uint8_t> awb_extract_entry(
    std::span<const uint8_t> data, const AwbEntry& entry);

/// Extrait toutes les entrees d'un AWB vers un repertoire.
/// Les fichiers sont nommes cue_XXXX.hca (ou .bin si magic non-HCA).
/// @param data Donnees brutes du fichier AWB complet
/// @param file Structure AWB parsee
/// @param output_dir Repertoire de sortie (cree si absent)
/// @param verbose Affiche chaque fichier extrait
/// @return Nombre de fichiers extraits
[[nodiscard]] uint32_t awb_extract_all(
    std::span<const uint8_t> data,
    const AwbFile& file,
    const std::filesystem::path& output_dir,
    bool verbose = false);

} // namespace iecode::criware
