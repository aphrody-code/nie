/// @file gdd_chara.cpp
/// Implementation des donnees runtime des personnages — level up, ajout d'exp.

#include "iecode/game/gdd/gdd_chara.h"

#include <spdlog/spdlog.h>

#include <algorithm>

namespace game {

// ── Fonctions utilitaires pour CGDDChara ────────────────────────────

/// Ajoute de l'experience et gere le level up.
/// @param chara  Personnage a modifier.
/// @param amount Experience a ajouter.
/// @param exp_table Table d'experience (exp requise pour chaque niveau).
/// @return Nombre de niveaux gagnes.
[[nodiscard]] uint32_t add_experience(
    CGDDChara& chara,
    uint32_t amount,
    const std::array<uint32_t, 99>& exp_table)
{
    const uint32_t old_level = chara.level;
    chara.exp += amount;

    // Level up automatique
    while (chara.level < 99) {
        const uint32_t next_level_idx = chara.level - 1;  // Index 0-based
        if (next_level_idx >= exp_table.size()) {
            break;
        }
        if (chara.exp < exp_table[next_level_idx]) {
            break;
        }
        chara.exp -= exp_table[next_level_idx];
        ++chara.level;
    }

    // Cap au niveau max
    if (chara.level >= 99) {
        chara.level = 99;
    }

    const uint32_t levels_gained = chara.level - old_level;
    if (levels_gained > 0) {
        spdlog::debug("add_experience: chara {} a gagne {} niveaux (lv{} -> lv{})",
                      chara.chara_id, levels_gained, old_level, chara.level);
    }

    return levels_gained;
}

/// Equipe une competence dans un slot donne.
/// @return true si l'equipement a reussi.
[[nodiscard]] bool equip_skill(CGDDChara& chara, uint32_t slot, uint32_t skill_id) {
    if (slot >= chara.equipped_skills.size()) {
        spdlog::warn("equip_skill: slot {} hors limites (max {})",
                     slot, chara.equipped_skills.size());
        return false;
    }

    // Verifier si la skill est deja equipee dans un autre slot
    for (uint32_t i = 0; i < chara.equipped_skills.size(); ++i) {
        if (i != slot && chara.equipped_skills[i] == skill_id) {
            spdlog::debug("equip_skill: skill {} deja equipee dans slot {}", skill_id, i);
            return false;
        }
    }

    chara.equipped_skills[slot] = skill_id;
    return true;
}

/// Retire une competence d'un slot.
void unequip_skill(CGDDChara& chara, uint32_t slot) {
    if (slot < chara.equipped_skills.size()) {
        chara.equipped_skills[slot] = 0;
    }
}

/// Verifie si un personnage possede une competence equipee.
[[nodiscard]] bool has_skill_equipped(const CGDDChara& chara, uint32_t skill_id) {
    return std::find(chara.equipped_skills.begin(), chara.equipped_skills.end(), skill_id)
           != chara.equipped_skills.end();
}

/// Cherche un personnage par ID dans la collection.
[[nodiscard]] CGDDChara* find_chara(CGDDCharaCollection& collection, uint32_t chara_id) {
    auto it = std::find_if(collection.characters.begin(), collection.characters.end(),
                           [chara_id](const CGDDChara& c) { return c.chara_id == chara_id; });
    if (it == collection.characters.end()) {
        return nullptr;
    }
    return &(*it);
}

/// Cherche un personnage par ID dans la collection (const).
[[nodiscard]] const CGDDChara* find_chara(const CGDDCharaCollection& collection, uint32_t chara_id) {
    auto it = std::find_if(collection.characters.begin(), collection.characters.end(),
                           [chara_id](const CGDDChara& c) { return c.chara_id == chara_id; });
    if (it == collection.characters.end()) {
        return nullptr;
    }
    return &(*it);
}

/// Ajoute un personnage a la collection (s'il n'existe pas deja).
/// @return true si ajoute, false si deja present.
[[nodiscard]] bool add_chara(CGDDCharaCollection& collection, CGDDChara chara) {
    if (find_chara(collection, chara.chara_id) != nullptr) {
        spdlog::debug("add_chara: chara {} deja dans la collection", chara.chara_id);
        return false;
    }
    collection.characters.push_back(std::move(chara));
    return true;
}

} // namespace game
