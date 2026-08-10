#pragma once

/// @file col_parser.h
/// Parser de fichiers COL (Level-5, geometrie de collision).
/// Magic attendu : "COL\0" (0x004C4F43) ou "COLS" (0x534C4F43).

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Sommet de collision (3 floats).
struct ColVertex {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
};

/// Triangle de collision (3 indices + drapeaux).
struct ColTriangle {
    uint16_t a = 0;       ///< Index sommet 0
    uint16_t b = 0;       ///< Index sommet 1
    uint16_t c = 0;       ///< Index sommet 2
    uint16_t flags = 0;   ///< Drapeaux de surface (materiau, traversabilite, etc.)
};

/// Fichier COL complet.
struct ColFile {
    uint32_t version = 0;
    std::vector<ColVertex> vertices;
    std::vector<ColTriangle> triangles;
    float bbox_min[3]{};   ///< Bounding box minimum
    float bbox_max[3]{};   ///< Bounding box maximum
};

/// Parse un fichier COL depuis un span brut.
/// Retourne nullopt si le magic est invalide ou les donnees insuffisantes.
[[nodiscard]] std::optional<ColFile> col_parse(std::span<const uint8_t> data);

/// Exporte un fichier COL en JSON.
[[nodiscard]] std::string col_to_json(const ColFile& file);

} // namespace iecode::level5
