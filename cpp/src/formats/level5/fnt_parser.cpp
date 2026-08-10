#include "iecode/formats/level5/fnt_parser.h"

#include "iecode/io/binary_reader.h"

#include <cstring>
#include <spdlog/spdlog.h>

namespace iecode::level5 {

// ── Constantes internes ─────────────────────────────────────────────

/// Magic "FNT0" en little-endian (0x30544E46).
static constexpr uint32_t FNT0_MAGIC_LE = 0x30544E46u;

/// Magic "FNT1" en little-endian (0x31544E46).
static constexpr uint32_t FNT1_MAGIC_LE = 0x31544E46u;

/// Taille minimale du header FNT.
/// Layout FNT00 :
///   [0x00] u32  magic         ("FNT0")
///   [0x04] u32  file_size     (taille totale ou flags)
///   [0x08] u32  glyph_count
///   [0x0C] u16  texture_width
///   [0x0E] u16  texture_height
///   [0x10] u16  line_height
///   [0x12] u16  base_height
///   [0x14] u32  glyph_section_size  (taille des glyphes en octets)
///   = 0x18 bytes minimum
static constexpr size_t FNT_HEADER_SIZE = 0x18;

/// Taille d'un enregistrement glyphe FNT00.
/// Layout :
///   [0x00] u16  char_code
///   [0x02] u8   x
///   [0x03] u8   y
///   [0x04] u8   width
///   [0x05] u8   height
///   [0x06] i8   offset_x
///   [0x07] i8   offset_y
///   [0x08] u8   advance
///   [0x09] u8   padding (unused)
///   = 0x0A bytes (10 octets)
static constexpr size_t FNT_GLYPH_SIZE_V0 = 0x0A;

/// Taille d'un enregistrement glyphe FNT01 (etendu avec des champs supplementaires).
/// Layout :
///   [0x00] u16  char_code
///   [0x02] u16  x         (16-bit pour les larges atlas)
///   [0x04] u16  y
///   [0x06] u8   width
///   [0x07] u8   height
///   [0x08] i8   offset_x
///   [0x09] i8   offset_y
///   [0x0A] u8   advance
///   [0x0B] u8   padding
///   = 0x0C bytes (12 octets)
static constexpr size_t FNT_GLYPH_SIZE_V1 = 0x0C;

// ── Helpers de validation ───────────────────────────────────────────

/// Verifie que [offset, offset+len) est dans les bornes de data.
static bool fnt_bounds_check(size_t data_size, size_t offset, size_t len) noexcept {
    return offset + len <= data_size && offset + len >= offset; // overflow check
}

// ── Implementation principale ───────────────────────────────────────

std::optional<FntFile> fnt_parse(std::span<const uint8_t> data) {
    if (data.size() < FNT_HEADER_SIZE) {
        spdlog::error("fnt_parse: fichier trop petit ({} octets, minimum {})",
                      data.size(), FNT_HEADER_SIZE);
        return std::nullopt;
    }

    io::BinaryReader reader(data);

    // Lire et verifier le magic
    const uint32_t magic = reader.read_u32_le();
    if (magic != FNT0_MAGIC_LE && magic != FNT1_MAGIC_LE) {
        spdlog::error("fnt_parse: magic invalide 0x{:08X} (attendu FNT0=0x{:08X} ou FNT1=0x{:08X})",
                      magic, FNT0_MAGIC_LE, FNT1_MAGIC_LE);
        return std::nullopt;
    }

    const bool is_v1 = (magic == FNT1_MAGIC_LE);

    FntFile result;
    result.header.magic   = magic;
    result.header.version = is_v1 ? 1u : 0u;

    // Lire le reste du header
    const uint32_t file_size_or_flags = reader.read_u32_le(); // 0x04
    (void)file_size_or_flags; // Utilise pour la validation ou flags internes

    result.header.glyph_count     = reader.read_u32_le();     // 0x08
    result.header.texture_width   = reader.read_u16_le();     // 0x0C
    result.header.texture_height  = reader.read_u16_le();     // 0x0E
    result.header.line_height     = reader.read_u16_le();     // 0x10
    result.header.base_height     = reader.read_u16_le();     // 0x12
    const uint32_t glyph_section_size = reader.read_u32_le(); // 0x14

    // Validation des dimensions
    if (result.header.glyph_count > 0x10000) {
        spdlog::error("fnt_parse: nombre de glyphes suspect ({}, max 65536)",
                      result.header.glyph_count);
        return std::nullopt;
    }

    if (result.header.texture_width == 0 || result.header.texture_height == 0) {
        spdlog::warn("fnt_parse: dimensions de texture nulles ({}x{})",
                     result.header.texture_width, result.header.texture_height);
        // Pas forcement fatal — continuer le parsing
    }

    // Determiner la taille d'un glyphe selon la version
    const size_t glyph_entry_size = is_v1 ? FNT_GLYPH_SIZE_V1 : FNT_GLYPH_SIZE_V0;

    // Verifier que la section glyphes tient dans le fichier
    const size_t glyph_data_offset = reader.position();
    const size_t expected_glyph_bytes = static_cast<size_t>(result.header.glyph_count) * glyph_entry_size;

    // Utiliser glyph_section_size si non nul, sinon calculer depuis glyph_count
    const size_t actual_glyph_bytes = (glyph_section_size > 0)
        ? static_cast<size_t>(glyph_section_size)
        : expected_glyph_bytes;

    if (!fnt_bounds_check(data.size(), glyph_data_offset, actual_glyph_bytes)) {
        spdlog::error("fnt_parse: section glyphes depasse la fin du fichier "
                      "(offset={:#x}, taille={:#x}, fichier={:#x})",
                      glyph_data_offset, actual_glyph_bytes, data.size());
        return std::nullopt;
    }

    // Parser les glyphes
    result.glyphs.reserve(result.header.glyph_count);

    for (uint32_t i = 0; i < result.header.glyph_count; ++i) {
        if (reader.remaining() < glyph_entry_size) {
            spdlog::warn("fnt_parse: fin prematuree a l'index de glyphe {}/{}", i, result.header.glyph_count);
            break;
        }

        FntGlyph glyph;
        glyph.char_code = reader.read_u16_le();

        if (is_v1) {
            // FNT01 : positions X/Y en 16-bit pour les grands atlas
            const uint16_t gx = reader.read_u16_le();
            const uint16_t gy = reader.read_u16_le();
            // Tronquer en uint8_t si necessaire (pour compatibilite avec la struct)
            // mais stocker la pleine precision dans x/y casts
            glyph.x = static_cast<uint8_t>(gx & 0xFF);
            glyph.y = static_cast<uint8_t>(gy & 0xFF);
        } else {
            // FNT00 : positions X/Y en 8-bit
            glyph.x = reader.read_u8();
            glyph.y = reader.read_u8();
        }

        glyph.width    = reader.read_u8();
        glyph.height   = reader.read_u8();
        glyph.offset_x = static_cast<int8_t>(reader.read_u8());
        glyph.offset_y = static_cast<int8_t>(reader.read_u8());
        glyph.advance  = reader.read_u8();

        // Lire le padding restant
        if (is_v1) {
            reader.skip(1); // 1 octet de padding (total 0x0C)
        } else {
            reader.skip(1); // 1 octet de padding (total 0x0A)
        }

        result.glyphs.push_back(glyph);
    }

    // Se positionner apres la section glyphes (en cas de padding/alignement)
    reader.seek(glyph_data_offset + actual_glyph_bytes);

    // Lire les donnees de texture atlas (tout ce qui reste)
    const size_t texture_remaining = reader.remaining();

    if (texture_remaining > 0) {
        auto tex_span = reader.read_bytes(texture_remaining);
        result.texture_data.assign(tex_span.begin(), tex_span.end());
    }

    spdlog::debug("fnt_parse: {} glyphes, atlas {}x{}, version {}, "
                  "{} octets de texture",
                  result.glyphs.size(),
                  result.header.texture_width,
                  result.header.texture_height,
                  result.header.version,
                  result.texture_data.size());

    return result;
}

bool fnt_is_valid(std::span<const uint8_t> data) {
    if (data.size() < 4) return false;

    uint32_t magic = 0;
    std::memcpy(&magic, data.data(), 4);

    return magic == FNT0_MAGIC_LE || magic == FNT1_MAGIC_LE;
}

std::string fnt_version_string(const FntHeader& header) {
    return (header.version == 1) ? "FNT01" : "FNT00";
}

const FntGlyph* fnt_find_glyph(const FntFile& font, uint16_t char_code) {
    // Recherche lineaire — acceptable pour des tables de < 65536 glyphes.
    // Si la table est triee par char_code, on pourrait utiliser binary_search.
    for (const auto& glyph : font.glyphs) {
        if (glyph.char_code == char_code) {
            return &glyph;
        }
    }
    return nullptr;
}

} // namespace iecode::level5
