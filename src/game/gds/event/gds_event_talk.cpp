/// @file gds_event_talk.cpp
/// Chargement des donnees de dialogue depuis cfg.bin (JSON).
/// GDSEventBustupTalkConfig, GDSEventSubtitleConfig, GDSEventGeneralBustupTalkDataConfig.

#include "iecode/game/gds/event/gds_event_talk.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <vector>

namespace game {

// ── GDSEventBustupTalkConfig ───────────────────────────────────────

[[nodiscard]] std::vector<GDSEventBustupTalkConfig> load_event_bustup_talk_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSEventBustupTalkConfig> result;

    const auto key = std::string(GDSEventBustupTalkConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSEventBustupTalkConfig talk;
            talk.talk_id    = entry.value("talk_id", 0u);
            talk.chara_id   = entry.value("chara_id", 0u);
            talk.bust_hash  = lives::hash32(entry.value("bust_hash", 0u));
            talk.text_key   = entry.value("text_key", "");
            talk.expression = static_cast<uint8_t>(entry.value("expression", 0));
            talk.is_left    = entry.value("is_left", true);
            result.push_back(std::move(talk));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_event_bustup_talk_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_event_bustup_talk_list: {} dialogues charges", result.size());
    return result;
}

// ── GDSEventSubtitleConfig ─────────────────────────────────────────

[[nodiscard]] std::vector<GDSEventSubtitleConfig> load_event_subtitle_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSEventSubtitleConfig> result;

    const auto key = std::string(GDSEventSubtitleConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSEventSubtitleConfig sub;
            sub.subtitle_id = entry.value("subtitle_id", 0u);
            sub.text_key    = entry.value("text_key", "");
            sub.start_time  = entry.value("start_time", 0.f);
            sub.end_time    = entry.value("end_time", 0.f);
            sub.speaker_id  = entry.value("speaker_id", 0u);
            result.push_back(std::move(sub));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_event_subtitle_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_event_subtitle_list: {} sous-titres charges", result.size());
    return result;
}

// ── GDSEventGeneralBustupTalkDataConfig ────────────────────────────

[[nodiscard]] std::vector<GDSEventGeneralBustupTalkDataConfig>
load_event_general_bustup_talk_list(const nlohmann::json& cfg_data)
{
    std::vector<GDSEventGeneralBustupTalkDataConfig> result;

    const auto key = std::string(GDSEventGeneralBustupTalkDataConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSEventGeneralBustupTalkDataConfig data;
            data.data_id    = entry.value("data_id", 0u);
            data.chara_id   = entry.value("chara_id", 0u);
            data.text_key   = entry.value("text_key", "");
            data.expression = static_cast<uint8_t>(entry.value("expression", 0));
            data.voice_id   = static_cast<uint8_t>(entry.value("voice_id", 0));
            result.push_back(std::move(data));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_event_general_bustup_talk_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_event_general_bustup_talk_list: {} donnees chargees", result.size());
    return result;
}

} // namespace game
