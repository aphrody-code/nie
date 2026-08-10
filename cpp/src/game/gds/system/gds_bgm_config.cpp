/// @file gds_bgm_config.cpp
/// Chargement des configurations audio depuis cfg.bin (JSON).
/// GDSBgmConfig, GDSSoundQueueSheet.
/// Audio : CRI Atom Ex v2.29.4 — fichiers .acb/.awb (5403 fichiers).

#include "iecode/game/gds/system/gds_bgm_config.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <vector>

namespace game {

// ── GDSBgmConfig ───────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSBgmConfig> load_bgm_config_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSBgmConfig> result;

    const auto key = std::string(GDSBgmConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSBgmConfig bgm;
            bgm.bgm_id     = entry.value("bgm_id", 0u);
            bgm.file_hash  = lives::hash32(entry.value("file_hash", 0u));
            bgm.name_key   = entry.value("name_key", "");
            bgm.loop_start = entry.value("loop_start", 0.f);
            bgm.loop_end   = entry.value("loop_end", 0.f);
            bgm.volume     = entry.value("volume", 1.f);
            result.push_back(std::move(bgm));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_bgm_config_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_bgm_config_list: {} BGM charges", result.size());
    return result;
}

// ── GDSSoundQueueSheet ─────────────────────────────────────────────

[[nodiscard]] std::vector<GDSSoundQueueSheet> load_sound_queue_sheet_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSSoundQueueSheet> result;

    const auto key = std::string(GDSSoundQueueSheet::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSSoundQueueSheet sheet;
            sheet.sheet_id   = entry.value("sheet_id", 0u);
            sheet.acb_hash   = lives::hash32(entry.value("acb_hash", 0u));
            sheet.sheet_name = entry.value("sheet_name", "");
            sheet.cue_count  = entry.value("cue_count", 0u);
            result.push_back(std::move(sheet));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_sound_queue_sheet_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_sound_queue_sheet_list: {} sheets chargees", result.size());
    return result;
}

} // namespace game
