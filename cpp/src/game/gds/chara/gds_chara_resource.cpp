/// @file gds_chara_resource.cpp
/// Chargement des ressources menu/son/uniforme des personnages depuis cfg.bin (JSON).
/// GDSCharaMenuResource, GDSCharaSoundResource, GDSCharaUniformMenuResource,
/// GDSCharaFaceIconConfig.

#include "iecode/game/gds/chara/gds_chara_resource.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <vector>

namespace game {

// ── GDSCharaMenuResource ───────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaMenuResource> load_chara_menu_resource_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaMenuResource> result;

    const auto key = std::string(GDSCharaMenuResource::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaMenuResource res;
            res.chara_id  = entry.value("chara_id", 0u);
            res.icon_hash = lives::hash32(entry.value("icon_hash", 0u));
            res.bust_hash = lives::hash32(entry.value("bust_hash", 0u));
            result.push_back(res);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_menu_resource_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_menu_resource_list: {} ressources chargees", result.size());
    return result;
}

// ── GDSCharaSoundResource ──────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaSoundResource> load_chara_sound_resource_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaSoundResource> result;

    const auto key = std::string(GDSCharaSoundResource::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaSoundResource res;
            res.chara_id   = entry.value("chara_id", 0u);
            res.voice_hash = lives::hash32(entry.value("voice_hash", 0u));
            res.se_hash    = lives::hash32(entry.value("se_hash", 0u));
            result.push_back(res);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_sound_resource_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_sound_resource_list: {} sons charges", result.size());
    return result;
}

// ── GDSCharaUniformMenuResource ────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaUniformMenuResource> load_chara_uniform_menu_resource_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaUniformMenuResource> result;

    const auto key = std::string(GDSCharaUniformMenuResource::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaUniformMenuResource res;
            res.chara_id     = entry.value("chara_id", 0u);
            res.uniform_id   = entry.value("uniform_id", 0u);
            res.texture_hash = lives::hash32(entry.value("texture_hash", 0u));
            result.push_back(res);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_uniform_menu_resource_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_uniform_menu_resource_list: {} uniformes charges", result.size());
    return result;
}

// ── GDSCharaFaceIconConfig ─────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaFaceIconConfig> load_chara_face_icon_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaFaceIconConfig> result;

    const auto key = std::string(GDSCharaFaceIconConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaFaceIconConfig icon;
            icon.chara_id_       = entry.value("cCharId", 0u);
            icon.scene_type_     = entry.value("sSceneType", "");
            icon.offset_pos_.x   = entry.value("offsetPosX", 0.f);
            icon.offset_pos_.y   = entry.value("offsetPosY", 0.f);
            icon.scale_          = entry.value("scale", 1.f);
            icon.scene_data_ref_ = entry.value("sSceneDataRef", "");
            result.push_back(std::move(icon));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_face_icon_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_face_icon_list: {} icones chargees", result.size());
    return result;
}

} // namespace game
