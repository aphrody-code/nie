/// @file gds_skill_config.cpp
/// Chargement des configurations de competences (hissatsu, passives, aura).

#include "iecode/game/gds/skill/gds_skill_config.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <optional>
#include <string>
#include <vector>

namespace game {

// ── GDSSkillConfig ──────────────────────────────────────────────────

[[nodiscard]] static std::optional<GDSSkillConfig> parse_skill(const nlohmann::json& entry) {
    try {
        GDSSkillConfig skill;
        skill.skill_id  = entry.value("skill_id", 0u);
        skill.name_hash = lives::hash32(entry.value("name_hash", 0u));
        skill.name_key  = entry.value("name_key", "");
        skill.desc_key  = entry.value("desc_key", "");
        skill.type      = static_cast<SkillType>(entry.value("type", 0));
        skill.tp_cost   = static_cast<uint8_t>(entry.value("tp_cost", 0));
        skill.element   = static_cast<Element>(entry.value("element", 0));
        skill.power     = static_cast<uint8_t>(entry.value("power", 0));
        skill.is_unlock = entry.value("is_unlock", false);
        return skill;
    } catch (const nlohmann::json::exception& e) {
        spdlog::error("parse_skill: erreur JSON — {}", e.what());
        return std::nullopt;
    }
}

[[nodiscard]] std::vector<GDSSkillConfig> load_skill_config_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSSkillConfig> result;

    const auto key = std::string(GDSSkillConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        spdlog::debug("load_skill_config_list: cle '{}' absente ou invalide", key);
        return result;
    }

    const auto& entries = cfg_data[key];
    result.reserve(entries.size());

    for (const auto& entry : entries) {
        if (auto skill = parse_skill(entry)) {
            result.push_back(std::move(*skill));
        }
    }

    spdlog::info("load_skill_config_list: {} competences chargees", result.size());
    return result;
}

// ── GDSAbilityLearningConfig ────────────────────────────────────────

[[nodiscard]] std::vector<GDSAbilityLearningConfig> load_ability_learning_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSAbilityLearningConfig> result;

    const auto key = std::string(GDSAbilityLearningConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSAbilityLearningConfig learn;
            learn.chara_id    = entry.value("chara_id", 0u);
            learn.skill_id    = entry.value("skill_id", 0u);
            learn.learn_level = static_cast<uint8_t>(entry.value("learn_level", 1));
            result.push_back(learn);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_ability_learning_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_ability_learning_list: {} apprentissages charges", result.size());
    return result;
}

// ── GDSSkillInfoReplaceConfig ───────────────────────────────────────

[[nodiscard]] std::vector<GDSSkillInfoReplaceConfig> load_skill_info_replace_list(
    const nlohmann::json& cfg_data)
{
    std::vector<GDSSkillInfoReplaceConfig> result;

    const auto key = std::string(GDSSkillInfoReplaceConfig::CFG_KEY);
    if (!cfg_data.contains(key) || !cfg_data[key].is_array()) {
        return result;
    }

    for (const auto& entry : cfg_data[key]) {
        try {
            GDSSkillInfoReplaceConfig repl;
            repl.from_skill_id = entry.value("from_skill_id", 0u);
            repl.to_skill_id   = entry.value("to_skill_id", 0u);
            result.push_back(repl);
        } catch (const nlohmann::json::exception& e) {
            spdlog::error("load_skill_info_replace_list: erreur JSON — {}", e.what());
        }
    }

    spdlog::info("load_skill_info_replace_list: {} remplacements charges", result.size());
    return result;
}

} // namespace game
