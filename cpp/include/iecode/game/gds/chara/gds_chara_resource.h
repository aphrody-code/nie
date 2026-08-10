#pragma once

/// @file gds_chara_resource.h
/// Ressources menu/son/uniforme des personnages.
/// Source : fichiers cfg.bin (CHARA_MENU_RESOURCE, CHARA_SOUND_RESOURCE, etc.).

#include "../gds_types.h"
#include <glm/vec2.hpp>
#include <string>

namespace game {

/// Ressource menu d'un personnage — GDSCharaMenuResource.
struct GDSCharaMenuResource {
    uint32_t      chara_id   = 0;
    lives::hash32 icon_hash;       ///< CRC32 icone face (#/menu/200_icon/10_icon_chr/face/)
    lives::hash32 bust_hash;       ///< CRC32 image buste

    static constexpr std::string_view CFG_KEY = "CHARA_MENU_RESOURCE";
};

/// Ressource son d'un personnage — GDSCharaSoundResource.
struct GDSCharaSoundResource {
    uint32_t      chara_id   = 0;
    lives::hash32 voice_hash;      ///< CRC32 fichier ACB voix
    lives::hash32 se_hash;         ///< CRC32 fichier ACB effets sonores

    static constexpr std::string_view CFG_KEY = "CHARA_SOUND_RESOURCE";
};

/// Ressource uniforme menu — GDSCharaUniformMenuResource.
struct GDSCharaUniformMenuResource {
    uint32_t      chara_id     = 0;
    uint32_t      uniform_id   = 0;
    lives::hash32 texture_hash;

    static constexpr std::string_view CFG_KEY = "CHARA_UNIFORM_MENU_RESOURCE";
};

/// Configuration icone visage — GDSCharaFaceIconConfig.
/// RDBN : chara_face_icon_config (2 types, 5 fields, 2 root lists).
/// Root lists : m_CharaFaceIconSceneDataList, m_CharaFaceIconInfoList.
struct GDSCharaFaceIconConfig {
    uint32_t    chara_id_    = 0;     ///< cCharId (RDBN field)
    std::string scene_type_;           ///< sSceneType
    glm::vec2   offset_pos_{0.f, 0.f}; ///< offsetPos
    float       scale_       = 1.f;   ///< scale
    std::string scene_data_ref_;       ///< sSceneDataRef

    static constexpr std::string_view CFG_KEY = "CHARA_FACE_ICON_CONFIG";
};

} // namespace game
