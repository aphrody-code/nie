#pragma once

/// @file fnt_parser.h
/// Parser de polices bitmap FNT Level-5 (FNT00 / FNT01).
/// Formats utilises dans les jeux Level-5 pour les polices de caracteres
/// bitmap avec atlas de glyphes.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Informations d'un glyphe dans une font Level-5.
struct FntGlyph {
    uint16_t char_code = 0;     ///< Code du caractere (Unicode ou Shift-JIS)
    uint8_t  x = 0;             ///< Position X dans la texture atlas
    uint8_t  y = 0;             ///< Position Y dans la texture atlas
    uint8_t  width = 0;         ///< Largeur du glyphe
    uint8_t  height = 0;        ///< Hauteur du glyphe
    int8_t   offset_x = 0;      ///< Decalage X pour le rendu
    int8_t   offset_y = 0;      ///< Decalage Y pour le rendu
    uint8_t  advance = 0;       ///< Avance horizontale apres ce glyphe
};

/// En-tete d'un fichier FNT Level-5.
struct FntHeader {
    uint32_t magic = 0;         ///< "FNT0" ou "FNT1"
    uint32_t version = 0;       ///< 0 = FNT00, 1 = FNT01
    uint32_t glyph_count = 0;
    uint32_t texture_width = 0;
    uint32_t texture_height = 0;
    uint16_t line_height = 0;
    uint16_t base_height = 0;
};

/// Fichier FNT parse.
struct FntFile {
    FntHeader              header;
    std::vector<FntGlyph>  glyphs;
    std::vector<uint8_t>   texture_data;   ///< Donnees brutes de la texture atlas
};

/// Parse un fichier FNT Level-5 (FNT00 ou FNT01).
[[nodiscard]] std::optional<FntFile> fnt_parse(std::span<const uint8_t> data);

/// Detecte si les donnees sont un fichier FNT valide.
[[nodiscard]] bool fnt_is_valid(std::span<const uint8_t> data);

/// Retourne la version du format ("FNT00" ou "FNT01").
[[nodiscard]] std::string fnt_version_string(const FntHeader& header);

/// Cherche un glyphe par code de caractere.
[[nodiscard]] const FntGlyph* fnt_find_glyph(const FntFile& font, uint16_t char_code);

} // namespace iecode::level5
