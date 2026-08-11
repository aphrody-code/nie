/// @file res_font.cpp
/// Ressource police bitmap (lives::CResFont).
/// Reference nie.exe : FUN_140530f30 (load), FUN_140530e90 (glyph lookup),
///                     FUN_140531220 (cleanup), FUN_140531630 (kerning).

#include "iecode/engine/res/res_font.h"

#include "iecode/formats/level5/fnt_parser.h"

#include <algorithm>
#include <cstring>

namespace lives {

bool CResFont::load(std::span<const uint8_t> data) {
    cleanup();

    auto parsed = iecode::level5::fnt_parse(data);
    if (!parsed.has_value()) {
        return false;
    }
    const auto& fnt = *parsed;

    // La premiere page porte toutes les glyphes et les metriques de l'atlas.
    auto& page0        = pages_[0];
    page0.line_height_ = fnt.header.line_height;
    page0.atlas_width_ = static_cast<uint16_t>(fnt.header.texture_width);
    page0.atlas_height_ = static_cast<uint16_t>(fnt.header.texture_height);
    page0.glyphs_.reserve(fnt.glyphs.size());

    for (const auto& g : fnt.glyphs) {
        FontGlyph out{};
        out.char_code_ = static_cast<int32_t>(g.char_code);
        out.atlas_u_   = g.x;
        out.atlas_v_   = g.y;
        out.width_     = g.width;
        out.height_    = g.height;
        out.advance_   = g.advance;
        out.flags_     = 0;
        page0.glyphs_.push_back(out);
    }

    // Glyphes tries par char_code (indispensable pour la binary search).
    std::sort(page0.glyphs_.begin(), page0.glyphs_.end(),
              [](const FontGlyph& a, const FontGlyph& b) { return a.char_code_ < b.char_code_; });

    page_count_        = 1;
    total_glyph_count_ = static_cast<uint32_t>(page0.glyphs_.size());
    cell_width_        = static_cast<uint16_t>(fnt.header.base_height);
    cell_height_       = static_cast<uint16_t>(fnt.header.line_height);
    return true;
}

const FontGlyph* CResFont::find_glyph(int32_t char_code, uint32_t page) const {
    if (page >= MAX_PAGES) return nullptr;
    const auto& glyphs = pages_[page].glyphs_;
    // Binary search — les glyphes sont tries par char_code (voir load()).
    auto it = std::lower_bound(glyphs.begin(), glyphs.end(), char_code,
                               [](const FontGlyph& g, int32_t c) { return g.char_code_ < c; });
    if (it == glyphs.end() || it->char_code_ != char_code) return nullptr;
    return &(*it);
}

int32_t CResFont::find_kerning(uint32_t left, uint32_t right) const {
    // Binary search sur (left, right). La table est triee lexicographiquement.
    auto it = std::lower_bound(kerning_.begin(), kerning_.end(), std::pair{left, right},
                               [](const FontKerning& k, std::pair<uint32_t, uint32_t> v) {
                                   if (k.left_char_ != v.first) return k.left_char_ < v.first;
                                   return k.right_char_ < v.second;
                               });
    if (it == kerning_.end() || it->left_char_ != left || it->right_char_ != right) {
        return 0;
    }
    return it->adjustment_;
}

void CResFont::cleanup() {
    for (auto& page : pages_) {
        page.glyphs_.clear();
        page.line_height_  = 0;
        page.atlas_width_  = 0;
        page.atlas_height_ = 0;
    }
    kerning_.clear();
    name_.clear();
    cell_width_        = 0;
    cell_height_       = 0;
    total_glyph_count_ = 0;
    page_count_        = 0;
}

} // namespace lives
