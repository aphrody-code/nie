#pragma once

/// @file res_font.h
/// Ressource police bitmap (lives::CResFont).
/// nie.exe : 0x188 bytes (392). Contient les tables de glyphes et kerning.
///
/// Format : FNT00/FNT01 binaire Level-5.
/// Glyphe : 12 octets (char_code:i32, atlas_u:u16, atlas_v:u16, w:u8, h:u8, advance:u8, flags:u8).
/// Kerning : 12 octets (left:u32, right:u32, adjust:i32).
/// Lookup : recherche binaire par char_code (FUN_140530e90).
/// Pages : jusqu'a 4 pages d'atlas (stride 0x58 par page).

#include "../core/object.h"
#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace lives {

/// Entree de glyphe dans l'atlas. 12 octets, aligne sur nie.exe FUN_1405316b0.
struct FontGlyph {
    int32_t  char_code_ = 0;      ///< Code Unicode ou Shift-JIS
    uint16_t atlas_u_   = 0;      ///< Position X dans l'atlas (pixels)
    uint16_t atlas_v_   = 0;      ///< Position Y dans l'atlas (pixels)
    uint8_t  width_     = 0;      ///< Largeur du glyphe (pixels)
    uint8_t  height_    = 0;      ///< Hauteur du glyphe (pixels)
    uint8_t  advance_   = 0;      ///< Avance horizontale (pixels)
    uint8_t  flags_     = 0;      ///< Flags (present si version > 6)
};
static_assert(sizeof(FontGlyph) == 12, "FontGlyph must be 12 bytes");

/// Paire de kerning. 12 octets, aligne sur nie.exe FUN_140531630.
struct FontKerning {
    uint32_t left_char_  = 0;     ///< Code du caractere gauche
    uint32_t right_char_ = 0;     ///< Code du caractere droit
    int32_t  adjustment_ = 0;     ///< Ajustement en pixels
};
static_assert(sizeof(FontKerning) == 12, "FontKerning must be 12 bytes");

/// Page de glyphes dans l'atlas (4 pages max). nie.exe stride 0x58.
struct FontPage {
    std::vector<FontGlyph> glyphs_;     ///< Glyphes tries par char_code
    uint16_t line_height_ = 0;           ///< Hauteur de ligne pour cette page
    uint16_t atlas_width_ = 0;           ///< Largeur de l'atlas en pixels
    uint16_t atlas_height_ = 0;          ///< Hauteur de l'atlas en pixels
};

/// Ressource police bitmap (lives::CResFont). nie.exe 0x188 bytes.
/// Load : FUN_140530f30. Cleanup : FUN_140531220.
/// Glyph lookup : FUN_140530e90 (binary search par char_code).
struct CResFont : CObject {
    static constexpr uint32_t MAX_PAGES = 4;

    /// Pages de glyphes (jusqu'a 4).
    FontPage pages_[MAX_PAGES];

    /// Table de kerning (triee par left_char, right_char).
    std::vector<FontKerning> kerning_;

    /// Nom de la police (ex: "font_def", "font_ja").
    std::string name_;

    /// Dimensions de la cellule de base.
    uint16_t cell_width_  = 0;    ///< nie.exe +0xF8
    uint16_t cell_height_ = 0;    ///< nie.exe +0xFA

    /// Nombre total de glyphes.
    uint32_t total_glyph_count_ = 0;

    /// Nombre de pages utilisees.
    uint32_t page_count_ = 0;

    // ── Methodes ────────────────────────────────────────────────────

    /// Charge depuis un buffer binaire FNT. FUN_140530f30.
    bool load(std::span<const uint8_t> data);

    /// Recherche un glyphe par code caractere (binary search). FUN_140530e90.
    /// @return Pointeur vers le glyphe, ou nullptr si non trouve.
    [[nodiscard]] const FontGlyph* find_glyph(int32_t char_code, uint32_t page = 0) const;

    /// Recherche l'ajustement de kerning entre deux caracteres.
    /// @return Ajustement en pixels (0 si pas de paire).
    [[nodiscard]] int32_t find_kerning(uint32_t left, uint32_t right) const;

    /// Libere les ressources. FUN_140531220.
    void cleanup();

    [[nodiscard]] std::string_view get_class_name() const override { return "CResFont"; }
};

} // namespace lives
