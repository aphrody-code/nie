#pragma once

/// @file g4tx.h
/// Parser de textures G4TX (Level-5, little-endian sur PC).

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Format de pixels d'une texture G4TX.
enum class G4txFormat : uint32_t {
    BC1     = 0x01,
    BC2     = 0x02,
    BC3     = 0x03,
    BC4     = 0x04,
    BC5     = 0x05,
    BC6H    = 0x06,
    BC7     = 0x07,
    RGBA8   = 0x1F,
    Unknown = 0xFF,
};

/// Sous-texture (region dans un atlas).
struct G4txSubTexture {
    int16_t entry_id = 0;   // Index de la texture parente
    int16_t unk1 = 0;
    int16_t x = 0;          // Position X dans l'atlas
    int16_t y = 0;          // Position Y
    int16_t width = 0;      // Largeur de la region
    int16_t height = 0;     // Hauteur de la region
    int32_t unk2 = 0;
    int32_t unk3 = 0;
    int32_t unk4 = 0;
};

/// Texture individuelle dans un fichier G4TX.
struct G4txTexture {
    uint8_t id = 0;
    std::string name;
    uint16_t width = 0;
    uint16_t height = 0;
    G4txFormat format = G4txFormat::Unknown;
    uint8_t mip_count = 1;
    bool is_dds = false;                          // Chunk contient un header DDS au lieu de NXTCH
    std::vector<uint8_t> data;                    // Donnees texture brutes (BCn ou RGBA8)
    std::vector<G4txSubTexture> sub_textures;     // Regions atlas associees
};

/// Fichier G4TX complet (peut contenir plusieurs textures).
struct G4txFile {
    uint32_t version = 0;
    std::vector<G4txTexture> textures;
};

/// Parse un fichier G4TX depuis un span brut.
[[nodiscard]] std::optional<G4txFile> g4tx_parse(std::span<const uint8_t> data);

} // namespace iecode::level5
