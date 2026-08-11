/// @file gds_chara_motion.cpp
/// Chargement des donnees d'animation des personnages depuis cfg.bin (JSON).
/// GDSCharaMotion, GDSCharaMenuMotion, GDSCharaFacial, GDSCharaSeTrigger.

#include "iecode/game/gds/chara/gds_chara_motion.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <vector>

namespace game {

// ── GDSCharaMotion ─────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaMotion> load_chara_motion_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaMotion> result;

    const auto key = std::string(GDSCharaMotion::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaMotion motion;
            motion.chara_id  = entry.value("chara_id", 0u);
            motion.motion_id = entry.value("motion_id", 0u);
            motion.anim_hash = lives::hash32(entry.value("anim_hash", 0u));
            motion.anim_name = entry.value("anim_name", "");
            motion.speed     = entry.value("speed", 1.f);
            motion.loop      = entry.value("loop", false);
            result.push_back(std::move(motion));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_motion_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_motion_list: {} animations chargees", result.size());
    return result;
}

// ── GDSCharaMenuMotion ─────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaMenuMotion> load_chara_menu_motion_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaMenuMotion> result;

    const auto key = std::string(GDSCharaMenuMotion::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaMenuMotion mm;
            mm.chara_id  = entry.value("chara_id", 0u);
            mm.motion_id = entry.value("motion_id", 0u);
            mm.anim_name = entry.value("anim_name", "");
            result.push_back(std::move(mm));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_menu_motion_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_menu_motion_list: {} menu motions chargees", result.size());
    return result;
}

// ── GDSCharaFacial ─────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaFacial> load_chara_facial_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaFacial> result;

    const auto key = std::string(GDSCharaFacial::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaFacial facial;
            facial.chara_id    = entry.value("chara_id", 0u);
            facial.facial_id   = entry.value("facial_id", 0u);
            facial.target_name = entry.value("target_name", "");
            facial.weight      = entry.value("weight", 1.f);
            result.push_back(std::move(facial));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_facial_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_facial_list: {} facials charges", result.size());
    return result;
}

// ── GDSCharaSeTrigger ──────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaSeTrigger> load_chara_se_trigger_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaSeTrigger> result;

    const auto key = std::string(GDSCharaSeTrigger::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaSeTrigger trigger;
            trigger.chara_id     = entry.value("chara_id", 0u);
            trigger.motion_id    = entry.value("motion_id", 0u);
            trigger.trigger_time = entry.value("trigger_time", 0.f);
            trigger.se_hash      = lives::hash32(entry.value("se_hash", 0u));
            result.push_back(trigger);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_se_trigger_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_se_trigger_list: {} SE triggers charges", result.size());
    return result;
}

} // namespace game
