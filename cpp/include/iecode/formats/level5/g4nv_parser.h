#pragma once

/// @file g4nv_parser.h
/// Parser de fichiers G4NV (Level-5, navigation mesh).
/// Magic : "G4NV" (0x564E3447 en little-endian).

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Noeud du navmesh (centre, rayon, connexions).
struct G4nvNode {
    float center[3]{};                    ///< Centre du noeud XYZ
    float radius = 0.0f;                  ///< Rayon de la zone
    uint32_t flags = 0;                   ///< Drapeaux (type de terrain, etc.)
    std::vector<uint32_t> connections;    ///< Indices des noeuds voisins
};

/// Fichier G4NV complet.
struct G4nvFile {
    uint32_t version = 0;
    std::vector<G4nvNode> nodes;
};

/// Parse un fichier G4NV depuis un span brut.
/// Retourne nullopt si le magic est invalide ou les donnees insuffisantes.
[[nodiscard]] std::optional<G4nvFile> g4nv_parse(std::span<const uint8_t> data);

/// Exporte un fichier G4NV en JSON.
[[nodiscard]] std::string g4nv_to_json(const G4nvFile& file);

} // namespace iecode::level5
