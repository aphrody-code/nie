#pragma once

/// @file gamedata/types.h
/// Types de donnees du jeu Inazuma Eleven: Victory Road.
/// Port depuis inagle/src/core/types.ts (642 lignes).
///
/// Toutes les structures sont compatibles avec la serialisation nlohmann::json
/// via NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE_WITH_DEFAULT.

#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace iecode::gamedata {

// ── Enums ───────────────────────────────────────────────────────────

enum class Element : uint8_t {
    None     = 0,
    Wind     = 1,   // Vent
    Forest   = 2,   // Foret
    Fire     = 3,   // Feu
    Mountain = 4,   // Montagne
};

enum class Position : uint8_t {
    Coach = 0,
    GK    = 1,
    FW    = 2,
    MF    = 3,
    DF    = 4,
};

enum class SkillCategory : uint8_t {
    Shoot   = 1,    // Tir
    Dribble = 2,    // Dribble
    Block   = 3,    // Defense
    Catch   = 4,    // Arret
    Special = 5,    // Special
};

enum class Gender : uint8_t {
    Male    = 0,
    Female  = 1,
    Unknown = 2,    // 不明・その他
};

/// Rarete du personnage (de Normal a Hero).
enum class Rarity : uint8_t {
    Normal          = 0,    // Normal
    EnProgression   = 1,    // En Progression
    Experimente     = 2,    // Experimente
    Emerite         = 3,    // Emerite
    Legendaire      = 4,    // Legendaire
    LegendairePlus  = 5,    // Legendaire+
    LegendairePP    = 6,    // Legendaire++
    LegendairePPP   = 7,    // Legendaire+++
    Hero            = 10,   // Hero (rang 20 BASARA)
};

/// Morphologie du personnage.
enum class BodyType : uint8_t {
    Normal   = 0,   // 普通
    Small    = 1,   // 小柄
    Big      = 2,   // 大柄
    Tall     = 3,   // のっぽ
    Muscle   = 4,   // 筋肉
    SmallFat = 5,   // 小太り
};

/// Type de build strategique.
enum class BuildType : uint8_t {
    ForceWin  = 0,  // 必殺 (Breach)
    Counter   = 1,  // カウンター
    Kizuna    = 2,  // キズナ (Bond)
    Tension   = 3,  // テンション
    RoughPlay = 4,  // ラフプレー
    FairPlay  = 5,  // 正義 (Justice)
};

/// Role du personnage.
enum class Role : uint8_t {
    Player  = 0,    // 選手
    Coach   = 1,    // 監督
    Manager = 2,    // マネージャー
};

/// Sous-type d'aura skill.
enum class AuraSubType : uint8_t {
    Aura       = 0,
    Keshin     = 1,
    Soul       = 2,
    Awakening  = 3,
    ModeChange = 4,
    Miximax    = 5,
};

// ── Localized names ─────────────────────────────────────────────────

/// Noms localises dans les 9 langues du jeu.
struct LocalizedNames {
    std::string ja;
    std::string en;
    std::string fr;
    std::string de;
    std::string es;
    std::string it;
    std::string pt;
    std::string zh_hans;
    std::string zh_hant;

    /// Retourne le premier nom non-vide (en > fr > ja).
    [[nodiscard]] const std::string& best() const noexcept {
        if (!en.empty()) return en;
        if (!fr.empty()) return fr;
        if (!ja.empty()) return ja;
        return en; // fallback vide
    }
};

// ── Character Stats ─────────────────────────────────────────────────

/// Stats d'un personnage (7 stats).
struct CharacterStats {
    int16_t kick         = 0;
    int16_t control      = 0;   // Controle
    int16_t technique    = 0;
    int16_t pressure     = 0;   // Pression
    int16_t physical     = 0;   // Physique
    int16_t agility      = 0;   // Vitesse
    int16_t intelligence = 0;
};

/// Stats multi-niveaux.
struct MultiLevelStats {
    CharacterStats lv1;
    CharacterStats lv30;
    CharacterStats lv50;
    CharacterStats lv99;
};

// ── Skill Slot ──────────────────────────────────────────────────────

struct SkillSlot {
    std::string skill_id;   // "0xABCD1234"
    int32_t learn_level = 0;
};

