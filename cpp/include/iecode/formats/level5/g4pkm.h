#pragma once

/// @file g4pkm.h
/// Parser G4PKM — variante multi-entry de G4PK.
/// Magic identique a G4PK ("G4PK@"), header_size = 0x64 (100 octets).
/// Les noms de fichiers sont embedded en ASCII null-terminated a +0x60.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Entree d'un fichier dans une archive G4PKM.
struct G4pkmEntry {
    std::string name;
    uint32_t offset = 0;
    uint32_t size = 0;
};

/// Fichier G4PKM complet.
struct G4pkmFile {
    uint32_t version = 0;
    uint16_t header_size = 0;
    uint16_t file_type = 0;
    uint32_t content_size = 0;
    uint32_t entry_count = 0;
    std::vector<G4pkmEntry> entries;
};

/// Parse un fichier G4PKM depuis un span brut.
[[nodiscard]] std::optional<G4pkmFile> g4pkm_parse(std::span<const uint8_t> data);

/// Extrait les donnees brutes d'une entree G4PKM.
[[nodiscard]] std::span<const uint8_t> g4pkm_extract_entry(
    std::span<const uint8_t> archive_data,
    const G4pkmEntry& entry);

} // namespace iecode::level5
