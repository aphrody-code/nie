#pragma once

/// @file p3lip_parser.h
/// Parser de fichiers P3LIP (P3 Lip-sync — Level-5).
/// Donnees phoneme/viseme pour l'animation faciale.
/// Format speculatif : magic non confirme, structure inferee.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Un phoneme/viseme dans le timeline lip-sync.
struct P3lipPhoneme {
    uint16_t phoneme_id  = 0; ///< Index dans la table de phonemes
    uint16_t weight      = 0; ///< Intensite 0-1000
    uint32_t frame_start = 0;
    uint32_t frame_end   = 0;
};

/// Fichier P3LIP complet.
struct P3lipFile {
    uint32_t                   version        = 0;
    float                      fps            = 30.0f;
    uint32_t                   duration_frames = 0;
    std::vector<P3lipPhoneme>  phonemes;
    bool                       is_speculative = false;
};

/// Parse un fichier P3LIP depuis un span brut.
[[nodiscard]] std::optional<P3lipFile> p3lip_parse(std::span<const uint8_t> data);

/// Exporte un fichier P3LIP en JSON.
[[nodiscard]] std::string p3lip_to_json(const P3lipFile& file);

} // namespace iecode::level5