// ── Parsed Character Param ──────────────────────────────────────────

/// Donnees d'une variante de personnage (depuis CHARA_PARAM_INFO).
struct ParsedCharaParam {
    std::string chara_param_id;  // "0xABCD1234"
    std::string chara_base_id;   // "0xABCD1234"
    Element element         = Element::None;
    Position main_position  = Position::GK;
    Position sub_position   = Position::GK;
    Gender gender           = Gender::Male;
    uint8_t chara_rank      = 0;    // Rarete
    uint8_t growth_pattern  = 0;
    uint8_t play_style      = 0;
    std::vector<SkillSlot> skills;  // Max 6
    MultiLevelStats stats;          // Stats calculees (lv1/30/50/99)
    std::vector<int32_t> raw_variables; // Toutes les variables brutes
};

// ── Parsed Character Base ───────────────────────────────────────────

/// Donnees de base d'un personnage (depuis CHARA_BASE_INFO).
struct ParsedCharaBase {
    std::string chara_id;    // "0xABCD1234"
    std::string code;        // "c01000010"
    std::string name_hash;   // Hash du nom
    Gender gender = Gender::Male;
    std::string series_id;
    std::string team_id;
};

// ── Parsed Skill ────────────────────────────────────────────────────

struct ParsedSkill {
    std::string skill_id;        // "0xABCD1234"
    std::string skill_id_str;    // "whs00010"
    std::string name_hash;       // Hash pour le texte
    std::string desc_hash;       // Hash pour la description
    LocalizedNames names;
    LocalizedNames descriptions;
    int32_t power_min      = 0;
    int32_t power_max      = 0;
    int32_t tp_cost        = 0;
    Element element        = Element::None;
    SkillCategory category = SkillCategory::Shoot;
    int32_t growth_type    = 0;
    int32_t recast_time    = 0;
    bool is_eldorado       = false;
    std::string series_id;
};

// ── Parsed Team ─────────────────────────────────────────────────────

struct ParsedTeam {
    std::string team_id;
    int32_t order_type = 0;
    LocalizedNames names;
    std::string series_id;
};

// ── Parsed Item ─────────────────────────────────────────────────────

struct ParsedItem {
    std::string item_id;         // "0xABCD1234"
    std::string internal_code;   // Asset ID (vars[11])
    std::string name_hash;       // TEXT_INFO hash pour le nom
    std::string desc_hash;       // TEXT_INFO hash pour la description
    LocalizedNames names;
    LocalizedNames descriptions;
    std::string category;        // "consume", "shoes", "misanga", etc. (20 categories)
    int32_t price_gp     = 0;    // Prix d'achat (vars[4])
    int32_t stat1        = 0;    // Stat bonus 1 (equipement, vars[5])
    int32_t stat2        = 0;    // Stat bonus 2 (equipement, vars[6])
    int32_t uniform_id   = 0;    // ID uniforme (fashion seulement, vars[last])
};

// ── Parsed Passive Skill ────────────────────────────────────────────

struct ParsedPassiveEffect {
    std::string effect_id;       // "0xABCD1234"
    std::vector<float> params;   // Parametres numeriques de l'effet
};

struct ParsedPassive {
    std::string passive_id;      // "0xABCD1234"
    std::string effect_id;       // "0xABCD1234" (ref vers ParsedPassiveEffect)
    std::string name_hash;
    std::string desc_hash;
    LocalizedNames names;
    LocalizedNames descriptions;
    int32_t rarity = 0;
    std::vector<float> effect_params;  // Copie resolue depuis l'effet
    std::string scope;           // "player" ou "team"
};

// ── Parsed Quest ────────────────────────────────────────────────────

struct ParsedQuest {
    std::string quest_id;        // "0xABCD1234"
    std::string title_hash;      // "0xABCD1234" (lookup texte)
    int32_t phase = 0;           // Numero de chapitre
    int32_t type  = 0;           // 1=MAIN, 2=SUB, 3=DAILY
    std::string image;           // Nom d'image (vars[16])
    LocalizedNames titles;
};

// ── Special Tactics ─────────────────────────────────────────────────

struct SpecialTacticsEffect {
    std::string effect_id;       // "0xABCD1234"
    int32_t power = 0;
    std::vector<std::string> conditions;  // Filtrees pour NULL_SENTINEL
};

