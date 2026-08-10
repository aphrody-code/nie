#pragma once

/// @file g4la.h
/// Parser generique G4LA / G4MA / G4VS (Level-5, pattern G4xx).
/// Header 104 octets identique au pattern des autres G4xx.

#include <cstdint>
#include <optional>
#include <span>
#include <utility>
#include <vector>

namespace iecode::level5 {

/// Paire (offset, size) de la section table d'un conteneur G4xx.
struct G4xxSection {
    uint16_t offset = 0;
    uint16_t size = 0;
};

/// Conteneur G4xx minimal (G4LA, G4MA, G4VS).
struct G4xxContainer {
    uint32_t magic = 0;              // Magic 4 octets (G4LA/G4MA/G4VS)
    uint16_t flags = 0;              // +0x04 — 0x0040
    uint16_t header_size = 0;        // +0x06 — 0x0068
    uint16_t section_offset = 0;     // +0x0A — 0x0010
    uint32_t data_size = 0;          // +0x0C
    std::vector<G4xxSection> sections;
    std::span<const uint8_t> raw;
};

/// Magic "G4LA" en little-endian.
inline constexpr uint32_t MAGIC_G4LA = 0x414C3447;
/// Magic "G4MA" en little-endian.
inline constexpr uint32_t MAGIC_G4MA = 0x414D3447;
/// Magic "G4VS" en little-endian.
inline constexpr uint32_t MAGIC_G4VS = 0x53563447;

/// Parse un conteneur G4xx (valide un magic explicite ou nullopt).
[[nodiscard]] std::optional<G4xxContainer> g4xx_parse(
    std::span<const uint8_t> data, uint32_t expected_magic);

/// Parse un fichier G4LA.
[[nodiscard]] inline std::optional<G4xxContainer> g4la_parse(
    std::span<const uint8_t> data) {
    return g4xx_parse(data, MAGIC_G4LA);
}

/// Parse un fichier G4MA.
[[nodiscard]] inline std::optional<G4xxContainer> g4ma_parse(
    std::span<const uint8_t> data) {
    return g4xx_parse(data, MAGIC_G4MA);
}

/// Parse un fichier G4VS.
[[nodiscard]] inline std::optional<G4xxContainer> g4vs_parse(
    std::span<const uint8_t> data) {
    return g4xx_parse(data, MAGIC_G4VS);
}

} // namespace iecode::level5
