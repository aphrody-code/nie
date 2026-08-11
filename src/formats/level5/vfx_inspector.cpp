/// @file vfx_inspector.cpp
/// Inspecteur generique des formats VFX Level-5 (VFXO/PFXO/FXBIN/PTLB).

#include "iecode/formats/level5/vfx_inspector.h"
#include "iecode/types.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>

namespace iecode::level5 {

// ── Magics connus (little-endian) ───────────────────────────────────
static constexpr uint32_t MAGIC_VFXO = 0x4F584656; // "VFXO"
static constexpr uint32_t MAGIC_PFXO = 0x4F584650; // "PFXO"
static constexpr uint32_t MAGIC_FXBN = 0x4E425846; // "FXBN"
static constexpr uint32_t MAGIC_PTLB = 0x424C5450; // "PTLB"

// ── Helpers ─────────────────────────────────────────────────────────

static std::string make_hex_header(std::span<const uint8_t> data) {
    const size_t n = std::min(data.size(), size_t{32});
    std::string out;
    out.reserve(n * 3);
    for (size_t i = 0; i < n; ++i) {
        if (i > 0) out += ' ';
        out += fmt::format("{:02X}", data[i]);
    }
    return out;
}

// ── vfx_inspect ────────────────────────────────────────────────────

VfxInspectResult vfx_inspect(std::span<const uint8_t> data, std::string_view filename) {
    VfxInspectResult r;
    r.file_size  = data.size();
    r.hex_header = make_hex_header(data);

    if (data.size() < 4) {
        r.format_name = "unknown";
        spdlog::debug("vfx_inspect: '{}' trop court ({} octets)", filename, data.size());
        return r;
    }

    r.magic = read_u32_le(data, 0);

    switch (r.magic) {
        case MAGIC_VFXO: r.format_type = VfxFormatType::Vfxo; r.format_name = "VFXO"; break;
        case MAGIC_PFXO: r.format_type = VfxFormatType::Pfxo; r.format_name = "PFXO"; break;
        case MAGIC_FXBN: r.format_type = VfxFormatType::Fxbin; r.format_name = "FXBIN"; break;
        case MAGIC_PTLB: r.format_type = VfxFormatType::Ptlb; r.format_name = "PTLB"; break;
        default:
            r.format_name = "unknown";
            spdlog::debug("vfx_inspect: '{}' magic inconnu {:#010x}", filename, r.magic);
            return r;
    }

    r.has_known_magic = true;

    if (data.size() >= 8)  r.version    = read_u32_le(data, 4);
    if (data.size() >= 12) r.item_count = read_u32_le(data, 8);

    spdlog::debug("vfx_inspect: '{}' → {} version={} count={}",
                  filename, r.format_name, r.version, r.item_count);
    return r;
}

// ── vfx_inspect_json ───────────────────────────────────────────────

std::string vfx_inspect_json(const VfxInspectResult& r) {
    nlohmann::json j;
    j["ok"]             = true;
    j["format"]         = r.format_name;
    j["magic"]          = fmt::format("{:#010x}", r.magic);
    j["has_known_magic"] = r.has_known_magic;
    j["version"]        = r.version;
    j["item_count"]     = r.item_count;
    j["file_size"]      = r.file_size;
    j["hex_header"]     = r.hex_header;
    return j.dump();
}

} // namespace iecode::level5
