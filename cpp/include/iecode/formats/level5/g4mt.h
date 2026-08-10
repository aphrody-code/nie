#pragma once

/// @file g4mt.h
/// Parser de motion tables G4MT (Level-5).
/// Table de mapping texture/materiau vers parties de modele.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Entree de mapping texture dans G4MT.
struct G4mtEntry {
    uint32_t texture_id = 0;    ///< ID de texture reference
    uint32_t material_id = 0;   ///< ID de materiau
    uint32_t flags = 0;         ///< Flags d'utilisation
    uint32_t reserved = 0;      ///< Champ reserve
};

/// Fichier G4MT (motion table / mapping textures).
struct G4mtFile {
    uint32_t version = 0;
    uint16_t header_size = 0;
    uint32_t entry_count = 0;
    std::vector<G4mtEntry> entries;
};

/// Parse un fichier G4MT depuis un span brut.
[[nodiscard]] std::optional<G4mtFile> g4mt_parse(std::span<const uint8_t> data);

} // namespace iecode::level5
