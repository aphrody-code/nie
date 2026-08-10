#pragma once

/// @file g4bs.h
/// Sous-chunk BlendShape (G4BS) present dans les conteneurs G4MD.
/// Tag 'G4BS' = 0x53423447 (little-endian).

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::level5 {

/// Magic "G4BS" en little-endian.
inline constexpr uint32_t MAGIC_G4BS = 0x53423447;

/// Header G4BS (layout a determiner completement — on conserve les 16 premiers octets).
struct G4BsHeader {
    uint32_t magic = 0;
    uint32_t field04 = 0;
    uint32_t field08 = 0;
    uint32_t field0c = 0;
};

/// Sous-chunk G4BS parse.
struct G4Bs {
    G4BsHeader header;
    std::span<const uint8_t> raw;  ///< Span brut (parent doit rester vivant)

    /// Recherche un sous-chunk G4BS dans les donnees d'un G4MD.
    /// Retourne nullopt si non trouve.
    [[nodiscard]] static std::optional<G4Bs> find_in_g4md(
        std::span<const uint8_t> g4md_data);
};

/// Parse un G4BS a partir d'un span pointant sur le magic.
[[nodiscard]] std::optional<G4Bs> g4bs_parse(std::span<const uint8_t> data);

} // namespace iecode::level5
