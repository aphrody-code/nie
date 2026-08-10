#include "iecode/formats/level5/g4bs.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>

namespace iecode::level5 {

static constexpr size_t G4BS_MIN_HEADER = 0x10;

std::optional<G4Bs> g4bs_parse(std::span<const uint8_t> data) {
    if (data.size() < G4BS_MIN_HEADER) {
        return std::nullopt;
    }
    const auto* base = data.data();
    const uint32_t magic = iecode::read_u32_le(base);
    if (magic != MAGIC_G4BS) {
        return std::nullopt;
    }

    G4Bs result;
    result.header.magic   = magic;
    result.header.field04 = iecode::read_u32_le(base + 0x04);
    result.header.field08 = iecode::read_u32_le(base + 0x08);
    result.header.field0c = iecode::read_u32_le(base + 0x0C);
    result.raw = data;

    spdlog::debug("g4bs_parse: field04={:#x} field08={:#x} field0c={:#x}",
                   result.header.field04, result.header.field08, result.header.field0c);

    return result;
}

std::optional<G4Bs> G4Bs::find_in_g4md(std::span<const uint8_t> g4md_data) {
    if (g4md_data.size() < G4BS_MIN_HEADER) {
        return std::nullopt;
    }

    // Scan lineaire du tag G4BS (aligne sur 4 octets).
    for (size_t i = 0; i + 4 <= g4md_data.size(); i += 4) {
        if (iecode::read_u32_le(g4md_data.data() + i) == MAGIC_G4BS) {
            return g4bs_parse(g4md_data.subspan(i));
        }
    }
    return std::nullopt;
}

} // namespace iecode::level5
