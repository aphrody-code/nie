#pragma once

/// @file g4ra.h
/// Parser d'archives G4RA (Level-5, resource archive).
/// Reverse-engineered depuis nie.exe (FUN_1404ce260).

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Entree de ressource dans une archive G4RA.
struct G4raEntry {
    int index = 0;
    std::string name;       ///< Nom lu depuis la string table (ou "resource_NNNN")
    uint32_t offset = 0;    ///< Offset des donnees dans le fichier
    uint32_t size = 0;      ///< Taille des donnees
    uint16_t ref_count = 0; ///< Compteur de references (runtime)
    uint8_t flags = 0;      ///< Flags d'activite
};

/// Fichier G4RA complet (archive de ressources).
struct G4raFile {
    uint32_t version = 0;
    uint32_t entry_count = 0;
    uint32_t entry_table_offset = 0;
    uint32_t string_table_offset = 0;
    uint32_t string_table_size = 0;
    int16_t active_count = 0;
    std::vector<G4raEntry> entries;
};

/// Parse un fichier G4RA depuis un span brut.
[[nodiscard]] std::optional<G4raFile> g4ra_parse(std::span<const uint8_t> data);

} // namespace iecode::level5
