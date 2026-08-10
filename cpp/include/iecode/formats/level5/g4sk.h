#pragma once

/// @file g4sk.h
/// Parser de squelettes G4SK (Level-5, Graphics 4 Skeleton).
/// Contient la hierarchie d'os et les transforms locales.

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Os individuel dans un squelette.
struct Bone {
    std::string name;
    int32_t parent_index = -1;
    float position[3] = {};    // Translation locale
    float rotation[4] = {};    // Quaternion (x, y, z, w)
    float scale[3] = {1.0f, 1.0f, 1.0f};
};

/// Fichier G4SK complet.
struct G4skFile {
    uint32_t version = 0;
    uint16_t header_size = 0;
    uint32_t file_size = 0;
    std::vector<Bone> bones;
};

/// Parse un fichier G4SK depuis un span brut.
[[nodiscard]] std::optional<G4skFile> g4sk_parse(std::span<const uint8_t> data);

} // namespace iecode::level5