struct ParsedSpecialTactic {
    std::string tactics_id;      // "0xABCD1234"
    std::string internal_code;   // "wht10010"
    std::string name_hash;
    std::string desc_hash;
    LocalizedNames names;
    LocalizedNames descriptions;
    int32_t power       = 0;
    int32_t recast_time = 0;
    Element element     = Element::None;
    std::vector<std::string> partner_ids;  // Jusqu'a 3 CRC hashes
};

// ── Formation ───────────────────────────────────────────────────────

struct FormationPosition {
    int32_t position_no  = 0;    // 0-10
    int32_t position_id  = 0;
    int32_t pass_no      = 0;
    bool    b_kickoff    = false;
    bool    b_follow     = false;
    std::array<float, 2> defense_pos = {};
    std::array<float, 2> offense_pos = {};
    std::array<float, 2> start_pos   = {};
};

struct ParsedFormation {
    std::string formation_id;    // "0xABCD1234"
    std::string noun_hash;       // Hash pour le nom
    std::string desc_hash;       // Hash pour la description
    LocalizedNames names;
    LocalizedNames descriptions;
    int32_t power_offense = 0;
    int32_t power_defense = 0;
    std::vector<FormationPosition> positions;
};

// ── Shop ────────────────────────────────────────────────────────────

struct ParsedShop {
    std::string shop_id;         // "0xABCD1234"
    std::string name_hash;       // Hash pour le nom du shop
    std::vector<std::string> item_ids;  // IDs des items en vente
};

// ── Opponent Team ───────────────────────────────────────────────────

struct ParsedOpponentTeam {
    std::string opponent_id;     // "0xABCD1234"
    int32_t type           = 0;
    std::string team_id;         // FK vers ParsedTeam
    std::string desc_text_id;    // Hash pour description
    int32_t difficulty_type = 0;
    std::string bg_texture_name;
    std::string game_id;
};

// ── Growth Tables ───────────────────────────────────────────────────

struct GrowthTableLv1 {
    int32_t main_position = 0;
    int32_t sub_position  = 0;
    int32_t play_style    = 0;
    CharacterStats stats;        // 7 stats au niveau 1
};

struct GrowthTableLv30 {
    int32_t main_position  = 0;
    int32_t sub_position   = 0;
    int32_t growth_pattern = 0;
    int32_t chara_rank     = 0;
    CharacterStats stats;        // 7 stats au niveau 30
};

// ── Enriched Character ──────────────────────────────────────────────

/// Personnage enrichi : fusion de CharaBase + CharaParam + Skills + Texts.
/// Equivalent de inagle Character / buildCharacter().
struct EnrichedCharacter {
    std::string chara_param_id;  // Variante unique
    std::string chara_base_id;   // Personnage de base
    std::string internal_code;   // "c01000100"
    LocalizedNames names;
    LocalizedNames descriptions;
    Element element         = Element::None;
    Position main_position  = Position::GK;
    Position sub_position   = Position::GK;
    Gender gender           = Gender::Male;
    uint8_t chara_rank      = 0;
    uint8_t growth_pattern  = 0;
    uint8_t play_style      = 0;
    MultiLevelStats stats;
    std::string team_id;
    LocalizedNames team_names;
    std::string series_id;

    struct SkillInfo {
        std::string skill_id;
        int32_t learn_level = 0;
        LocalizedNames names;
        int32_t power_min   = 0;
        int32_t power_max   = 0;
        Element element     = Element::None;
    };
    std::vector<SkillInfo> skills;
};

// ── BASARA Character ────────────────────────────────────────────────

struct BasaraBuildType {
    int32_t type = 0;       // Type de build (0-5)
    std::string board_id;   // Board ID hash "0xABCD1234"
};

struct BasaraBuildInfo {
    std::string chara_param_id;        // FK vers EnrichedCharacter
    std::vector<int32_t> type_indices; // Indices dans le tableau build_types
};

