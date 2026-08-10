#pragma once

/// @file passive_skills.h
/// Donnees des competences passives (GDSPassiveSkillConfig).

#include <cstdint>
#include <vector>
#include "iecode/formats/level5/cfgbin.h"

namespace iecode::game {

/// Information sur une competence passive.
struct PassiveSkillInfo {
    uint32_t skill_hash = 0;
    uint32_t name_hash = 0;
    int32_t build_type = 0;
};

/// Charge la liste des competences passives depuis un cfg.bin parse.
[[nodiscard]] std::vector<PassiveSkillInfo> load_passive_skills(const level5::CfgBin& cfg);

} // namespace iecode::game
