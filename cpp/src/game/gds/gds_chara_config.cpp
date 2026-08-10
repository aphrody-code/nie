/// @file gds_chara_config.cpp
/// Chargement des configurations de personnages depuis les donnees cfg.bin (JSON).
/// Les GDS*Config sont des donnees statiques read-only chargees au demarrage.

#include "iecode/game/gds/chara/gds_chara_base.h"
#include "iecode/game/gds/chara/gds_chara_config.h"
#include "iecode/game/gds/chara/gds_chara_model.h"
#include "iecode/game/gds/chara/gds_chara_motion.h"
#include "iecode/game/gds/chara/gds_chara_resource.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <optional>
#include <string>
#include <vector>

namespace game {

// ── GDSCharaBase ────────────────────────────────────────────────────

[[nodiscard]] static std::optional<GDSCharaBase> parse_chara_base(const nlohmann::json& entry) {
    try {
        GDSCharaBase base;
        base.chara_id    = entry.value("chara_id", 0u);
        base.name_hash   = lives::hash32(entry.value("name_hash", 0u));
        base.name_key    = entry.value("name_key", "");

        // Mapping JSON int -> enum Element (ordre cfg.bin du jeu).
        // Le jeu encode : 0=Fire, 1=Wind, 2=Wood, 3=Earth, 4=None.
        constexpr Element kElementMap[] = {
            Element::Fire, Element::Wind, Element::Wood, Element::Earth, Element::None,
        };
        const auto element_idx = entry.value("element", 0);
        base.element = (element_idx >= 0 && element_idx < 5)
                           ? kElementMap[element_idx]
                           : Element::None;

        base.position    = static_cast<Position>(entry.value("position", 0));
        base.rarity      = static_cast<Rarity>(entry.value("rarity", 1));
        base.series_id   = static_cast<uint8_t>(entry.value("series_id", 0));
        base.is_playable = entry.value("is_playable", true);
        return base;
    } catch (const nlohmann::json::exception& e) {
        spdlog::error("parse_chara_base: erreur JSON — {}", e.what());
        return std::nullopt;
    }
}

[[nodiscard]] std::vector<GDSCharaBase> load_chara_base_list(const nlohmann::json& cfg_data) {
    std::vector<GDSCharaBase> result;

    const auto key = std::string(GDSCharaBase::CFG_KEY);
    if (!cfg_data.contains(key)) {
        spdlog::debug("load_chara_base_list: cle '{}' absente", key);
        return result;
    }

    const auto& entries = cfg_data[key];
    if (!entries.is_array()) {
        spdlog::warn("load_chara_base_list: '{}' n'est pas un tableau", key);
        return result;
    }

    result.reserve(entries.size());
    for (const auto& entry : entries) {
        if (auto base = parse_chara_base(entry)) {
            result.push_back(std::move(*base));
        }
    }

    spdlog::info("load_chara_base_list: {} personnages charges", result.size());
    return result;
}

// ── GDSCharaParam ───────────────────────────────────────────────────

[[nodiscard]] static std::optional<GDSCharaParam> parse_chara_param(const nlohmann::json& entry) {
    try {
        GDSCharaParam param;
        param.chara_id = entry.value("chara_id", 0u);
        param.kick     = static_cast<int16_t>(entry.value("kick", 0));
        param.guard    = static_cast<int16_t>(entry.value("guard", 0));
        param.catch_   = static_cast<int16_t>(entry.value("catch", 0));
        param.body     = static_cast<int16_t>(entry.value("body", 0));
        param.control  = static_cast<int16_t>(entry.value("control", 0));
        param.speed    = static_cast<int16_t>(entry.value("speed", 0));
        param.stamina  = static_cast<int16_t>(entry.value("stamina", 0));
        param.luck     = static_cast<int16_t>(entry.value("luck", 0));
        return param;
    } catch (const nlohmann::json::exception& e) {
        spdlog::error("parse_chara_param: erreur JSON — {}", e.what());
        return std::nullopt;
    }
}

[[nodiscard]] std::vector<GDSCharaParam> load_chara_param_list(const nlohmann::json& cfg_data) {
    std::vector<GDSCharaParam> result;

    const auto key = std::string(GDSCharaParam::CFG_KEY);
    if (!cfg_data.contains(key)) {
        return result;
    }

    const auto& entries = cfg_data[key];
    if (!entries.is_array()) {
        return result;
    }

    result.reserve(entries.size());
    for (const auto& entry : entries) {
        if (auto param = parse_chara_param(entry)) {
            result.push_back(std::move(*param));
        }
    }

    spdlog::info("load_chara_param_list: {} stats personnages charges", result.size());
    return result;
}

// ── GDSCharaDetailsConfig ───────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaDetailsConfig> load_chara_details_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaDetailsConfig> result;

    const auto key = std::string(GDSCharaDetailsConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaDetailsConfig det;
            det.chara_id    = entry.value("chara_id", 0u);
            det.bio_key     = entry.value("bio_key", "");
            det.height      = static_cast<uint8_t>(entry.value("height", 0));
            det.weight      = static_cast<uint8_t>(entry.value("weight", 0));
            det.birth_month = static_cast<uint8_t>(entry.value("birth_month", 0));
            det.birth_day   = static_cast<uint8_t>(entry.value("birth_day", 0));
            result.push_back(std::move(det));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_details_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_details_list: {} details charges", result.size());
    return result;
}

// ── GDSCharaModel ───────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaModel> load_chara_model_list(const nlohmann::json& cfg_data) {
    std::vector<GDSCharaModel> result;

    const auto key = std::string(GDSCharaModel::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaModel model;
            model.chara_id  = entry.value("chara_id", 0u);
            model.mesh_hash = lives::hash32(entry.value("mesh_hash", 0u));
            model.lod_level = static_cast<uint8_t>(entry.value("lod_level", 0));
            model.model_type = static_cast<uint8_t>(entry.value("model_type", 0));
            result.push_back(model);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_model_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_model_list: {} modeles charges", result.size());
    return result;
}

// ── GDSCharaExpTableConfig ──────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaExpTableConfig> load_chara_exp_table_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaExpTableConfig> result;

    const auto key = std::string(GDSCharaExpTableConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaExpTableConfig exp;
            exp.chara_id  = entry.value("chara_id", 0u);
            exp.max_level = entry.value("max_level", 99u);

            if (entry.contains("exp_table") && entry["exp_table"].is_array()) {
                const auto& table = entry["exp_table"];
                for (size_t i = 0; i < std::min(table.size(), exp.exp_table.size()); ++i) {
                    exp.exp_table[i] = table[i].get<uint32_t>();
                }
            }

            result.push_back(std::move(exp));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_exp_table_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_exp_table_list: {} tables d'experience chargees", result.size());
    return result;
}

} // namespace game
