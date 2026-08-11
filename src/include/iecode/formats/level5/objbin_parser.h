#pragma once

/// @file objbin_parser.h
/// Parser de fichiers OBJBIN (Level-5, placement d'objets dans les scenes).
/// Format heuristique : pas de magic officiel confirme.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Transformation 3D d'un objet de scene.
struct ObjbinTransform {
    float position[3]{};   ///< Position XYZ
    float rotation[4]{};   ///< Quaternion XYZW
    float scale[3]{};      ///< Echelle XYZ
};

/// Objet individuel dans un fichier OBJBIN.
struct ObjbinObject {
    uint32_t model_crc32 = 0;         ///< CRC32 du nom de modele
    std::string model_name;           ///< Nom depuis le string pool (si present)
    ObjbinTransform transform;        ///< Transformation 3D
    uint32_t flags = 0;               ///< Drapeaux de l'objet
    uint32_t layer = 0;               ///< Couche de rendu / groupement
};

/// Fichier OBJBIN complet.
struct ObjbinFile {
    uint32_t version = 0;
    std::vector<ObjbinObject> objects;
};

/// Parse un fichier OBJBIN depuis un span brut.
/// Retourne nullopt si les donnees sont trop petites ou incoherentes.
[[nodiscard]] std::optional<ObjbinFile> objbin_parse(std::span<const uint8_t> data);

/// Exporte un fichier OBJBIN en JSON.
[[nodiscard]] std::string objbin_to_json(const ObjbinFile& file);

} // namespace iecode::level5
