#pragma once

/// @file gamedata/event_text.h
/// Parser de textes evenementiels depuis les fichiers cfg.bin.
/// Extrait les dialogues, sous-titres et donnees de bust-up talk
/// en utilisant des lookups JamCRC (CRC32 standard) sur les noms de sections.
///
/// Couche de haut niveau au-dessus de cfgbin.h, inspiree du parser
/// EventText de Kuriimu2.

#include "iecode/formats/level5/cfgbin.h"

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace iecode::gamedata {

/// Une entree de texte evenementiel extraite depuis cfg.bin.
struct EventTextEntry {
    uint32_t    hash = 0;          ///< CRC32/JamCRC du nom
    std::string key;               ///< Nom de la cle (si connu)
    std::string text;              ///< Texte localise
    uint32_t    speaker_id = 0;    ///< ID du personnage parlant
    uint32_t    voice_id = 0;      ///< ID de la voix (ACB cue)
    float       start_time = 0.f;  ///< Debut du texte (timing)
    float       end_time = 0.f;    ///< Fin du texte
};

/// Resultat de l'extraction de texte evenementiel.
struct EventTextResult {
    std::vector<EventTextEntry> entries;
    std::string                 source_file;
};

/// Extrait les textes evenementiels depuis un fichier cfg.bin parse.
/// Cherche les entrees avec les cles connues : EVENT_TEXT_INFO, EVENT_TEXT_INDEX,
/// EVENT_BUSTUP_TALK_DATA, EVENT_SUBTITLE_DATA, etc.
[[nodiscard]] EventTextResult event_text_extract(const level5::CfgBinFile& cfg);

/// Extrait les textes depuis un buffer cfg.bin brut.
[[nodiscard]] EventTextResult event_text_extract_raw(std::span<const uint8_t> cfg_data);

/// Cherche un texte par hash CRC32.
[[nodiscard]] std::optional<EventTextEntry> event_text_find(
    const EventTextResult& result, uint32_t hash);

/// Cherche un texte par nom de cle.
[[nodiscard]] std::optional<EventTextEntry> event_text_find(
    const EventTextResult& result, std::string_view key);

} // namespace iecode::gamedata
