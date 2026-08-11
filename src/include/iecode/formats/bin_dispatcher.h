#pragma once

/// @file bin_dispatcher.h
/// Dispatcher intelligent pour fichiers .bin — detecte le sous-format,
/// dechiffre/decompresse si necessaire, et route vers le parser approprie.
///
/// Les fichiers .bin sont generiques chez Level-5 : ils encapsulent des
/// @UTF, RDBN, G4TX, LZ10, CRILAYLA, ou du CRI chiffre. Ce dispatcher
/// gere toutes les couches (crypto + compression + magic) en un seul appel.

#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace iecode {

/// Formats de fichiers detectables par le dispatcher .bin.
enum class BinFormat {
    Unknown,
    UtfTable,           // @UTF (CRI Universal Table)
    CfgBin,             // RDBN (configuration Level-5)
    G4tx,               // Textures Level-5
    G4mg,               // Meshes Level-5
    G4sk,               // Squelettes Level-5
    G4md,               // Metadonnees modeles Level-5
    G4pk,               // Archives packages Level-5
    G4cm,               // G4CM (collision meshes)
    G4nv,               // G4NV (navigation meshes)
    G4ra,               // Archives ressources Level-5
    G4mt,               // Motion tables Level-5
    Usm,                // CRID (video CRI Sofdec2)
    Awb,                // AFS2 (audio CRI Atom)
    Cpk,                // CPK (archive CRI)
    LuaBytecode,        // Lua 5.2 bytecode (0x1B 'L' 'u' 'a')
    Lz10Compressed,     // Compression LZ10 (magic 0x11)
    CrilaylaCompressed, // Compression CRILAYLA
    CriEncrypted,       // Chiffrement CRI XOR (detecte apres tentative)
    PeExecutable,       // PE32/PE32+ (MZ header)
    Agi,                // Format AGI Level-5
};

/// Resultat de l'inspection d'un fichier .bin.
struct BinInspectResult {
    BinFormat format = BinFormat::Unknown;
    std::string format_name;                ///< Nom lisible du format
    std::vector<uint8_t> payload;           ///< Donnees dechiffrees/decompressees (si applicable)
    bool was_encrypted = false;             ///< true si un dechiffrement CRI a ete applique
    bool was_compressed = false;            ///< true si une decompression a ete appliquee
    std::string compression_type;           ///< "lz10", "crilayla", ou vide
    std::string error;                      ///< Message d'erreur (vide si succes)
};

/// Inspecte les donnees brutes d'un fichier .bin.
/// Tente dans l'ordre : dechiffrement CRI, decompression LZ10/CRILAYLA,
/// puis detection du magic pour identifier le format final.
///
/// @param data   Donnees brutes du fichier
/// @param filename Nom du fichier (utilise pour deriver la cle CRI si necessaire)
/// @return Resultat de l'inspection avec le format detecte et les donnees transformees
[[nodiscard]] BinInspectResult bin_inspect(std::span<const uint8_t> data,
                                           std::string_view filename = "");

/// Dispatch vers le parser approprie et retourne un resume JSON.
/// Appelle bin_inspect() en interne, puis invoque le parser correspondant
/// au format detecte pour produire un JSON detaille.
///
/// @param data   Donnees brutes du fichier
/// @param filename Nom du fichier
/// @return JSON string avec format, metadonnees, was_encrypted, was_compressed
[[nodiscard]] std::string bin_dispatch_json(std::span<const uint8_t> data,
                                            std::string_view filename = "");

/// Retourne le nom lisible d'un BinFormat.
[[nodiscard]] std::string_view bin_format_name(BinFormat fmt);

} // namespace iecode
