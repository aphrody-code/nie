#pragma once

/// @file anm_parser.h
/// Parser de fichiers d'animation ANMx (Level-5).
/// Supporte les variantes ANMC, ANMV, ANMA, ANMN, ANMP.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace iecode::level5 {

/// Types d'animation Level-5 (ANMx).
enum class AnmType : uint8_t {
    Unknown = 0,
    ANMC    = 1,   ///< Animation Character
    ANMV    = 2,   ///< Animation Variable
    ANMA    = 3,   ///< Animation Action
    ANMN    = 4,   ///< Animation Node
    ANMP    = 5,   ///< Animation Parameter
};

/// En-tete d'un fichier ANMx.
struct AnmHeader {
    char     magic[4] = {};           ///< "ANMC", "ANMV", etc.
    AnmType  type = AnmType::Unknown; ///< Type detecte depuis le magic
    uint32_t version = 0;             ///< Version du format
    uint32_t data_size = 0;           ///< Taille totale des donnees
    uint32_t entry_count = 0;         ///< Nombre d'entrees d'animation
    uint32_t frame_count = 0;         ///< Nombre total de frames
    float    fps = 30.0f;             ///< Framerate (30 fps par defaut Level-5)
};

/// Entree d'animation (keyframe ou courbe).
struct AnmEntry {
    uint32_t    target_hash = 0;    ///< Hash CRC32 de la cible (bone, morph, etc.)
    uint32_t    channel = 0;        ///< Canal (posX, posY, posZ, rotX, etc.)
    uint32_t    keyframe_count = 0; ///< Nombre de keyframes
    std::vector<float> times;       ///< Timestamps des keyframes
    std::vector<float> values;      ///< Valeurs des keyframes
};

/// Fichier ANMx parse.
struct AnmFile {
    AnmHeader             header;   ///< En-tete du fichier
    std::vector<AnmEntry> entries;  ///< Entrees d'animation
};

/// Detecte si les donnees sont un fichier ANMx valide.
[[nodiscard]] bool anm_is_valid(std::span<const uint8_t> data);

/// Detecte le type ANMx depuis le magic.
[[nodiscard]] AnmType anm_detect_type(std::span<const uint8_t> data);

/// Retourne le nom du type ANMx sous forme de string_view.
[[nodiscard]] std::string_view anm_type_name(AnmType type);

/// Parse un fichier ANMx complet.
/// Retourne std::nullopt si le format est invalide.
[[nodiscard]] std::optional<AnmFile> anm_parse(std::span<const uint8_t> data);

/// Exporte les donnees d'animation en JSON (nlohmann-json format).
[[nodiscard]] std::string anm_to_json(const AnmFile& anm);

} // namespace iecode::level5
