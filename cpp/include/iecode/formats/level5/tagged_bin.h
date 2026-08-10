#pragma once

/// @file tagged_bin.h
/// Conteneur struct-array tagge par hash (clobin / linb / ptlb).
/// Header 16+8 octets :
///   +0x00 [4] count
///   +0x04 [4] data_size
///   +0x08 [4] unknown
///   +0x0C [4] version
///   +0x10 [4] type_hash
///   +0x14 [2] flags
///   +0x16 [2] padding

#include <cstdint>
#include <optional>
#include <span>

namespace iecode::level5 {

/// Hash d'un fichier .clobin (collision object binary).
inline constexpr uint32_t TAGGED_HASH_CLOBIN = 0xB4949643;
/// Hash d'un fichier .linb.
inline constexpr uint32_t TAGGED_HASH_LINB   = 0x3AEB97EE;
/// Hash d'un fichier .ptlb (particle table binary).
inline constexpr uint32_t TAGGED_HASH_PTLB   = 0x1C89E794;

/// Header d'un conteneur tagge.
struct TaggedBinHeader {
    uint32_t count = 0;
    uint32_t data_size = 0;
    uint32_t unknown = 0;
    uint32_t version = 0;
    uint32_t type_hash = 0;
    uint16_t flags = 0;
    uint16_t padding = 0;
};

/// Conteneur tagge parse.
struct TaggedBin {
    TaggedBinHeader header;
    std::span<const uint8_t> raw_entries;  ///< Payload brut apres le header (0x18 octets)
};

/// Taille du header commun.
inline constexpr size_t TAGGED_BIN_HEADER_SIZE = 0x18;

/// Parse un conteneur tagge en verifiant optionnellement un hash attendu.
/// Passer 0 pour ne pas valider le type_hash.
[[nodiscard]] std::optional<TaggedBin> tagged_bin_parse(
    std::span<const uint8_t> data, uint32_t expected_hash = 0);

/// Parse un .clobin.
[[nodiscard]] inline std::optional<TaggedBin> clobin_parse(
    std::span<const uint8_t> data) {
    return tagged_bin_parse(data, TAGGED_HASH_CLOBIN);
}

/// Parse un .linb.
[[nodiscard]] inline std::optional<TaggedBin> linb_parse(
    std::span<const uint8_t> data) {
    return tagged_bin_parse(data, TAGGED_HASH_LINB);
}

/// Parse un .ptlb.
[[nodiscard]] inline std::optional<TaggedBin> ptlb_parse(
    std::span<const uint8_t> data) {
    return tagged_bin_parse(data, TAGGED_HASH_PTLB);
}

} // namespace iecode::level5
