/// @file passive_skills.cpp
/// Chargement des competences passives (GDSPassiveSkillConfig) depuis cfg.bin.
/// Equivalent nie.exe : GDSPassiveSkillConfig::LoadFromCfgBin — parcourt
/// l'arbre T2B a la recherche d'entrees "GDSPassiveSkillConfig" et extrait
/// les champs skill_hash, name_hash et build_type.

#include "iecode/game/passive_skills.h"

#include <spdlog/spdlog.h>

#include <variant>

namespace iecode::game {

namespace {

/// Lit un champ int par nom (ou hash) dans une entry T2B.
[[nodiscard]] int32_t read_int(const level5::CfgEntry& entry,
                               std::string_view name,
                               int32_t fallback = 0) noexcept {
    for (const auto& var : entry.variables) {
        if (var.name == name) {
            if (const auto* v = std::get_if<int32_t>(&var.value)) {
                return *v;
            }
        }
    }
    return fallback;
}

/// Parcours recursif de l'arbre cfg.bin — accumule une entree PassiveSkillInfo
/// pour chaque noeud dont le nom correspond a GDSPassiveSkillConfig.
void collect_recursive(const level5::CfgEntry& entry,
                       std::vector<PassiveSkillInfo>& out) {
    // Match exact ou match du nom de base (sans suffixe numerique).
    const bool is_passive =
        entry.name == "GDSPassiveSkillConfig" ||
        entry.name.rfind("GDSPassiveSkillConfig", 0) == 0;

    if (is_passive) {
        PassiveSkillInfo info{};
        info.skill_hash = static_cast<uint32_t>(read_int(entry, "skill_hash"));
        info.name_hash  = static_cast<uint32_t>(read_int(entry, "name_hash"));
        info.build_type = read_int(entry, "build_type");

        // Les anciens dumps Level-5 utilisent parfois "hash"/"name" au lieu
        // de skill_hash/name_hash — fallback silencieux.
        if (info.skill_hash == 0) {
            info.skill_hash = static_cast<uint32_t>(read_int(entry, "hash"));
        }
        if (info.name_hash == 0) {
            info.name_hash = static_cast<uint32_t>(read_int(entry, "name"));
        }

        out.push_back(info);
    }

    for (const auto& child : entry.children) {
        collect_recursive(child, out);
    }
}

} // namespace

std::vector<PassiveSkillInfo> load_passive_skills(const level5::CfgBin& cfg) {
    std::vector<PassiveSkillInfo> result;

    if (cfg.format != level5::CfgBinFile::Format::T2B) {
        spdlog::warn("load_passive_skills: format non supporte (attendu T2B)");
        return result;
    }

    // Reserve conservatrice — la plupart des cfg.bin contiennent moins de 512
    // competences passives (ordre de grandeur observe dans nie.exe).
    result.reserve(512);

    for (const auto& root : cfg.entries) {
        collect_recursive(root, result);
    }

    spdlog::debug("load_passive_skills: {} competences chargees", result.size());
    return result;
}

} // namespace iecode::game