struct BasaraCharacter {
    // Herite de EnrichedCharacter
    std::string chara_param_id;
    std::string chara_base_id;
    std::string internal_code;
    LocalizedNames names;
    Element element         = Element::None;
    Position main_position  = Position::GK;
    Gender gender           = Gender::Male;
    uint8_t chara_rank      = 0;
    uint8_t growth_pattern  = 0;
    uint8_t play_style      = 0;
    MultiLevelStats stats;
    std::string team_id;
    LocalizedNames team_names;
    std::string series_id;

    // Specifique BASARA
    int32_t index = 0;                         // Position 1-N dans la liste basara
    std::vector<BasaraBuildType> builds;        // Jusqu'a 6 builds
    std::vector<EnrichedCharacter::SkillInfo> skills;
};

// ── Drop Table ──────────────────────────────────────────────────────

struct DropEntry {
    std::string item_id;    // "0xABCD1234"
    int32_t rate  = 0;      // Poids/probabilite
    int32_t count = 0;      // Nombre d'items droppes
};

struct DropTable {
    std::string table_id;   // "0xABCD1234"
    std::vector<DropEntry> entries;
};

// ── Aura Skill ──────────────────────────────────────────────────────

struct ParsedAuraSkill {
    std::string aura_id;         // "0xABCD1234"
    std::string aura_id_str;     // "wha00010"
    std::string name_hash;
    std::string desc_hash;
    LocalizedNames names;
    LocalizedNames descriptions;
    int32_t power      = 0;
    int32_t tp_cost    = 0;
    Element element    = Element::None;
    int32_t sub_type   = 0;     // 0=Aura, 1=Keshin, 2=Soul, 3=Awakening, 4=ModeChange, 5=Miximax
    std::string series_id;
};

// ── Exp Table ──────────────────────────────────────────────────────

struct ExpTableEntry {
    int32_t level    = 0;
    int32_t need_exp = 0;   // XP requis pour ce niveau
};

struct ExpRarityRate {
    int32_t rarity = 0;     // Growth rank 0-8
    float rate     = 1.0f;  // Multiplicateur XP (1x ou 3x)
};

// ── Stat Calculator ────────────────────────────────────────────────

struct StatSnapshot {
    int32_t level = 0;
    CharacterStats stats;
    int32_t need_exp       = 0;
    int32_t cumulative_exp = 0;
};

// ── Growth Table Main/Sub (Lv50/99) ────────────────────────────────

struct GrowthTableMain {
    int32_t main_position  = 0;
    int32_t sub_position   = 0;
    int32_t growth_pattern = 0;
    int32_t chara_rank     = 0;
    CharacterStats stats_50;
    CharacterStats stats_99;
};

// ── Costume ────────────────────────────────────────────────────────

struct ParsedCostume {
    std::string model_ref_crc;   // "0xABCD1234"
    int32_t type  = 0;
    int32_t flag1 = 0;
    int32_t flag2 = 0;
};

// ── Uniform ────────────────────────────────────────────────────────

struct ParsedUniform {
    std::string fielder_model_crc;
    std::string keeper_model_crc;
    std::string director_model_crc;
    std::string manager_model_crc;
    std::string shoes_fielder_crc;
    std::string shoes_keeper_crc;
    std::string glove_model_crc;
    int32_t type_id           = 0;
    int32_t shoes_model_attr  = 0;
    int32_t uniform_ng_attr   = 0;
    int32_t shoes_locked      = 0;
};

// ── Series ─────────────────────────────────────────────────────────

struct ParsedSeries {
    std::string series_id;       // "0xABCD1234"
    int32_t series_type = 0;     // 1-9
    std::string name_text_id;
    LocalizedNames names;
};

// ── Constellation ──────────────────────────────────────────────────

struct ParsedConstellation {
    int32_t index = 0;           // 0-29
    std::string hash_id;         // "0xABCD1234"
    LocalizedNames names;
    std::vector<std::string> character_ids;  // charaParamId refs
    int32_t character_count = 0;
};

// ── Capsule/Gacha ──────────────────────────────────────────────────

struct CapsulePrize {
    std::string prize_id;        // "0xABCD1234"
    std::vector<int32_t> raw_vars;
};

struct CapsuleLotRankRate {
    std::string rate_id;
    int32_t rank   = 0;
    int32_t weight = 0;
};

struct ParsedCapsule {
    std::string config_id;
    std::vector<CapsulePrize> prizes;
    std::vector<CapsuleLotRankRate> rank_rates;
};

