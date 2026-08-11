#pragma once

/// @file format_detector.h
/// Detection automatique du format d'un fichier binaire via ses magic bytes.

#include <cstdint>
#include <span>
#include <string_view>

namespace iecode::formats {

/// Formats de fichiers supportes.
enum class FileFormat {
    Unknown,
    CPK,        // Archive CRI
    UTF,        // Table @UTF CRI
    USM,        // Video CRI
    CRILAYLA,   // Compression CRI
    G4TX,       // Textures Level-5
    G4MG,       // Meshes Level-5
    G4MD,       // Metadonnees modeles Level-5
    G4SK,       // Squelettes Level-5
    G4MT,       // Motion tables Level-5
    G4PK,       // Archives packages Level-5
    G4RA,       // Archives ressources Level-5
    RDBN,       // Configuration moderne Level-5
    CfgBin,     // Configuration Level-5 (chiffree XorShift)
    AGI,        // Format AGI Level-5
    SSZL,       // Compression InazumaLZSS
    ANM,        // Animation Level-5 (ANMC/ANMV/ANMA/ANMN/ANMP)
};

/// Detecte le format d'un fichier a partir de ses premiers octets.
/// Necessite au minimum 16 octets pour une detection fiable.
[[nodiscard]] FileFormat detect(std::span<const uint8_t> data);

/// Retourne le nom lisible du format.
[[nodiscard]] std::string_view format_name(FileFormat fmt);

} // namespace iecode::formats
