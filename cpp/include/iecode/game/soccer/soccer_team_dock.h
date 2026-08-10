#pragma once

/// @file soccer_team_dock.h
/// CSoccerTeamDock — donnees d'equipe soccer.
/// CSoccerCharaData — donnees d'un joueur sur le terrain.
/// Classes RTTI : game::CSoccerTeamDock, game::CSoccerCharaData.
/// Constantes extraites de soccer_match_state_machine.c.

#include <array>
#include <cstdint>
#include <string_view>

namespace game {

/// Types de formation supportes.
enum class FormationType : uint8_t {
    F_4_4_2 = 0,
    F_4_3_3 = 1,
    F_3_5_2 = 2,
    F_4_5_1 = 3,
    F_5_3_2 = 4,
    F_3_4_3 = 5,
    F_4_2_4 = 6,
    F_5_4_1 = 7,
};

/// Retourne le nom lisible d'une formation.
[[nodiscard]] constexpr std::string_view formation_name(FormationType ft) {
    switch (ft) {
    case FormationType::F_4_4_2: return "4-4-2";
    case FormationType::F_4_3_3: return "4-3-3";
    case FormationType::F_3_5_2: return "3-5-2";
    case FormationType::F_4_5_1: return "4-5-1";
    case FormationType::F_5_3_2: return "5-3-2";
    case FormationType::F_3_4_3: return "3-4-3";
    case FormationType::F_4_2_4: return "4-2-4";
    case FormationType::F_5_4_1: return "5-4-1";
    }
    return "Unknown";
}

/// Nombre max de joueurs sur le terrain (incluant remplacants et arbitres).
inline constexpr uint32_t MAX_SOCCER_PLAYERS = 58;

/// Stride memoire par joueur en memoire nie.exe.
inline constexpr uint32_t SOCCER_PLAYER_STRIDE = 0x570;

/// Stride memoire par equipe.
inline constexpr uint32_t SOCCER_TEAM_STRIDE = 0x1028;

/// Donnees d'un joueur sur le terrain.
struct CSoccerCharaData {
    uint32_t player_id    = 0;
    uint32_t chara_id     = 0;      // ID du personnage (GDSCharaBase)
    uint8_t  position     = 0;      // PlayerPosition (FW/MF/DF/GK)
    uint8_t  formation_x  = 0;      // Position X dans la formation [0, 10]
    uint8_t  formation_y  = 0;      // Position Y dans la formation [0, 10]
    int16_t  kick         = 0;
    int16_t  guard        = 0;
    int16_t  catch_       = 0;
    int16_t  body         = 0;
    int16_t  control      = 0;
    int16_t  speed        = 0;
    int16_t  stamina      = 0;
    int16_t  current_sp   = 0;      // Stamina restante
    bool     is_captain   = false;
    bool     is_on_field  = true;
};

/// Enregistrement de match — resultats et statistiques.
struct CSoccerMatchRecord {
    uint32_t goals_scored    = 0;
    uint32_t goals_conceded  = 0;
    uint32_t shots           = 0;
    uint32_t shots_on_target = 0;
    uint32_t passes          = 0;
    uint32_t tackles         = 0;
    uint32_t fouls           = 0;
    float    possession      = 0.5f;   // [0, 1]
};

/// Nombre de joueurs titulaires.
inline constexpr uint32_t TEAM_STARTERS = 11;

/// Nombre max de joueurs dans l'equipe (titulaires + remplacants).
inline constexpr uint32_t TEAM_MAX_PLAYERS = 16;

/// Position d'un joueur dans une formation (coordonnees normalisees [0, 1]).
struct FormationSlot {
    float x = 0.f;  // Position laterale [0, 1] (0 = gauche, 1 = droite)
    float z = 0.f;  // Position longitudinale [0, 1] (0 = defense, 1 = attaque)
};

/// Dock d'equipe — contient les donnees de tous les joueurs d'une equipe.
struct CSoccerTeamDock {
    uint32_t team_id_ = 0;

    /// Joueurs de l'equipe (11 titulaires + remplacants).
    std::array<CSoccerCharaData, TEAM_MAX_PLAYERS> players_ = {};

    /// Nombre de joueurs actifs.
    uint32_t active_count_ = TEAM_STARTERS;

    /// Formation courante.
    FormationType formation_ = FormationType::F_4_4_2;

    /// Positions de la formation (pour les 11 titulaires, GK en slot 0).
    std::array<FormationSlot, TEAM_STARTERS> formation_slots_ = {};

    /// Statistiques du match.
    CSoccerMatchRecord record_;

    /// Score actuel.
    int score_ = 0;

    /// Applique une formation et recalcule les positions des slots.
    void apply_formation(FormationType ft);

    /// Retourne le joueur avec l'ID donne, ou nullptr si introuvable.
    [[nodiscard]] CSoccerCharaData* find_player(uint32_t chara_id);

    /// Retourne le joueur avec l'ID donne (const).
    [[nodiscard]] const CSoccerCharaData* find_player(uint32_t chara_id) const;

    /// Nombre de joueurs sur le terrain.
    [[nodiscard]] uint32_t on_field_count() const;

    /// Verifie si le capitaine est sur le terrain.
    [[nodiscard]] bool has_captain_on_field() const;
};

} // namespace game
