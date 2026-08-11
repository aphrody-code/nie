/// @file gds_chara_base.cpp
/// Chargement des donnees de base des personnages depuis cfg.bin (JSON).
/// GDSCharaBase, GDSCharaAddDesc, GDSCharaExpression.

#include "iecode/game/gds/chara/gds_chara_base.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <vector>

namespace game {

// ── GDSCharaAddDesc ────────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaAddDesc> load_chara_add_desc_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaAddDesc> result;

    const auto key = std::string(GDSCharaAddDesc::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaAddDesc desc;
            desc.chara_id = entry.value("chara_id", 0u);
            desc.desc_key = entry.value("desc_key", "");
            result.push_back(std::move(desc));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_add_desc_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_add_desc_list: {} descriptions chargees", result.size());
    return result;
}

// ── GDSCharaExpression ─────────────────────────────────────────────

[[nodiscard]] std::vector<GDSCharaExpression> load_chara_expression_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSCharaExpression> result;

    const auto key = std::string(GDSCharaExpression::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSCharaExpression expr;
            expr.chara_id      = entry.value("chara_id", 0u);
            expr.expression_id = entry.value("expression_id", 0u);
            expr.anim_name     = entry.value("anim_name", "");
            result.push_back(std::move(expr));
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_chara_expression_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_chara_expression_list: {} expressions chargees", result.size());
    return result;
}

} // namespace game