// ── Gallery ────────────────────────────────────────────────────────

struct ParsedGallery {
    std::string gallery_id;      // "0xABCD1234"
    std::string img_path;
    std::string thumb_path;
    int32_t need_token_num = 0;
    int32_t flg_no         = 0;
    int32_t open_cond      = 0;
};

// ── Trick ──────────────────────────────────────────────────────────

struct ParsedTrick {
    std::string trick_id;        // "0xABCD1234"
    std::string trick_id_name;
    std::string event_id;
    std::string event_id_name;
    std::string fail_event_id;
    std::string fail_event_id_name;
    std::string trick_name;      // JP name
    int32_t trick_category = 0;  // 1=Shoot, 2=Dribble, 3=Block, 4=Catch
};

// ── Mission ────────────────────────────────────────────────────────

struct ParsedMission {
    std::string mission_id;      // "0xABCD1234"
    std::string code;
    std::string name_hash;
    LocalizedNames names;
};

// ── Trophy ─────────────────────────────────────────────────────────

struct ParsedTrophy {
    std::string trophy_id;       // "0xABCD1234"
    std::string code;
    std::string name_hash;
    std::string desc_hash;
    LocalizedNames names;
    LocalizedNames descriptions;
};

// ── Dictionary ─────────────────────────────────────────────────────

struct DictionaryHabitat {
    std::string habitat_id;
    std::string map_id;
    std::string map_name_id;
    std::string file_name;
    std::string texture_name_crc;
    bool show_area_texture = false;
};

struct DictionaryObservation {
    std::vector<int32_t> raw_vars;
};

// ── Music ──────────────────────────────────────────────────────────

struct ParsedMusic {
    std::string music_id;        // "0xABCD1234"
    int32_t index = 0;
    LocalizedNames names;
};

// ── Help ───────────────────────────────────────────────────────────

struct ParsedHelp {
    std::string help_id;
    std::string image;
    int32_t name_idx = 0;
    int32_t desc_idx = 0;
    LocalizedNames names;
    LocalizedNames descriptions;
};

// ── Inacode ────────────────────────────────────────────────────────

struct InacodeStamp {
    std::string id_crc;
    std::string img_name_crc;
    std::string img_path_crc;
};

struct ParsedInacode {
    std::vector<InacodeStamp> stamps;
    int32_t author_count  = 0;
    int32_t comment_count = 0;
    int32_t sticker_count = 0;
};

// ── NFC Lottery ────────────────────────────────────────────────────

struct NfcLotteryItem {
    std::string item_id;         // "0xABCD1234"
    int32_t type   = 0;
    int32_t weight = 0;
};

struct NfcLotteryTable {
    std::string table_id;        // "0xABCD1234"
    std::vector<NfcLotteryItem> items;
};

struct ParsedNfcLottery {
    std::string lottery_id;      // "0xABCD1234"
    std::vector<NfcLotteryTable> tables;
};

// ── Enjoy Mode Team ────────────────────────────────────────────────

struct ParsedEnjoyModeTeam {
    std::string team_id;         // "0xABCD1234"
    std::string sub_id;
    std::string color_crc;
    int32_t type = 0;
    std::string formation_crc;
    std::string texture_path;
    std::string texture_name;
};

// ── Team Build (DLC) ───────────────────────────────────────────────

struct TeamBuildEffectData {
    std::string effect_id;       // "0xABCD1234"
    int32_t threshold = 0;
    int32_t value     = 0;
    std::vector<std::string> conditions;  // Filtered for NULL_SENTINEL
};

struct TeamBuildUpDown {
    int32_t type        = 0;
    int32_t threshold   = 0;
    int32_t multiplier  = 0;
    int32_t cond_value1 = 0;
    int32_t cond_value2 = 0;
    std::string effect_ref_id;
    int32_t effect_count = 0;
};

struct ParsedTeamBuild {
    std::string build_id;        // "0xABCD1234"
    std::vector<TeamBuildEffectData> effects;
    std::vector<TeamBuildUpDown> up_data;
    std::vector<TeamBuildUpDown> down_data;
};

// ── Skill Technic ──────────────────────────────────────────────────

