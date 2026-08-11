#pragma once

/// @file gds_skill_config.h
/// Configurations des competences — hissatsu, passives, aura, tactiques.
/// Source : fichiers cfg.bin (SKILL_CONFIG, ABILITY_LEARNING_CONFIG, etc.).
/// nie.exe : 1218 slots passive skill, 1344 slots command effect.

#include "../gds_types.h"
#include <string>

namespace game {

/// Type de competence.
enum class SkillType : uint8_t {
    Hissatsu = 0,  ///< technique speciale
    Passive  = 1,  ///< competence passive
    Aura     = 2,  ///< competence aura
    Super    = 3,  ///< super tactique
    Special  = 4,  ///< tactique speciale
};

/// Configuration d'une competence — GDSSkillConfig.
struct GDSSkillConfig {
    uint32_t      skill_id  = 0;
    lives::hash32 name_hash;
    std::string   name_key;
    std::string   desc_key;
    SkillType     type      = SkillType::Hissatsu;
    uint8_t       tp_cost   = 0;
    Element       element   = Element::Fire;
    uint8_t       power     = 0;
    bool          is_unlock = false;

    static constexpr std::string_view CFG_KEY = "SKILL_CONFIG";
};

/// Remplacement d'infos de competence — GDSSkillInfoReplaceConfig.
struct GDSSkillInfoReplaceConfig {
    uint32_t from_skill_id = 0;
    uint32_t to_skill_id   = 0;

    static constexpr std::string_view CFG_KEY = "SKILL_INFO_REPLACE_CONFIG";
};

/// Configuration apprentissage competence — GDSAbilityLearningConfig.
struct GDSAbilityLearningConfig {
    uint32_t chara_id    = 0;
    uint32_t skill_id    = 0;
    uint8_t  learn_level = 1;

    static constexpr std::string_view CFG_KEY = "ABILITY_LEARNING_CONFIG";
};

} // namespace game
