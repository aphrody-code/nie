#pragma once

/// @file gds_chara_model.h
/// Donnees de modele 3D des personnages — mesh, texture, parts, scale, LOD.
/// Source : fichiers cfg.bin (CHARA_MODEL, CHARA_TEXTURE, CHARA_PARTS, etc.).

#include "../gds_types.h"
#include <string>

namespace game {

/// Modele 3D d'un personnage — GDSCharaModel (mesh hash + LOD).
struct GDSCharaModel {
    uint32_t      chara_id   = 0;
    lives::hash32 mesh_hash;       ///< CRC32 du fichier .g4mg
    uint8_t       lod_level  = 0;  ///< Niveau de detail (0 = max)
    uint8_t       model_type = 0;

    static constexpr std::string_view CFG_KEY = "CHARA_MODEL";
};

/// Texture d'un personnage — GDSCharaTexture (path hash G4TX).
struct GDSCharaTexture {
    uint32_t      chara_id     = 0;
    lives::hash32 texture_hash;    ///< CRC32 du fichier .g4tx
    uint8_t       texture_slot = 0;
    std::string   texture_name;

    static constexpr std::string_view CFG_KEY = "CHARA_TEXTURE";
};

/// Slot de parts d'un personnage — GDSCharaParts.
struct GDSCharaParts {
    uint32_t      chara_id  = 0;
    uint32_t      parts_id  = 0;
    uint8_t       slot      = 0;   ///< Emplacement (tete, corps, accessoire...)
    lives::hash32 mesh_hash;

    static constexpr std::string_view CFG_KEY = "CHARA_PARTS";
};

/// Echelle d'un personnage — GDSCharaScale.
struct GDSCharaScale {
    uint32_t chara_id = 0;
    float    scale_x  = 1.f;
    float    scale_y  = 1.f;
    float    scale_z  = 1.f;

    static constexpr std::string_view CFG_KEY = "CHARA_SCALE";
};

/// Type de mesh d'un personnage — GDSCharaMeshType.
struct GDSCharaMeshType {
    uint32_t chara_id  = 0;
    uint32_t mesh_type = 0;

    static constexpr std::string_view CFG_KEY = "CHARA_MESH_TYPE";
};

/// Changement de modele contextuel — GDSCharaModelChange.
struct GDSCharaModelChange {
    uint32_t      chara_id       = 0;
    uint32_t      context_id     = 0;  ///< ID de la situation (match, menu, event...)
    lives::hash32 alt_mesh_hash;

    static constexpr std::string_view CFG_KEY = "CHARA_MODEL_CHANGE";
};

} // namespace game