struct ParsedSkillTechnic {
    std::string id;
    std::string win_sub_motion_crc;
    std::string lose_sub_motion_crc;
    int32_t lose_type            = 0;
    int32_t formation_type       = 0;
    int32_t formation_chara_len  = 0;
    float shoot_curve_mid_rate   = 0.0f;
    float shoot_curve_height_rate= 0.0f;
    float shoot_curve_angle      = 0.0f;
};

// ── Real Skill ─────────────────────────────────────────────────────

struct RealSkillShootCourse {
    float target_rate          = 0.0f;
    bool is_ground_target      = false;
    float target_height_offset = 0.0f;
    float target_hori_offset   = 0.0f;
    float curve_rate           = 0.0f;
    float curve_height_rate    = 0.0f;
    float curve_angle          = 0.0f;
    float move_time_rate       = 0.0f;
};

struct ParsedRealSkill {
    std::string id;
    int32_t lose_type                    = 0;
    int32_t formation_type               = 0;
    int32_t formation_chara_len          = 0;
    int32_t shoot_limit_ball_height_attr = 0;
    std::string shoot_grounding_effect_name;
    float shoot_grounding_effect_interval_time = 0.0f;
    float shoot_grounding_effect_scale         = 0.0f;
    std::vector<RealSkillShootCourse> shoot_courses;
};

// ── Override Skill ─────────────────────────────────────────────────

struct OverrideConditionSkill {
    std::string skill_id;
    int32_t num = 0;             // Required count
};

struct OverrideCondition {
    int32_t condition_type = 0;  // 0=skill check, 2=team check
    std::vector<OverrideConditionSkill> skills;
};

struct ParsedOverrideSkill {
    std::string override_skill_id;   // "0xABCD1234"
    std::vector<OverrideCondition> conditions;
};

// ── Change Aura Skill ──────────────────────────────────────────────

struct ParsedChangeAuraSkill {
    std::string id;              // "0xABCD1234"
    std::string chara_param_id;  // "0xABCD1234" or "0x00000000"
};

// ── Boost Player Group ─────────────────────────────────────────────

struct BoostSpiritTable {
    int32_t index = 0;
    std::string spirit_crc;      // "0xABCD1234"
};

struct BoostPlayerGroupConfig {
    int32_t duration = 0;
    std::vector<int32_t> spirit_indices;
};

// ── Controllable Character ─────────────────────────────────────────

struct ParsedCtrlChara {
    std::string chara_param_id;  // "0xABCD1234"
    int32_t control_type = 0;
    int32_t flags        = 0;
};

// ── Super Tactics Base ─────────────────────────────────────────────

struct SuperTacticsEffect {
    std::string effect_id;       // "0xABCD1234"
    std::vector<std::string> conditions;  // Filtered for NULL_SENTINEL
};

struct ParsedSuperTacticsBase {
    std::string tactics_id;      // "0xABCD1234"
    std::vector<int32_t> raw_vars;
};

// ── Playstyle Entry ────────────────────────────────────────────────

struct PlaystyleEntry {
    int32_t play_style = 0;      // 0-5
    std::string name_en;
    std::string name_fr;
};

// ── Text Map ────────────────────────────────────────────────────────

/// Map hash → texte localise.
using TextMap = std::unordered_map<std::string, std::string>;

/// Map de textes pour toutes les locales.
struct MultiLocaleText {
    TextMap ja, en, fr, de, es, it, pt, zh_hans, zh_hant;

    /// Retourne la map pour une locale donnee.
    [[nodiscard]] const TextMap& get(const std::string& locale) const;

    /// Cherche un texte dans la locale donnee.
    [[nodiscard]] std::string find(const std::string& hash, const std::string& locale) const;
};

// ── Game Database ───────────────────────────────────────────────────

/// Base de donnees complete du jeu, chargee depuis les cfg.bin.
struct GameDatabase {
    // Domaines principaux
    std::vector<ParsedCharaParam> characters;
    std::vector<ParsedCharaBase> base_characters;
    std::vector<ParsedSkill> skills;
    std::vector<ParsedTeam> teams;
    std::vector<ParsedItem> items;
    std::vector<ParsedPassive> passives;
    std::vector<ParsedQuest> quests;
    std::vector<ParsedSpecialTactic> special_tactics;
    std::vector<ParsedFormation> formations;
    std::vector<ParsedShop> shops;
    std::vector<ParsedOpponentTeam> opponent_teams;

