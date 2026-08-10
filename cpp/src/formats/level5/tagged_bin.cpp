#include "iecode/formats/level5/tagged_bin.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>

namespace iecode::level5 {

std::optional<TaggedBin> tagged_bin_parse(
    std::span<const uint8_t> data, uint32_t expected_hash) {

    if (data.size() < TAGGED_BIN_HEADER_SIZE) {
        spdlog::error("tagged_bin_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), TAGGED_BIN_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    TaggedBin result;
    result.header.count     = iecode::read_u32_le(base + 0x00);
    result.header.data_size = iecode::read_u32_le(base + 0x04);
    result.header.unknown   = iecode::read_u32_le(base + 0x08);
    result.header.version   = iecode::read_u32_le(base + 0x0C);
    result.header.type_hash = iecode::read_u32_le(base + 0x10);
    result.header.flags     = iecode::read_u16_le(base + 0x14);
    result.header.padding   = iecode::read_u16_le(base + 0x16);

    if (expected_hash != 0 && result.header.type_hash != expected_hash) {
        spdlog::error("tagged_bin_parse: type_hash invalide ({:#010x}, attendu {:#010x})",
                      result.header.type_hash, expected_hash);
        return std::nullopt;
    }

    // Payload : tout ce qui suit le header, borne par data_size si coherent.
    const size_t payload_max = data.size() - TAGGED_BIN_HEADER_SIZE;
    size_t payload_size = payload_max;
    if (result.header.data_size > 0 && result.header.data_size <= payload_max) {
        payload_size = result.header.data_size;
    }

    result.raw_entries = data.subspan(TAGGED_BIN_HEADER_SIZE, payload_size);

    spdlog::debug("tagged_bin_parse: hash={:#010x} count={} data_size={} version={:#x}",
                   result.header.type_hash, result.header.count,
                   result.header.data_size, result.header.version);

    return result;
}

} // namespace iecode::level5
