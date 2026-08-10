#include "iecode/formats/level5/g4mg.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>

namespace iecode::level5 {

/// Magic G4MG en little-endian et big-endian.
static constexpr uint32_t G4MG_MAGIC_LE = 0x474D3447; // "G4MG" lu en LE
static constexpr uint32_t G4MG_MAGIC_BE = 0x47344D47; // "G4MG" lu en BE

/// Taille minimale du header G4MG.
static constexpr size_t G4MG_HEADER_SIZE = 0x40;

std::optional<G4mgFile> g4mg_parse(std::span<const uint8_t> data) {
    // Les fichiers G4MG de production ne contiennent PAS de magic ASCII "G4MG".
    // Ce sont des buffers bruts de vertex interleaves (ex: c000101.g4mg commence
    // directement par 28 CF B7 38 — X ≈ -0.09 en float32 LE).
    // Le stride, le format et le nombre de vertex sont fournis par le G4MD associe.
    if (data.empty()) {
        spdlog::error("g4mg_parse: donnees vides");
        return std::nullopt;
    }

    G4mgFile result;
    result.header.is_big_endian = false;
    result.raw_vertex_data.assign(data.begin(), data.end());

    spdlog::info("g4mg_parse: buffer vertex brut de {} octets (stride attendu ~64 via G4MD)",
                 data.size());

    // Detection opportuniste d'un ancien header ASCII "G4MG" (peu probable
    // en production — conserve par compatibilite pour d'anciens outils).
    if (data.size() >= G4MG_HEADER_SIZE) {
        const auto* base = data.data();
        const uint32_t magic_le = iecode::read_u32_le(base);
        const uint32_t magic_be = iecode::read_u32_be(base);
        if (magic_le == G4MG_MAGIC_LE || magic_be == MAGIC_G4MG) {
            const bool is_big_endian = (magic_be == MAGIC_G4MG);
            result.header.magic = is_big_endian ? magic_be : magic_le;
            result.header.header_size = is_big_endian ? iecode::read_u16_be(base + 0x04)
                                                      : iecode::read_u16_le(base + 0x04);
            result.header.file_type   = is_big_endian ? iecode::read_u16_be(base + 0x06)
                                                      : iecode::read_u16_le(base + 0x06);
            result.header.version     = is_big_endian ? iecode::read_u32_be(base + 0x08)
                                                      : iecode::read_u32_le(base + 0x08);
            result.header.is_big_endian = is_big_endian;
            result.version = result.header.version;
            spdlog::debug("g4mg_parse: ancien header ASCII detecte (endian={})",
                          is_big_endian ? "big" : "little");
        }
    }

    return result;
}

} // namespace iecode::level5