    // Personnages enrichis (construit apres chargement)
    std::vector<EnrichedCharacter> enriched_characters;

    // BASARA (personnages rang 20 avec builds)
    std::vector<BasaraCharacter> basara_characters;
    std::vector<BasaraBuildType> basara_build_types;
    std::unordered_map<std::string, size_t> basara_by_id; // charaParamId → index

    // Drop tables
    std::vector<DropTable> drop_tables;
    std::unordered_map<std::string, size_t> drop_table_by_id; // tableId → index
    // Index inverse : itemId → liste de (tableId, rate)
    std::unordered_map<std::string, std::vector<std::pair<std::string, int32_t>>> item_drop_sources;

    // Aura skills
    std::vector<ParsedAuraSkill> aura_skills;
    std::unordered_map<std::string, size_t> aura_by_id;

    // Tables de croissance
    std::vector<GrowthTableLv1> growth_lv1;
    std::vector<GrowthTableLv30> growth_lv30;
    std::vector<GrowthTableMain> growth_main;  // Lv50/99

    // Exp tables
    std::vector<ExpTableEntry> exp_table;        // 100 entries (lv1-99)
    std::vector<ExpRarityRate> exp_rarity_rates; // 9 entries

    // Nouveaux domaines
    std::vector<ParsedCostume> costumes;
    std::vector<ParsedUniform> uniforms;
    std::vector<ParsedSeries> series;
    std::vector<ParsedConstellation> constellations;
    std::vector<ParsedCapsule> capsules;
    std::vector<ParsedGallery> gallery;
    std::vector<ParsedTrick> tricks;
    std::vector<ParsedMission> missions;
    std::vector<ParsedTrophy> trophies;
    std::vector<DictionaryHabitat> dictionary_habitats;
    std::vector<DictionaryObservation> dictionary_observations;
    std::vector<ParsedMusic> music;
    std::vector<ParsedHelp> help;
    ParsedInacode inacode;
    std::vector<ParsedNfcLottery> nfc_lotteries;
    std::vector<ParsedEnjoyModeTeam> enjoy_mode_teams;
    std::vector<ParsedTeamBuild> team_builds;
    std::vector<ParsedSkillTechnic> skill_technics;
    std::vector<ParsedRealSkill> real_skills;
    std::vector<ParsedOverrideSkill> override_skills;
    std::vector<ParsedPassiveEffect> passive_effects;
    std::vector<ParsedChangeAuraSkill> change_aura_skills;
    std::vector<BoostSpiritTable> boost_spirit_tables;
    std::vector<BoostPlayerGroupConfig> boost_player_configs;
    std::vector<ParsedCtrlChara> ctrl_charas;
    std::vector<SuperTacticsEffect> super_tactics_effects;
    std::vector<ParsedSuperTacticsBase> super_tactics_base;
    std::vector<PlaystyleEntry> playstyles;

    // Index pour acces rapide
    std::unordered_map<std::string, size_t> chara_by_id;    // charaParamId → index
    std::unordered_map<std::string, size_t> skill_by_id;    // skillId → index
    std::unordered_map<std::string, size_t> team_by_id;     // teamId → index
    std::unordered_map<std::string, size_t> item_by_id;     // itemId → index
    std::unordered_map<std::string, size_t> passive_by_id;  // passiveId → index
    std::unordered_map<std::string, size_t> quest_by_id;    // questId → index
    std::unordered_map<std::string, size_t> tactic_by_id;   // tacticsId → index

    // Textes localises
    MultiLocaleText chara_text;
    MultiLocaleText skill_text;
    MultiLocaleText item_text;
    MultiLocaleText item_desc_text;   // item_explain (descriptions)
    MultiLocaleText team_text;
    MultiLocaleText passive_text;     // soccer_passive
    MultiLocaleText quest_text;       // quest_title
    MultiLocaleText formation_text;
    MultiLocaleText mission_text;
    MultiLocaleText trophy_text;
    MultiLocaleText music_text;
    MultiLocaleText help_text;
    MultiLocaleText menu_text;
    MultiLocaleText constellation_text; // players_universe
};

} // namespace iecode::gamedata
