/// @file gds_soccer_config.cpp
/// Chargement des configurations de match soccer.
/// nie.exe : stride joueur 0x570, max 58 joueurs, gravite balle 2.0f.

#include "iecode/game/gds/soccer/gds_soccer_config.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <string>
#include <vector>

namespace game {

// ── GDSSoccerGameConfig ─────────────────────────────────────────────

[[nodiscard]] std::vector<GDSSoccerGameConfig> load_soccer_game_config_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSSoccerGameConfig> result;

    const auto key = std::string(GDSSoccerGameConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSSoccerGameConfig cfg;
            cfg.config_id      = entry.value("config_id", 0u);
            cfg.match_duration = entry.value("match_duration", 0u);
            cfg.overtime_sec   = entry.value("overtime_sec", 0u);
            cfg.ball_gravity   = entry.value("ball_gravity", 2.f);
            cfg.max_players    = entry.value("max_players", 58u);
            cfg.field_size     = static_cast<uint8_t>(entry.value("field_size", 0));
            result.push_back(cfg);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_soccer_game_config_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_soccer_game_config_list: {} configs match chargees", result.size());
    return result;
}

// ── GDSSoccerCharaPlacement ─────────────────────────────────────────

[[nodiscard]] std::vector<GDSSoccerCharaPlacement> load_soccer_chara_placement_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSSoccerCharaPlacement> result;

    const auto key = std::string(GDSSoccerCharaPlacement::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSSoccerCharaPlacement place;
            place.placement_id = entry.value("placement_id", 0u);
            place.chara_id     = entry.value("chara_id", 0u);
            place.formation_id = entry.value("formation_id", 0u);
            place.pos_x        = entry.value("pos_x", 0.f);
            place.pos_z        = entry.value("pos_z", 0.f);
            place.position     = static_cast<Position>(entry.value("position", 0));
            result.push_back(place);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_soccer_chara_placement_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_soccer_chara_placement_list: {} placements charges", result.size());
    return result;
}

// ── GDSSoccerUserAIConfig ───────────────────────────────────────────

[[nodiscard]] std::vector<GDSSoccerUserAIConfig> load_soccer_user_ai_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSSoccerUserAIConfig> result;

    const auto key = std::string(GDSSoccerUserAIConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSSoccerUserAIConfig ai;
            ai.ai_id           = entry.value("ai_id", 0u);
            ai.aggression      = static_cast<uint8_t>(entry.value("aggression", 50));
            ai.pass_tendency   = static_cast<uint8_t>(entry.value("pass_tendency", 50));
            ai.shoot_tendency  = static_cast<uint8_t>(entry.value("shoot_tendency", 50));
            ai.defense_line    = static_cast<uint8_t>(entry.value("defense_line", 50));
            result.push_back(ai);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_soccer_user_ai_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_soccer_user_ai_list: {} configs IA chargees", result.size());
    return result;
}

} // namespace game
