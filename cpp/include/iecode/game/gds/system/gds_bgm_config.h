#pragma once

/// @file gds_bgm_config.h
/// Configurations audio — BGM, sound queue sheets.
/// Source : fichiers cfg.bin (BGM_CONFIG, SOUND_QUEUE_SHEET).
/// Audio : CRI Atom Ex v2.29.4 — fichiers .acb/.awb (5403 fichiers).

#include "../gds_types.h"
#include <string>
#include <cstdint>

namespace game {

/// Configuration d'une musique de fond — GDSBgmConfig.
struct GDSBgmConfig {
    uint32_t      bgm_id     = 0;
    lives::hash32 file_hash;         ///< CRC32 du fichier .acb
    std::string   name_key;          ///< Cle de localisation du titre
    float         loop_start = 0.f;  ///< Point de boucle debut (secondes)
    float         loop_end   = 0.f;  ///< Point de boucle fin (secondes)
    float         volume     = 1.f;

    static constexpr std::string_view CFG_KEY = "BGM_CONFIG";
};

/// Feuille de queue sonore — GDSSoundQueueSheet.
struct GDSSoundQueueSheet {
    uint32_t      sheet_id   = 0;
    lives::hash32 acb_hash;          ///< CRC32 du fichier .acb
    std::string   sheet_name;
    uint32_t      cue_count  = 0;

    static constexpr std::string_view CFG_KEY = "SOUND_QUEUE_SHEET";
};

} // namespace game
