/// @file p3lip.cpp
/// Parser de fichiers P3LIP (P3 Lip-sync).

#include "iecode/formats/level5/p3lip_parser.h"
#include "iecode/types.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

namespace iecode::level5 {

// ── Constantes ─────────────────────────────────────────────────────

/// Magic "P3LP" en little-endian
static constexpr uint32_t P3LIP_MAGIC   = 0x504C3350;
/// Magic alternatif "LIP\0"
static constexpr uint32_t P3LIP_MAGIC2  = 0x0050494C;
static constexpr size_t   P3LIP_HEADER  = 20; ///< magic+version+count+fps+duration
static constexpr size_t   P3LIP_PHO_SZ  = 12; ///< phoneme_id+weight+frame_start+frame_end
static constexpr uint32_t P3LIP_MAX_PHO = 100'000;

// ── p3lip_parse ────────────────────────────────────────────────────

std::optional<P3lipFile> p3lip_parse(std::span<const uint8_t> data) {
    if (data.size() < P3LIP_HEADER) {
        spdlog::debug("p3lip: donnees trop courtes ({} < {})", data.size(), P3LIP_HEADER);
        return std::nullopt;
    }

    P3lipFile file;

    const uint32_t magic = read_u32_le(data, 0);
    if (magic != P3LIP_MAGIC && magic != P3LIP_MAGIC2) {
        spdlog::warn("p3lip: magic inconnu {:#010x}, parsing speculatif", magic);
        file.is_speculative = true;
    }

    file.version         = read_u32_le(data, 4);
    const uint32_t count = read_u32_le(data, 8);
    const float    fps   = read_f32_le(data, 12);
    file.duration_frames = read_u32_le(data, 16);

    // Valider fps
    file.fps = (fps > 0.0f && fps <= 240.0f) ? fps : 30.0f;

    if (count > P3LIP_MAX_PHO) {
        spdlog::error("p3lip: nombre de phonemes suspect ({}, max {})", count, P3LIP_MAX_PHO);
        return std::nullopt;
    }

    const size_t needed = P3LIP_HEADER + static_cast<size_t>(count) * P3LIP_PHO_SZ;
    if (needed > data.size()) {
        spdlog::error("p3lip: donnees insuffisantes ({} < {})", data.size(), needed);
        return std::nullopt;
    }

    file.phonemes.reserve(count);
    size_t off = P3LIP_HEADER;
    for (uint32_t i = 0; i < count; ++i) {
        P3lipPhoneme p;
        p.phoneme_id  = static_cast<uint16_t>(read_u16_le(data, off));
        p.weight      = static_cast<uint16_t>(read_u16_le(data, off + 2));
        p.frame_start = read_u32_le(data, off + 4);
        p.frame_end   = read_u32_le(data, off + 8);
        file.phonemes.push_back(p);
        off += P3LIP_PHO_SZ;
    }

    spdlog::debug("p3lip: {} phoneme(s), fps={:.1f}, dur={} frames, version={}",
                  count, file.fps, file.duration_frames, file.version);
    return file;
}

// ── p3lip_to_json ──────────────────────────────────────────────────

std::string p3lip_to_json(const P3lipFile& file) {
    nlohmann::json j;
    j["format"]          = "P3LIP";
    j["version"]         = file.version;
    j["fps"]             = file.fps;
    j["duration_frames"] = file.duration_frames;
    j["phoneme_count"]   = file.phonemes.size();
    j["is_speculative"]  = file.is_speculative;

    auto pho = nlohmann::json::array();
    for (const auto& p : file.phonemes) {
        pho.push_back({
            {"phoneme_id",  p.phoneme_id},
            {"weight",      p.weight},
            {"frame_start", p.frame_start},
            {"frame_end",   p.frame_end}
        });
    }
    j["phonemes"] = std::move(pho);
    return j.dump(2);
}

} // namespace iecode::level5
