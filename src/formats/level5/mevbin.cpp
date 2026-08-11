/// @file mevbin.cpp
/// Parser de fichiers MEVBIN (Motion Event Binary).

#include "iecode/formats/level5/mevbin_parser.h"
#include "iecode/types.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

namespace iecode::level5 {

// ── Constantes ─────────────────────────────────────────────────────

/// Magic "MEVB" en little-endian
static constexpr uint32_t MEVBIN_MAGIC   = 0x4256454D;
static constexpr size_t   MEVBIN_HEADER  = 16; ///< magic+version+count+duration
static constexpr size_t   MEVBIN_EVT_SZ  = 16; ///< time+type+param1+param2
static constexpr uint32_t MEVBIN_MAX_EVT = 100'000;

// ── mevbin_parse ───────────────────────────────────────────────────

std::optional<MevbinFile> mevbin_parse(std::span<const uint8_t> data) {
    if (data.size() < MEVBIN_HEADER) {
        spdlog::debug("mevbin: donnees trop courtes ({} < {})", data.size(), MEVBIN_HEADER);
        return std::nullopt;
    }

    MevbinFile file;

    const uint32_t magic = read_u32_le(data, 0);
    if (magic != MEVBIN_MAGIC) {
        spdlog::warn("mevbin: magic inconnu {:#010x}, parsing speculatif", magic);
        file.is_speculative = true;
    }

    file.version  = read_u32_le(data, 4);
    const uint32_t event_count = read_u32_le(data, 8);
    file.duration = read_f32_le(data, 12);

    if (event_count > MEVBIN_MAX_EVT) {
        spdlog::error("mevbin: nombre d'evenements suspect ({}, max {})",
                      event_count, MEVBIN_MAX_EVT);
        return std::nullopt;
    }

    const size_t needed = MEVBIN_HEADER + static_cast<size_t>(event_count) * MEVBIN_EVT_SZ;
    if (needed > data.size()) {
        spdlog::error("mevbin: donnees insuffisantes ({} octets, besoin {})",
                      data.size(), needed);
        return std::nullopt;
    }

    file.events.reserve(event_count);
    size_t off = MEVBIN_HEADER;
    for (uint32_t i = 0; i < event_count; ++i) {
        MevbinEvent ev;
        ev.time   = read_f32_le(data, off);
        ev.type   = static_cast<MevEventType>(read_u32_le(data, off + 4));
        ev.param1 = read_u32_le(data, off + 8);
        ev.param2 = read_u32_le(data, off + 12);
        file.events.push_back(ev);
        off += MEVBIN_EVT_SZ;
    }

    spdlog::debug("mevbin: {} evenement(s), duree={:.3f}s, version={}",
                  event_count, file.duration, file.version);
    return file;
}

// ── mevbin_to_json ─────────────────────────────────────────────────

std::string mevbin_to_json(const MevbinFile& file) {
    nlohmann::json j;
    j["format"]         = "MEVBIN";
    j["version"]        = file.version;
    j["duration"]       = file.duration;
    j["event_count"]    = file.events.size();
    j["is_speculative"] = file.is_speculative;

    auto evts = nlohmann::json::array();
    for (const auto& ev : file.events) {
        nlohmann::json e;
        e["time"]   = ev.time;
        e["type"]   = static_cast<uint32_t>(ev.type);
        e["param1"] = fmt::format("{:#010x}", ev.param1);
        e["param2"] = fmt::format("{:#010x}", ev.param2);
        evts.push_back(std::move(e));
    }
    j["events"] = std::move(evts);
    return j.dump(2);
}

} // namespace iecode::level5
