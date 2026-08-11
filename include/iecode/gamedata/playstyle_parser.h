#pragma once

/// @file gamedata/playstyle_parser.h
/// Parser du systeme PlayStyle d'IEVR.
///
/// Agrege les donnees depuis 5 sources JSON pre-parsees :
///   1. chara_param       — distribution des playstyles par personnage
///   2. menu_text (en/fr) — labels courts + labels "Team Build"
///   3. chara_param_table — tables preset/personality/add_rate par playstyle
///   4. growth_table      — coefficients de croissance Lv1 par position/playstyle
///   5. team_build_config — effets up/down/info par playstyle
///
/// Toutes les structures sont serialisables en JSON via to_json().

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

namespace iecode::gamedata {

// ── Enums ──────────────────────────────────────────────────────────────

/// Les 6 playstyles du jeu (indices 0-5).
enum class PlayStyle : uint8_t {
    Counter   = 0,
    Bond      = 1,
    Tension   = 2,
    RoughPlay = 3,
    Justice   = 4,
    Freedom   = 5,
};

/// Nom anglais d'un playstyle (pour cles JSON).
[[nodiscard]] const char* playstyle_name(PlayStyle ps) noexcept;

// ── Structs ────────────────────────────────────────────────────────────

/// Label d'un playstyle (textes localises + hashes).
struct PlaystyleLabel {
    int32_t index            = 0;
    std::string en;                 // Label court anglais
    std::string fr;                 // Label court francais
    std::string icon;               // Nom d'icone (convention icon_build_l0X)
    std::string team_build_en;      // Label "Team Build" anglais
    std::string team_build_fr;      // Label "Team Build" francais
    int32_t hash_label       = 0;   // Hash du label court
    int32_t hash_team_build  = 0;   // Hash du label Team Build
};

/// Entree de table config (preset, personality, add_rate).
/// Reference un sous-tableau via offset + count.
struct PlaystyleTableEntry {
    int32_t play_style = 0;
    int32_t offset     = 0;     // Index dans la table de donnees
    int32_t count      = 0;     // Nombre d'entrees
};

/// Donnees brutes d'un slot preset/personality (7 stats min/max).
struct PlaystylePresetData {
    int32_t param_min_kick         = 0;
    int32_t param_min_control      = 0;
    int32_t param_min_technic      = 0;
    int32_t param_min_pressure     = 0;
    int32_t param_min_physical     = 0;
    int32_t param_min_agility      = 0;
    int32_t param_min_intelligence = 0;
    int32_t param_max_kick         = 0;
    int32_t param_max_control      = 0;
    int32_t param_max_technic      = 0;
    int32_t param_max_pressure     = 0;
    int32_t param_max_physical     = 0;
    int32_t param_max_agility      = 0;
    int32_t param_max_intelligence = 0;
    // max2 : plafond apres amelioration
    int32_t param_max2_kick         = 0;
    int32_t param_max2_control      = 0;
    int32_t param_max2_technic      = 0;
    int32_t param_max2_pressure     = 0;
    int32_t param_max2_physical     = 0;
    int32_t param_max2_agility      = 0;
    int32_t param_max2_intelligence = 0;
};

/// Donnees de personnalite (modificateurs 7 stats).
struct PlaystylePersonalityData {
    int32_t param_min_kick         = 0;
    int32_t param_min_control      = 0;
    int32_t param_min_technic      = 0;
    int32_t param_min_pressure     = 0;
    int32_t param_min_physical     = 0;
    int32_t param_min_agility      = 0;
    int32_t param_min_intelligence = 0;
    int32_t param_max_kick         = 0;
    int32_t param_max_control      = 0;
    int32_t param_max_technic      = 0;
    int32_t param_max_pressure     = 0;
    int32_t param_max_physical     = 0;
    int32_t param_max_agility      = 0;
    int32_t param_max_intelligence = 0;
};

/// Multiplicateurs add_rate par stat (float).
struct PlaystyleAddRateData {
    float param_kick         = 0.0f;
    float param_control      = 0.0f;
    float param_technic      = 0.0f;
    float param_pressure     = 0.0f;
    float param_physical     = 0.0f;
    float param_agility      = 0.0f;
    float param_intelligence = 0.0f;
};

/// Tables de configuration regroupees.
struct PlaystyleTableConfig {
    // Index par playstyle → [offset, count] dans les data lists
    std::vector<PlaystyleTableEntry> preset;
    std::vector<PlaystyleTableEntry> personality;
    std::vector<PlaystyleTableEntry> add_rate;

