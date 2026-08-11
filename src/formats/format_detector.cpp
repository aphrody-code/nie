#include "iecode/formats/format_detector.h"

#include "iecode/compression/inazuma_lzss.h"
#include "iecode/formats/level5/anm_parser.h"
#include "iecode/types.h"
#include <cstring>

namespace iecode::formats {

FileFormat detect(std::span<const uint8_t> data) {
    if (data.size() < 4) return FileFormat::Unknown;

    const uint32_t magic_le = iecode::read_u32_le(data.data());
    const uint32_t magic_be = iecode::read_u32_be(data.data());

    // CRILAYLA (8 octets)
    if (data.size() >= 8 && std::memcmp(data.data(), "CRILAYLA", 8) == 0) {
        return FileFormat::CRILAYLA;
    }

    // RDBN (5 octets: "RDBNP")
    if (data.size() >= 5 && std::memcmp(data.data(), "RDBNP", 5) == 0) {
        return FileFormat::RDBN;
    }

    // CPK ("CPK " big-endian, meme convention que les autres magics texte)
    if (magic_be == MAGIC_CPK) return FileFormat::CPK;

    // @UTF
    if (magic_be == MAGIC_UTF) return FileFormat::UTF;

    // Formats Level-5 (big-endian magics)
    if (magic_be == MAGIC_G4TX) return FileFormat::G4TX;
    if (magic_be == MAGIC_G4MG) return FileFormat::G4MG;
    if (magic_be == MAGIC_G4MD) return FileFormat::G4MD;
    if (magic_be == MAGIC_G4SK) return FileFormat::G4SK;
    if (magic_be == MAGIC_G4PK) return FileFormat::G4PK;

    // G4MT (magic lu en little-endian: 0x544D3447)
    if (magic_le == MAGIC_G4MT) return FileFormat::G4MT;

    // G4RA ("G4RA`")
    if (data.size() >= 5 && std::memcmp(data.data(), "G4RA`", 5) == 0) {
        return FileFormat::G4RA;
    }

    // USM ("CRID")
    if (data.size() >= 4 && std::memcmp(data.data(), "CRID", 4) == 0) {
        return FileFormat::USM;
    }

    // InazumaLZSS ("SSZL")
    if (iecode::compression::is_inazuma_lzss(data)) {
        return FileFormat::SSZL;
    }

    // ANMx (ANMC, ANMV, ANMA, ANMN, ANMP)
    if (iecode::level5::anm_is_valid(data)) {
        return FileFormat::ANM;
    }

    return FileFormat::Unknown;
}

std::string_view format_name(FileFormat fmt) {
    switch (fmt) {
        case FileFormat::CPK:      return "CPK";
        case FileFormat::UTF:      return "UTF";
        case FileFormat::USM:      return "USM";
        case FileFormat::CRILAYLA: return "CRILAYLA";
        case FileFormat::G4TX:     return "G4TX";
        case FileFormat::G4MG:     return "G4MG";
        case FileFormat::G4MD:     return "G4MD";
        case FileFormat::G4SK:     return "G4SK";
        case FileFormat::G4MT:     return "G4MT";
        case FileFormat::G4PK:     return "G4PK";
        case FileFormat::G4RA:     return "G4RA";
        case FileFormat::RDBN:     return "RDBN";
        case FileFormat::CfgBin:   return "CfgBin";
        case FileFormat::AGI:      return "AGI";
        case FileFormat::SSZL:     return "SSZL";
        case FileFormat::ANM:      return "ANM";
        case FileFormat::Unknown:  return "Unknown";
    }
    return "Unknown";
}

} // namespace iecode::formats
