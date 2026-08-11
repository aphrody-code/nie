#pragma once

/// @file gds_chara_config.h
/// Configurations detaillees des personnages — edition, proprietes par defaut, series.
/// Source : fichiers cfg.bin (CHARA_DETAILS_CONFIG, CHARA_EDIT_CONFIG, etc.).

#include "../gds_types.h"
#include <string>
#include <vector>

namespace game {

/// Configuration detaillee d'un personnage — GDSCharaDetailsConfig.
struct GDSCharaDetailsConfig {
    uint32_t    chara_id   = 0;
    std::string bio_key;           ///< Cle de localisation biographie
    uint8_t     height     = 0;    ///< Taille en cm
    uint8_t     weight     = 0;    ///< Poids en kg
    uint8_t     birth_month = 0;
    uint8_t     birth_day   = 0;

    static constexpr std::string_view CFG_KEY = "CHARA_DETAILS_CONFIG";
};

/// Configuration d'edition d'un personnage — GDSCharaEditConfig.
struct GDSCharaEditConfig {
    uint32_t chara_id     = 0;
    bool     can_rename   = false;
    bool     can_recolor  = false;
    bool     can_edit_parts = false;

    static constexpr std::string_view CFG_KEY = "CHARA_EDIT_CONFIG";
};

/// Type de parts editables — GDSCharaEditPartsTypeConfig.
struct GDSCharaEditPartsTypeConfig {
    uint32_t parts_type_id = 0;
    std::string type_name_key;

    static constexpr std::string_view CFG_KEY = "CHARA_EDIT_PARTS_TYPE_CONFIG";
};

/// Proprietes par defaut — GDSCharaPropDefaultConfig.
struct GDSCharaPropDefaultConfig {
    uint32_t chara_id        = 0;
    uint32_t default_costume = 0;
    uint32_t default_aura    = 0;

    static constexpr std::string_view CFG_KEY = "CHARA_PROP_DEFAULT_CONFIG";
};

/// Configuration name tag — GDSCharaNameTagConfig.
struct GDSCharaNameTagConfig {
    uint32_t    chara_id  = 0;
    std::string tag_key;

    static constexpr std::string_view CFG_KEY = "CHARA_NAME_TAG_CONFIG";
};

/// Configuration de serie — GDSCharaSeriesConfig.
struct GDSCharaSeriesConfig {
    uint32_t    series_id = 0;
    std::string series_name_key;
    uint32_t    sort_order = 0;

    static constexpr std::string_view CFG_KEY = "CHARA_SERIES_CONFIG";
};

/// Configuration de costume — GDSCharaCostumeConfig.
struct GDSCharaCostumeConfig {
    uint32_t      chara_id    = 0;
    uint32_t      costume_id  = 0;
    lives::hash32 mesh_hash;
    lives::hash32 texture_hash;

    static constexpr std::string_view CFG_KEY = "CHARA_COSTUME_CONFIG";
};

} // namespace game
