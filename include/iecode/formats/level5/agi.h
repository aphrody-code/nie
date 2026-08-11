#pragma once

/// @file agi.h
/// Parser de fichiers AGI (Animation/Graphics Info, Level-5).
/// Reverse-engineered depuis nie.exe (FUN_14053b960).
/// Contient des donnees d'animation avec transforms et echelles.

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::level5 {

/// Transform AGI (position + dimensions a l'offset 0x50).
struct AgiTransform {
    float x = 0.0f;
    float y = 0.0f;
    float width = 0.0f;
    float height = 0.0f;
    uint8_t flags = 0;
};

/// Limites AGI (bounding box a l'offset 0x70).
struct AgiBounds {
    float left = 0.0f;
    float top = 0.0f;
    float right = 0.0f;
    float bottom = 0.0f;
    uint32_t bounds_flags = 0;
};

/// Facteurs d'echelle AGI (a l'offset 0xC0).
struct AgiScale {
    float scale_x = 1.0f;
    float scale_y = 1.0f;
    float scale_z = 1.0f;
    float factor = 0.1f;  ///< Default 0.1 (0x3DCCCCCD)
};

/// Fichier AGI complet.
struct AgiFile {
    uint32_t version = 0;
    uint32_t flags = 0;
    uint32_t data_size = 0;
    uint32_t frame_count = 0;
    float duration = 0.0f;
    uint32_t track_count = 0;
    uint32_t event_count = 0;
    bool is_big_endian = false;
    AgiTransform transform;
    AgiBounds bounds;
    AgiScale scale;
};

/// Parse un fichier AGI depuis un span brut.
[[nodiscard]] std::optional<AgiFile> agi_parse(std::span<const uint8_t> data);

} // namespace iecode::level5
