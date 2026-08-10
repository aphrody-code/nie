#pragma once

/// @file gamedata/text_parser.h
/// Parser de textes localises depuis les fichiers cfg.bin.
/// Port depuis inagle/src/parsers/text-parser.ts (443 lignes).
///
/// Gere les 9 locales du jeu et les 23 types de textes.
/// Supporte les formats TEXT_INFO et NOUN_INFO.

#include "iecode/formats/level5/cfgbin.h"
#include "iecode/gamedata/types.h"

#include <filesystem>
#include <string>
#include <unordered_map>

namespace iecode::gamedata {

/// Locales supportees par le jeu.
inline constexpr const char* LOCALES[] = {
    "ja", "en", "fr", "de", "es", "it", "pt", "zh_hans", "zh_hant"
};
inline constexpr size_t LOCALE_COUNT = 9;

/// Parse un fichier texte cfg.bin (format entries) et retourne une map hash → texte.
/// @param cfg le fichier cfg.bin parse (doit etre en format T2B/entries)
/// @return map de hash_id ("0xABCD1234") → texte localise
[[nodiscard]] TextMap extract_text_map(const level5::CfgBinFile& cfg);

/// Charge un fichier texte depuis le disque et extrait la map.
/// @param path chemin vers le fichier .cfg.bin ou .cfg.bin.json
[[nodiscard]] TextMap load_text_file(const std::filesystem::path& path);

/// Charge les textes pour toutes les locales d'un type donne.
/// @param data_root racine des donnees (contient common/text/)
/// @param text_type type de texte (ex: "chara", "skill", "item")
/// @return textes multi-locales
[[nodiscard]] MultiLocaleText load_all_locales(const std::filesystem::path& data_root,
                                                const std::string& text_type);

/// Nettoie un texte brut du jeu (furigana, tags, escapes).
/// Port depuis inagle sanitizeText().
[[nodiscard]] std::string sanitize_text(const std::string& raw);

} // namespace iecode::gamedata
