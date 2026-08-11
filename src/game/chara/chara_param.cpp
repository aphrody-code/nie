/// @file chara_param.cpp
/// Implementation de CCharaParam — calcul de stats, equipement de competences.

#include "iecode/game/chara/chara_param.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <cmath>
#include <numeric>

namespace game {

int16_t CCharaParam::compute_stat(int16_t base, float growth_rate, uint8_t level) {
    if (level <= 1) {
        return base;
    }
    // Formule : stat_finale = base + (base * growth_rate * (level - 1)) / MAX_LEVEL
    // Equivalent a une progression lineaire modulee par le growth_rate.
    const auto bonus = static_cast<float>(base) * growth_rate *
                       static_cast<float>(level - 1) / static_cast<float>(MAX_LEVEL);
    return static_cast<int16_t>(std::clamp(
        static_cast<int32_t>(base) + static_cast<int32_t>(std::round(bonus)),
        static_cast<int32_t>(INT16_MIN),
        static_cast<int32_t>(INT16_MAX)));
}

std::optional<CCharaParam> CCharaParam::compute_stats_at_level(uint8_t target_level) const {
    if (target_level == 0 || target_level > MAX_LEVEL) {
        spdlog::warn("compute_stats_at_level: niveau invalide {} (max {})", target_level, MAX_LEVEL);
        return std::nullopt;
    }

    CCharaParam result = *this;
    result.level   = target_level;
    result.kick    = compute_stat(kick,    growth_rates.kick,    target_level);
    result.guard   = compute_stat(guard,   growth_rates.guard,   target_level);
    result.catch_  = compute_stat(catch_,  growth_rates.catch_,  target_level);
    result.body    = compute_stat(body,    growth_rates.body,    target_level);
    result.control = compute_stat(control, growth_rates.control, target_level);
    result.speed   = compute_stat(speed,   growth_rates.speed,   target_level);
    result.stamina = compute_stat(stamina, growth_rates.stamina, target_level);
    result.luck    = compute_stat(luck,    growth_rates.luck,    target_level);

    return result;
}

int32_t CCharaParam::total_stats() const {
    return static_cast<int32_t>(kick) + guard + catch_ + body +
           control + speed + stamina + luck;
}

bool CCharaParam::equip_passive_skill(uint32_t skill_id) {
    if (skill_id == 0) {
        return false;
    }

    // Verifier si deja equipee
    if (std::find(passive_skill_ids.begin(), passive_skill_ids.end(), skill_id)
        != passive_skill_ids.end()) {
        spdlog::debug("equip_passive_skill: skill {} deja equipee sur chara {}", skill_id, chara_id);
        return false;
    }

    // Trouver le premier slot libre (valeur 0)
    auto it = std::find(passive_skill_ids.begin(), passive_skill_ids.end(), 0u);
    if (it == passive_skill_ids.end()) {
        spdlog::debug("equip_passive_skill: aucun slot libre pour chara {}", chara_id);
        return false;
    }

    *it = skill_id;
    return true;
}

bool CCharaParam::unequip_passive_skill(uint32_t skill_id) {
    auto it = std::find(passive_skill_ids.begin(), passive_skill_ids.end(), skill_id);
    if (it == passive_skill_ids.end()) {
        return false;
    }
    *it = 0;
    return true;
}

bool CCharaParam::equip_active_skill(uint32_t skill_id) {
    if (skill_id == 0) {
        return false;
    }

    if (std::find(active_skill_ids.begin(), active_skill_ids.end(), skill_id)
        != active_skill_ids.end()) {
        return false;
    }

    auto it = std::find(active_skill_ids.begin(), active_skill_ids.end(), 0u);
    if (it == active_skill_ids.end()) {
        return false;
    }

    *it = skill_id;
    return true;
}

bool CCharaParam::unequip_active_skill(uint32_t skill_id) {
    auto it = std::find(active_skill_ids.begin(), active_skill_ids.end(), skill_id);
    if (it == active_skill_ids.end()) {
        return false;
    }
    *it = 0;
    return true;
}

} // namespace game
