/// @file soccer_team_dock.cpp
/// Implementation de CSoccerTeamDock — gestion des equipes soccer.
/// Formations, recherche de joueurs, statistiques.

#include "iecode/game/soccer/soccer_team_dock.h"
#include "iecode/game/chara/chara_param.h"

#include <spdlog/spdlog.h>

#include <algorithm>

namespace game {

namespace {

/// Genere les positions de formation normalisees [0,1] pour les 11 titulaires.
/// Le slot 0 est toujours le gardien (GK).
/// Les coordonnees sont :
///   x = position laterale [0, 1] (0 = gauche, 1 = droite)
///   z = position longitudinale [0, 1] (0 = defense, 1 = attaque)
void generate_formation_slots(
    FormationType ft,
    std::array<FormationSlot, TEAM_STARTERS>& slots)
{
    // GK toujours au centre, tout en arriere
    slots[0] = {0.5f, 0.05f};

    switch (ft) {
    case FormationType::F_4_4_2:
        // 4 defenseurs
        slots[1] = {0.15f, 0.25f}; slots[2] = {0.38f, 0.28f};
        slots[3] = {0.62f, 0.28f}; slots[4] = {0.85f, 0.25f};
        // 4 milieux
        slots[5] = {0.15f, 0.50f}; slots[6] = {0.38f, 0.52f};
        slots[7] = {0.62f, 0.52f}; slots[8] = {0.85f, 0.50f};
        // 2 attaquants
        slots[9]  = {0.35f, 0.78f}; slots[10] = {0.65f, 0.78f};
        break;

    case FormationType::F_4_3_3:
        // 4 defenseurs
        slots[1] = {0.15f, 0.25f}; slots[2] = {0.38f, 0.28f};
        slots[3] = {0.62f, 0.28f}; slots[4] = {0.85f, 0.25f};
        // 3 milieux
        slots[5] = {0.25f, 0.50f}; slots[6] = {0.50f, 0.52f};
        slots[7] = {0.75f, 0.50f};
        // 3 attaquants
        slots[8] = {0.20f, 0.78f}; slots[9] = {0.50f, 0.80f};
        slots[10] = {0.80f, 0.78f};
        break;

    case FormationType::F_3_5_2:
        // 3 defenseurs
        slots[1] = {0.25f, 0.25f}; slots[2] = {0.50f, 0.28f};
        slots[3] = {0.75f, 0.25f};
        // 5 milieux
        slots[4] = {0.10f, 0.48f}; slots[5] = {0.30f, 0.50f};
        slots[6] = {0.50f, 0.52f}; slots[7] = {0.70f, 0.50f};
        slots[8] = {0.90f, 0.48f};
        // 2 attaquants
        slots[9]  = {0.35f, 0.78f}; slots[10] = {0.65f, 0.78f};
        break;

    case FormationType::F_4_5_1:
        // 4 defenseurs
        slots[1] = {0.15f, 0.25f}; slots[2] = {0.38f, 0.28f};
        slots[3] = {0.62f, 0.28f}; slots[4] = {0.85f, 0.25f};
        // 5 milieux
        slots[5] = {0.10f, 0.48f}; slots[6] = {0.30f, 0.50f};
        slots[7] = {0.50f, 0.52f}; slots[8] = {0.70f, 0.50f};
        slots[9] = {0.90f, 0.48f};
        // 1 attaquant
        slots[10] = {0.50f, 0.80f};
        break;

    case FormationType::F_5_3_2:
        // 5 defenseurs
        slots[1] = {0.10f, 0.22f}; slots[2] = {0.30f, 0.25f};
        slots[3] = {0.50f, 0.28f}; slots[4] = {0.70f, 0.25f};
        slots[5] = {0.90f, 0.22f};
        // 3 milieux
        slots[6] = {0.25f, 0.50f}; slots[7] = {0.50f, 0.52f};
        slots[8] = {0.75f, 0.50f};
        // 2 attaquants
        slots[9]  = {0.35f, 0.78f}; slots[10] = {0.65f, 0.78f};
        break;

    case FormationType::F_3_4_3:
        // 3 defenseurs
        slots[1] = {0.25f, 0.25f}; slots[2] = {0.50f, 0.28f};
        slots[3] = {0.75f, 0.25f};
        // 4 milieux
        slots[4] = {0.15f, 0.50f}; slots[5] = {0.38f, 0.52f};
        slots[6] = {0.62f, 0.52f}; slots[7] = {0.85f, 0.50f};
        // 3 attaquants
        slots[8] = {0.20f, 0.78f}; slots[9] = {0.50f, 0.80f};
        slots[10] = {0.80f, 0.78f};
        break;

    case FormationType::F_4_2_4:
        // 4 defenseurs
        slots[1] = {0.15f, 0.25f}; slots[2] = {0.38f, 0.28f};
        slots[3] = {0.62f, 0.28f}; slots[4] = {0.85f, 0.25f};
        // 2 milieux
        slots[5] = {0.35f, 0.50f}; slots[6] = {0.65f, 0.50f};
        // 4 attaquants
        slots[7] = {0.15f, 0.75f}; slots[8] = {0.38f, 0.78f};
        slots[9] = {0.62f, 0.78f}; slots[10] = {0.85f, 0.75f};
        break;

    case FormationType::F_5_4_1:
        // 5 defenseurs
        slots[1] = {0.10f, 0.22f}; slots[2] = {0.30f, 0.25f};
        slots[3] = {0.50f, 0.28f}; slots[4] = {0.70f, 0.25f};
        slots[5] = {0.90f, 0.22f};
        // 4 milieux
        slots[6] = {0.15f, 0.50f}; slots[7] = {0.38f, 0.52f};
        slots[8] = {0.62f, 0.52f}; slots[9] = {0.85f, 0.50f};
        // 1 attaquant
        slots[10] = {0.50f, 0.80f};
        break;
    }
}

} // namespace anonyme

void CSoccerTeamDock::apply_formation(FormationType ft) {
    formation_ = ft;
    generate_formation_slots(ft, formation_slots_);

    spdlog::debug("CSoccerTeamDock: equipe {} applique formation {}",
                  team_id_, formation_name(ft));
}

CSoccerCharaData* CSoccerTeamDock::find_player(uint32_t chara_id) {
    for (auto& player : players_) {
        if (player.chara_id == chara_id) {
            return &player;
        }
    }
    return nullptr;
}

const CSoccerCharaData* CSoccerTeamDock::find_player(uint32_t chara_id) const {
    for (const auto& player : players_) {
        if (player.chara_id == chara_id) {
            return &player;
        }
    }
    return nullptr;
}

uint32_t CSoccerTeamDock::on_field_count() const {
    uint32_t count = 0;
    for (uint32_t i = 0; i < active_count_; ++i) {
        if (players_[i].is_on_field) {
            ++count;
        }
    }
    return count;
}

bool CSoccerTeamDock::has_captain_on_field() const {
    for (uint32_t i = 0; i < active_count_; ++i) {
        if (players_[i].is_captain && players_[i].is_on_field) {
            return true;
        }
    }
    return false;
}

} // namespace game
