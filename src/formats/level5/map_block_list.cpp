#include "iecode/formats/level5/map_block_list.h"

#include <spdlog/spdlog.h>
#include <charconv>
#include <cctype>

namespace iecode::level5 {

namespace {

/// Avance le curseur en sautant les espaces et commentaires de ligne.
void skip_whitespace(std::string_view text, size_t& pos) {
    while (pos < text.size()) {
        const char c = text[pos];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
            ++pos;
        } else if (c == '/' && pos + 1 < text.size() && text[pos + 1] == '/') {
            while (pos < text.size() && text[pos] != '\n') ++pos;
        } else {
            break;
        }
    }
}

/// Cherche un token litteral.
size_t find_token(std::string_view text, std::string_view token, size_t from = 0) {
    return text.find(token, from);
}

/// Parse un entier decimal optionnellement signe.
bool parse_int(std::string_view text, size_t& pos, int32_t& out) {
    skip_whitespace(text, pos);
    const size_t start = pos;
    if (pos < text.size() && (text[pos] == '-' || text[pos] == '+')) ++pos;
    while (pos < text.size() && std::isdigit(static_cast<unsigned char>(text[pos]))) ++pos;
    if (pos == start) return false;
    const auto* first = text.data() + start;
    const auto* last  = text.data() + pos;
    return std::from_chars(first, last, out).ec == std::errc{};
}

} // namespace

std::optional<MapBlockList> MapBlockList::parse(std::string_view text) {
    constexpr std::string_view BEG = "BLOCK_LIST_BEG";
    constexpr std::string_view END = "BLOCK_LIST_END";

    const size_t beg_pos = find_token(text, BEG);
    if (beg_pos == std::string_view::npos) {
        return std::nullopt;
    }
    const size_t end_pos = find_token(text, END, beg_pos);
    if (end_pos == std::string_view::npos) {
        spdlog::error("MapBlockList::parse: BLOCK_LIST_END manquant");
        return std::nullopt;
    }

    MapBlockList result;
    size_t pos = beg_pos + BEG.size();

    if (!parse_int(text, pos, result.declared_count)) {
        spdlog::warn("MapBlockList::parse: count declare manquant");
    }
    // Sauter le ';'
    if (pos < text.size() && text[pos] == ';') ++pos;

    // Parser les entrees BLOCK jusqu'a BLOCK_LIST_END.
    while (pos < end_pos) {
        skip_whitespace(text, pos);
        if (pos >= end_pos) break;

        const size_t next_block = text.find("BLOCK", pos);
        if (next_block == std::string_view::npos || next_block >= end_pos) break;
        pos = next_block + 5; // skip "BLOCK"

        skip_whitespace(text, pos);

        // Attend : CRC("name"),unk0,unk1;
        const size_t crc_open = text.find("CRC", pos);
        if (crc_open == std::string_view::npos || crc_open >= end_pos) break;
        pos = crc_open + 3;
        skip_whitespace(text, pos);
        if (pos >= text.size() || text[pos] != '(') continue;
        ++pos;
        skip_whitespace(text, pos);
        if (pos >= text.size() || text[pos] != '"') continue;
        ++pos;

        const size_t name_start = pos;
        while (pos < text.size() && text[pos] != '"') ++pos;
        if (pos >= text.size()) break;

        MapBlock block;
        block.crc_name = std::string(text.substr(name_start, pos - name_start));
        ++pos; // skip '"'
        skip_whitespace(text, pos);
        if (pos >= text.size() || text[pos] != ')') continue;
        ++pos;

        // Virgule + unk0
        skip_whitespace(text, pos);
        if (pos < text.size() && text[pos] == ',') ++pos;
        parse_int(text, pos, block.unk0);

        // Virgule + unk1
        skip_whitespace(text, pos);
        if (pos < text.size() && text[pos] == ',') ++pos;
        parse_int(text, pos, block.unk1);

        // ';'
        skip_whitespace(text, pos);
        if (pos < text.size() && text[pos] == ';') ++pos;

        result.blocks.push_back(std::move(block));
    }

    spdlog::debug("MapBlockList::parse: declared={} actual={}",
                   result.declared_count, result.blocks.size());
    return result;
}

} // namespace iecode::level5
