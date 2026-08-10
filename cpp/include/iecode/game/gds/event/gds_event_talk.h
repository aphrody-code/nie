#pragma once

/// @file gds_event_talk.h
/// Systeme de dialogue — bustup talk, sous-titres, donnees de conversation.
/// Source : fichiers cfg.bin (EVENT_BUSTUP_TALK_CONFIG, EVENT_SUBTITLE_CONFIG, etc.).

#include "../gds_types.h"
#include <string>
#include <cstdint>

namespace game {

/// Configuration bustup talk — GDSEventBustupTalkConfig.
/// Affiche un personnage en buste avec du texte de dialogue.
struct GDSEventBustupTalkConfig {
    uint32_t      talk_id    = 0;
    uint32_t      chara_id   = 0;
    lives::hash32 bust_hash;        ///< CRC32 de l'image buste
    std::string   text_key;         ///< Cle de localisation du texte
    uint8_t       expression = 0;   ///< ID expression faciale
    bool          is_left    = true; ///< Position (gauche/droite)

    static constexpr std::string_view CFG_KEY = "EVENT_BUSTUP_TALK_CONFIG";
};

/// Configuration sous-titres — GDSEventSubtitleConfig.
struct GDSEventSubtitleConfig {
    uint32_t    subtitle_id = 0;
    std::string text_key;
    float       start_time  = 0.f;  ///< Temps de debut en secondes
    float       end_time    = 0.f;  ///< Temps de fin en secondes
    uint32_t    speaker_id  = 0;

    static constexpr std::string_view CFG_KEY = "EVENT_SUBTITLE_CONFIG";
};

/// Donnees de conversation bustup generique — GDSEventGeneralBustupTalkDataConfig.
struct GDSEventGeneralBustupTalkDataConfig {
    uint32_t    data_id     = 0;
    uint32_t    chara_id    = 0;
    std::string text_key;
    uint8_t     expression  = 0;
    uint8_t     voice_id    = 0;

    static constexpr std::string_view CFG_KEY = "EVENT_GENERAL_BUSTUP_TALK_DATA_CONFIG";
};

} // namespace game
