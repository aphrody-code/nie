#pragma once

/// @file map_block_list.h
/// Parser texte d'une liste de blocs de carte (format cfg map).
/// Syntaxe :
///   BLOCK_LIST_BEG 11;
///       BLOCK   CRC("bk01_w10i000"),0,21;
///       BLOCK   CRC("bk00_w10i024"),0,1;
///   BLOCK_LIST_END;

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace iecode::level5 {

/// Entree BLOCK d'une liste.
struct MapBlock {
    std::string crc_name;  ///< Nom passe a CRC(...) — ex. "bk01_w10i000"
    int32_t unk0 = 0;
    int32_t unk1 = 0;
};

/// Bloc BLOCK_LIST_BEG .. BLOCK_LIST_END parse.
struct MapBlockList {
    int32_t declared_count = 0;
    std::vector<MapBlock> blocks;

    /// Parse le premier BLOCK_LIST trouve dans le texte.
    [[nodiscard]] static std::optional<MapBlockList> parse(std::string_view text);
};

} // namespace iecode::level5