    // Donnees sous-jacentes
    std::vector<PlaystylePresetData> preset_data;
    std::vector<PlaystylePersonalityData> personality_data;
    std::vector<PlaystyleAddRateData> add_rate_data;
};

/// Entree de la table de croissance Lv1.
struct PlaystyleGrowthEntry {
    int32_t main_position = 0;
    int32_t sub_position  = 0;
    int32_t play_style    = 0;
    // Coefficients de croissance (somme = ~79)
    int32_t kick         = 0;
    int32_t control      = 0;
    int32_t technique    = 0;
    int32_t pressure     = 0;
    int32_t physical     = 0;
    int32_t agility      = 0;
    int32_t intelligence = 0;
};

/// Donnee d'effet Team Build.
struct PlaystyleTeamBuildEffect {
    int32_t id          = 0;     // Index dans la liste
    int32_t hash_1      = 0;     // vars[0] — hash d'identification
    int32_t sub_id      = 0;     // vars[1]
    int32_t effect_type = 0;     // vars[2]
    std::vector<int32_t> effect_hashes;  // vars[3..8]
};

/// Info d'effet Team Build (reference vers effect_data).
struct TeamBuildEffectInfo {
    int32_t info_id       = 0;   // vars[0]
    int32_t ref_offset    = 0;   // REF_EFFECT_DATA offset
    int32_t ref_count     = 0;   // REF_EFFECT_DATA count
};

/// Donnees Up d'un Team Build.
struct TeamBuildUpData {
    int32_t up_id         = 0;
    int32_t threshold     = 0;
    int32_t effect_count  = 0;
    std::vector<int32_t> raw;    // Toutes les variables brutes
};

/// Donnees Down d'un Team Build.
struct TeamBuildDownData {
    int32_t down_id       = 0;
    int32_t threshold     = 0;
    int32_t effect_count  = 0;
    std::vector<int32_t> raw;
};

/// Info Team Build pour un playstyle.
struct TeamBuildInfo {
    int32_t play_style_index = 0;   // vars[0]
    int32_t level            = 0;   // vars[1]
    // References vers up/down/effect (offset, count)
    int32_t ref_up_offset    = 0;
    int32_t ref_up_count     = 0;
    int32_t ref_down_offset  = 0;
    int32_t ref_down_count   = 0;
    int32_t ref_effect_offset = 0;
    int32_t ref_effect_count  = 0;
};

/// Systeme Team Build complet.
struct TeamBuildSystem {
    std::vector<PlaystyleTeamBuildEffect> effect_data;
    std::vector<TeamBuildEffectInfo> effect_info;
    std::vector<TeamBuildUpData> up_data;
    std::vector<TeamBuildDownData> down_data;
    std::vector<TeamBuildInfo> info;
};

// ── Base de donnees PlayStyle complete ──────────────────────────────────

struct PlaystyleDatabase {
    std::vector<PlaystyleLabel> labels;                     // 6 labels
    std::unordered_map<std::string, int32_t> distribution;  // nom → count
    PlaystyleTableConfig table_config;
    std::vector<PlaystyleGrowthEntry> growth_table_lv1;     // 36 entrees
    TeamBuildSystem team_build;
    int32_t total_characters = 0;
};

// ── API ────────────────────────────────────────────────────────────────

/// Parse le systeme PlayStyle complet depuis les fichiers JSON pre-parses.
///
/// @param data_root Racine des donnees (contient common/gamedata/, common/text/)
/// @return PlaystyleDatabase complete, ou nullopt en cas d'erreur
[[nodiscard]] std::optional<PlaystyleDatabase> parse_playstyle_system(
    const std::filesystem::path& data_root);

/// Serialise la base PlayStyle en JSON complet.
[[nodiscard]] nlohmann::json playstyle_to_json(const PlaystyleDatabase& db);

} // namespace iecode::gamedata
