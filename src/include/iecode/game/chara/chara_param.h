#pragma once

/// @file chara_param.h
/// CCharaParam — parametres de base d'un personnage.
/// CCharaActParam — parametres d'action (vitesses).
/// CCharaMoveParam — parametres de deplacement (physique).
/// Classes RTTI : game::CCharaParam, game::CCharaActParam, game::CCharaMoveParam.
/// Correspond a GDSCharaParam dans les cfg.bin.

#include <algorithm>
#include <array>
#include <cstdint>
#include <optional>
#include <string>

namespace game {

/// Nombre maximum de slots de competences passives equipees.
inline constexpr uint32_t MAX_PASSIVE_SKILLS = 5;

/// Nombre maximum de slots de competences actives equipees.
inline constexpr uint32_t MAX_ACTIVE_SKILLS = 6;

/// Niveau maximum d'un personnage.
inline constexpr uint32_t MAX_LEVEL = 99;

/// Position d'un joueur sur le terrain.
enum class PlayerPosition : uint8_t {
    FW = 0,   // Attaquant
    MF = 1,   // Milieu
    DF = 2,   // Defenseur
    GK = 3,   // Gardien
};

/// Element d'un joueur.
enum class PlayerElement : uint8_t {
    Fire  = 0,
    Wind  = 1,
    Earth = 2,
    Wood  = 3,
};

/// Taux de croissance par stat — multiplie la progression a chaque niveau.
struct GrowthRates {
    float kick    = 1.0f;
    float guard   = 1.0f;
    float catch_  = 1.0f;
    float body    = 1.0f;
    float control = 1.0f;
    float speed   = 1.0f;
    float stamina = 1.0f;
    float luck    = 1.0f;
};

/// Parametres d'un personnage en memoire (game::CCharaParam).
/// Correspond a GDSCharaParam dans les cfg.bin.
struct CCharaParam {
    uint32_t       chara_id     = 0;
    uint32_t       name_hash    = 0;
    std::string    name_key;            ///< Cle de localisation du nom
    int16_t        kick         = 0;
    int16_t        guard        = 0;
    int16_t        catch_       = 0;
    int16_t        body         = 0;
    int16_t        control      = 0;
    int16_t        speed        = 0;
    int16_t        stamina      = 0;
    int16_t        luck         = 0;
    int16_t        gp           = 100;  ///< Points de gardien
    int16_t        tp           = 100;  ///< Points techniques
    int16_t        freedom      = 0;    ///< Liberte (stat speciale)
    PlayerPosition position     = PlayerPosition::FW;
    PlayerElement  element      = PlayerElement::Fire;
    uint8_t        rarity       = 1;
    uint8_t        level        = 1;
    GrowthRates    growth_rates;        ///< Taux de croissance par stat
    std::array<uint32_t, MAX_PASSIVE_SKILLS> passive_skill_ids = {};
    std::array<uint32_t, MAX_ACTIVE_SKILLS>  active_skill_ids  = {};

    /// Calcule les stats effectives au niveau donne, en appliquant les growth rates.
    /// Retourne nullopt si le niveau est invalide.
    [[nodiscard]] std::optional<CCharaParam> compute_stats_at_level(uint8_t target_level) const;

    /// Calcule une stat individuelle au niveau donne.
    [[nodiscard]] static int16_t compute_stat(int16_t base, float growth_rate, uint8_t level);

    /// Retourne la somme de toutes les stats de base (kick+guard+catch+body+control+speed+stamina+luck).
    [[nodiscard]] int32_t total_stats() const;

    /// Equipe une competence passive dans le premier slot libre.
    /// Retourne false si tous les slots sont pleins ou si la skill est deja equipee.
    [[nodiscard]] bool equip_passive_skill(uint32_t skill_id);

    /// Retire une competence passive par ID.
    [[nodiscard]] bool unequip_passive_skill(uint32_t skill_id);

    /// Equipe une competence active dans le premier slot libre.
    [[nodiscard]] bool equip_active_skill(uint32_t skill_id);

    /// Retire une competence active par ID.
    [[nodiscard]] bool unequip_active_skill(uint32_t skill_id);
};

/// Parametres d'action (game::CCharaActParam).
/// Vitesses de deplacement dans les differents modes.
struct CCharaActParam {
    float walk_speed   = 3.f;
    float run_speed    = 6.f;
    float sprint_speed = 9.f;
    float turn_speed   = 180.f;   // Degres par seconde
};

/// Parametres de deplacement physique (game::CCharaMoveParam).
struct CCharaMoveParam {
    float acceleration = 10.f;
    float deceleration = 15.f;
    float jump_force   = 5.f;
    float gravity      = -9.81f;
};

} // namespace game
