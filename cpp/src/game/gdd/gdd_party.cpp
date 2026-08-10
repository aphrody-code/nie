/// @file gdd_party.cpp
/// Implementation des donnees d'equipe et de combat RPG —
/// CGDDPartyStatus, CGDDPhaseStatus, CGDDRpgBattleData.

#include "iecode/game/gdd/gdd_party.h"

#include <spdlog/spdlog.h>

namespace game {

// ── Fonctions utilitaires pour CGDDPartyStatus ─────────────────────

/// Ajoute un membre a l'equipe.
/// @return true si le membre a ete ajoute, false si l'equipe est pleine ou le membre deja present.
[[nodiscard]] bool add_party_member(CGDDPartyStatus& party, uint32_t chara_id) {
    if (party.active_count >= CGDDPartyStatus::MAX_MEMBERS) {
        spdlog::warn("add_party_member: equipe pleine ({}/{})",
                     party.active_count, CGDDPartyStatus::MAX_MEMBERS);
        return false;
    }

    // Verifier si le personnage est deja dans l'equipe
    for (uint32_t i = 0; i < party.active_count; ++i) {
        if (party.member_ids[i] == chara_id) {
            spdlog::debug("add_party_member: chara {} deja dans l'equipe", chara_id);
            return false;
        }
    }

    party.member_ids[party.active_count] = chara_id;
    ++party.active_count;
    return true;
}

/// Retire un membre de l'equipe par ID.
/// @return true si le membre a ete retire.
[[nodiscard]] bool remove_party_member(CGDDPartyStatus& party, uint32_t chara_id) {
    for (uint32_t i = 0; i < party.active_count; ++i) {
        if (party.member_ids[i] == chara_id) {
            // Decaler les elements suivants
            for (uint32_t j = i; j + 1 < party.active_count; ++j) {
                party.member_ids[j] = party.member_ids[j + 1];
            }
            party.member_ids[party.active_count - 1] = 0;
            --party.active_count;
            return true;
        }
    }
    return false;
}

/// Verifie si un personnage est dans l'equipe.
[[nodiscard]] bool is_in_party(const CGDDPartyStatus& party, uint32_t chara_id) {
    for (uint32_t i = 0; i < party.active_count; ++i) {
        if (party.member_ids[i] == chara_id) {
            return true;
        }
    }
    return false;
}

} // namespace game
