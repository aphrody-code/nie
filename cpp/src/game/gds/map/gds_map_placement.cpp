/// @file gds_map_placement.cpp
/// Chargement des donnees de placement d'objets sur les cartes depuis cfg.bin (JSON).
/// GDSMapPlacementConfig, GDSMapFuncPointConfig, GDSMapInterestPointConfig,
/// GDSMapNameTagConfig.

#include "iecode/game/gds/map/gds_map_placement.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <vector>

namespace game {

// ── GDSMapPlacementConfig ──────────────────────────────────────────

[[nodiscard]] std::vector<GDSMapPlacementConfig> load_map_placement_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapPlacementConfig> result;

    const auto key = std::string(GDSMapPlacementConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapPlacementConfig pl;
            pl.map_id    = entry.value("map_id", 0u);
            pl.object_id = entry.value("object_id", 0u);
            pl.mesh_hash = lives::hash32(entry.value("mesh_hash", 0u));
            pl.pos_x     = entry.value("pos_x", 0.f);
            pl.pos_y     = entry.value("pos_y", 0.f);
            pl.pos_z     = entry.value("pos_z", 0.f);
            pl.rot_x     = entry.value("rot_x", 0.f);
            pl.rot_y     = entry.value("rot_y", 0.f);
            pl.rot_z     = entry.value("rot_z", 0.f);
            pl.scale     = entry.value("scale", 1.f);
            result.push_back(pl);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_placement_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_placement_list: {} placements charges", result.size());
    return result;
}

// ── GDSMapFuncPointConfig ──────────────────────────────────────────

[[nodiscard]] std::vector<GDSMapFuncPointConfig> load_map_func_point_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapFuncPointConfig> result;

    const auto key = std::string(GDSMapFuncPointConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapFuncPointConfig fp;
            fp.map_id    = entry.value("map_id", 0u);
            fp.point_id  = entry.value("point_id", 0u);
            fp.func_type = entry.value("func_type", 0u);
            fp.pos_x     = entry.value("pos_x", 0.f);
            fp.pos_y     = entry.value("pos_y", 0.f);
            fp.pos_z     = entry.value("pos_z", 0.f);
            fp.radius    = entry.value("radius", 1.f);
            result.push_back(fp);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_func_point_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_func_point_list: {} points fonctionnels charges", result.size());
    return result;
}

// ── GDSMapInterestPointConfig ──────────────────────────────────────

[[nodiscard]] std::vector<GDSMapInterestPointConfig> load_map_interest_point_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapInterestPointConfig> result;

    const auto key = std::string(GDSMapInterestPointConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapInterestPointConfig ip;
            ip.map_id    = entry.value("map_id", 0u);
            ip.point_id  = entry.value("point_id", 0u);
            ip.label_key = entry.value("label_key", "");
            ip.pos_x     = entry.value("pos_x", 0.f);
            ip.pos_y     = entry.value("pos_y", 0.f);
            ip.pos_z     = entry.value("pos_z", 0.f);
            result.push_back(std::move(ip));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_interest_point_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_interest_point_list: {} points d'interet charges", result.size());
    return result;
}

// ── GDSMapNameTagConfig ────────────────────────────────────────────

[[nodiscard]] std::vector<GDSMapNameTagConfig> load_map_name_tag_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSMapNameTagConfig> result;

    const auto key = std::string(GDSMapNameTagConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSMapNameTagConfig tag;
            tag.map_id  = entry.value("map_id", 0u);
            tag.tag_key = entry.value("tag_key", "");
            tag.pos_x   = entry.value("pos_x", 0.f);
            tag.pos_y   = entry.value("pos_y", 0.f);
            tag.pos_z   = entry.value("pos_z", 0.f);
            result.push_back(std::move(tag));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_map_name_tag_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_map_name_tag_list: {} name tags charges", result.size());
    return result;
}

} // namespace game
