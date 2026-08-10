#pragma once

/// @file gamedata/loader.h
/// Chargeur de donnees de jeu — construit une GameDatabase complete
/// depuis les fichiers cfg.bin bruts ou pre-convertis en JSON.
///
/// Port depuis inagle/src/core/data-loader.ts + tous les parsers.
/// Utilise le parser cfgbin natif C++ pour un parsing 10-100x plus rapide.

#include "iecode/gamedata/types.h"

#include <filesystem>
#include <optional>

namespace iecode::gamedata {

/// Charge une base de donnees complete du jeu.
///
/// @param data_root Racine des donnees (contient common/gamedata/, common/text/)
/// @param load_text Si true, charge aussi les textes localises (9 locales)
/// @return GameDatabase complete, ou nullopt en cas d'erreur
///
/// Pipeline :
///   1. Charge chara_base → ParsedCharaBase[]
///   2. Charge chara_param → ParsedCharaParam[]
///   3. Charge skill_config (v4+v5) → ParsedSkill[]
///   4. Charge belong_team → ParsedTeam[]
///   5. Charge item_config → ParsedItem[]
///   6. Charge les textes (9 locales × 4 types = 36 fichiers)
///   7. Cross-reference : skills → noms, characters → equipes
///   8. Construit les index by-id
[[nodiscard]] std::optional<GameDatabase> load_game_database(
    const std::filesystem::path& data_root,
    bool load_text = true);

/// Charge uniquement les personnages (plus rapide, pas de textes).
[[nodiscard]] std::vector<ParsedCharaParam> load_characters(
    const std::filesystem::path& data_root);

/// Charge uniquement les skills.
[[nodiscard]] std::vector<ParsedSkill> load_skills(
    const std::filesystem::path& data_root);

/// Charge uniquement les equipes.
[[nodiscard]] std::vector<ParsedTeam> load_teams(
    const std::filesystem::path& data_root);

/// Charge uniquement les items.
[[nodiscard]] std::vector<ParsedItem> load_items(
    const std::filesystem::path& data_root);

/// Charge uniquement les skills passifs.
[[nodiscard]] std::vector<ParsedPassive> load_passives(
    const std::filesystem::path& data_root);

/// Charge uniquement les quetes.
[[nodiscard]] std::vector<ParsedQuest> load_quests(
    const std::filesystem::path& data_root);

/// Charge uniquement les tactiques speciales.
[[nodiscard]] std::vector<ParsedSpecialTactic> load_special_tactics(
    const std::filesystem::path& data_root);

/// Charge uniquement les formations.
[[nodiscard]] std::vector<ParsedFormation> load_formations(
    const std::filesystem::path& data_root);

/// Charge uniquement les shops.
[[nodiscard]] std::vector<ParsedShop> load_shops(
    const std::filesystem::path& data_root);

/// Charge uniquement les equipes adverses.
[[nodiscard]] std::vector<ParsedOpponentTeam> load_opponent_teams(
    const std::filesystem::path& data_root);

/// Charge uniquement les costumes.
[[nodiscard]] std::vector<ParsedCostume> load_costumes(
    const std::filesystem::path& data_root);

/// Charge uniquement les uniformes.
[[nodiscard]] std::vector<ParsedUniform> load_uniforms(
    const std::filesystem::path& data_root);

/// Charge uniquement les series.
[[nodiscard]] std::vector<ParsedSeries> load_series(
    const std::filesystem::path& data_root);

/// Charge uniquement les missions.
[[nodiscard]] std::vector<ParsedMission> load_missions(
    const std::filesystem::path& data_root);

/// Charge uniquement les trophees.
[[nodiscard]] std::vector<ParsedTrophy> load_trophies(
    const std::filesystem::path& data_root);

/// Charge uniquement la musique.
[[nodiscard]] std::vector<ParsedMusic> load_music(
    const std::filesystem::path& data_root);

/// Calcule les stats d'un personnage a un niveau donne (1-99).
[[nodiscard]] CharacterStats calculate_stats_at_level(
    const GameDatabase& db, const ParsedCharaParam& chara, int level);

/// Calcule la courbe d'evolution complete (1-99) d'un personnage.
[[nodiscard]] std::vector<StatSnapshot> calculate_evolution_curve(
    const GameDatabase& db, const ParsedCharaParam& chara);

} // namespace iecode::gamedata
