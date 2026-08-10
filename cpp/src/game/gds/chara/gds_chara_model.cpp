/// @file gds_chara_model.cpp
/// Chargement des donnees de modele 3D des personnages depuis cfg.bin (JSON).
/// GDSCharaTexture, GDSCharaParts, GDSCharaScale, GDSCharaMeshType, GDSCharaModelChange.

#include "iecode/game/gds/chara/gds_chara_model.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <vector>

namespace game {

// ── GDSCharaTexture ────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaTexture> load_chara_texture_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaTexture> result;

    const auto key = std::string(GDSCharaTexture::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaTexture tex;
            tex.chara_id     = entry.value("chara_id", 0u);
            tex.texture_hash = lives::hash32(entry.value("texture_hash", 0u));
            tex.texture_slot = static_cast<uint8_t>(entry.value("texture_slot", 0));
            tex.texture_name = entry.value("texture_name", "");
            result.push_back(std::move(tex));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_texture_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_texture_list: {} textures chargees", result.size());
    return result;
}

// ── GDSCharaParts ──────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaParts> load_chara_parts_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaParts> result;

    const auto key = std::string(GDSCharaParts::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaParts parts;
            parts.chara_id  = entry.value("chara_id", 0u);
            parts.parts_id  = entry.value("parts_id", 0u);
            parts.slot      = static_cast<uint8_t>(entry.value("slot", 0));
            parts.mesh_hash = lives::hash32(entry.value("mesh_hash", 0u));
            result.push_back(parts);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_parts_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_parts_list: {} parts charges", result.size());
    return result;
}

// ── GDSCharaScale ──────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaScale> load_chara_scale_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaScale> result;

    const auto key = std::string(GDSCharaScale::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaScale scale;
            scale.chara_id = entry.value("chara_id", 0u);
            scale.scale_x  = entry.value("scale_x", 1.f);
            scale.scale_y  = entry.value("scale_y", 1.f);
            scale.scale_z  = entry.value("scale_z", 1.f);
            result.push_back(scale);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_scale_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_scale_list: {} scales charges", result.size());
    return result;
}

// ── GDSCharaMeshType ───────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaMeshType> load_chara_mesh_type_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaMeshType> result;

    const auto key = std::string(GDSCharaMeshType::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaMeshType mt;
            mt.chara_id  = entry.value("chara_id", 0u);
            mt.mesh_type = entry.value("mesh_type", 0u);
            result.push_back(mt);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_mesh_type_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_mesh_type_list: {} mesh types charges", result.size());
    return result;
}

// ── GDSCharaModelChange ────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaModelChange> load_chara_model_change_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaModelChange> result;

    const auto key = std::string(GDSCharaModelChange::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaModelChange mc;
            mc.chara_id      = entry.value("chara_id", 0u);
            mc.context_id    = entry.value("context_id", 0u);
            mc.alt_mesh_hash = lives::hash32(entry.value("alt_mesh_hash", 0u));
            result.push_back(mc);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_model_change_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_model_change_list: {} model changes charges", result.size());
    return result;
}

} // namespace game
