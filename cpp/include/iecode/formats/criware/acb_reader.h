#pragma once

/// @file acb_reader.h
/// Lecteur de fichiers ACB (CRI Atom Cue Bank).
///
/// Un ACB est une table @UTF contenant les metadonnees d'un cue sheet CRI ADX2.
/// Les donnees audio sont soit embarquees (colonne AwbFile) soit dans un .awb externe.
/// Ce reader extrait les infos de base et le AWB embarque sans decoder le HCA.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::criware {

/// Informations extraites d'un fichier ACB.
struct AcbInfo {
    std::string name;               ///< Nom du cue sheet (colonne Name)
    uint32_t version = 0;           ///< Version (colonne Version)
    uint32_t cue_count = 0;        ///< Nombre de cues
    bool has_embedded_awb = false;  ///< Presence d'un AWB embarque (colonne AwbFile)
    bool has_stream_awb = false;    ///< Presence d'un AWB externe (colonne StreamAwbAfs2Header)
    std::vector<std::string> cue_names; ///< Noms des cues (depuis CueNameTable)
};

/// Parse un fichier ACB et extrait les metadonnees.
/// @param data Donnees brutes du fichier ACB (table @UTF)
/// @return AcbInfo, ou nullopt si le format est invalide
[[nodiscard]] std::optional<AcbInfo> acb_parse(std::span<const uint8_t> data);

/// Extrait le AWB embarque d'un fichier ACB (colonne AwbFile, type Data).
/// @param data Donnees brutes du fichier ACB
/// @return Donnees du AWB embarque, ou vecteur vide si absent
[[nodiscard]] std::vector<uint8_t> acb_extract_awb(std::span<const uint8_t> data);

} // namespace iecode::criware
