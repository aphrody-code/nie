/// @file test_gds.cpp
/// Tests du systeme GDS (Game Data System) et GDD (Game Data Dictionary).

#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include "iecode/game/gdd/gdd_chara.h"
#include "iecode/game/gdd/gdd_inventory.h"
#include "iecode/game/gds/chara/gds_chara_base.h"
#include "iecode/game/gds/chara/gds_chara_config.h"
#include "iecode/game/gds/gds_table.h"
#include "iecode/game/gds/event/gds_event_config.h"
#include "iecode/game/gds/event/gds_event_talk.h"
#include "iecode/game/gds/map/gds_map_config.h"
#include "iecode/game/gds/skill/gds_skill_config.h"
#include "iecode/game/gds/soccer/gds_soccer_config.h"

// ── Declarations des fonctions de chargement (definies dans les .cpp) ──

namespace game {
[[nodiscard]] std::vector<GDSCharaBase> load_chara_base_list(const nlohmann::json& cfg_data);
[[nodiscard]] std::vector<GDSCharaParam> load_chara_param_list(const nlohmann::json& cfg_data);
[[nodiscard]] std::vector<GDSCharaDetailsConfig> load_chara_details_list(const nlohmann::json& cfg_data);
[[nodiscard]] std::vector<GDSSkillConfig> load_skill_config_list(const nlohmann::json& cfg_data);
[[nodiscard]] std::vector<GDSAbilityLearningConfig> load_ability_learning_list(const nlohmann::json& cfg_data);
[[nodiscard]] std::vector<GDSMapConfig> load_map_config_list(const nlohmann::json& cfg_data);
[[nodiscard]] std::vector<GDSSoccerGameConfig> load_soccer_game_config_list(const nlohmann::json& cfg_data);
[[nodiscard]] std::vector<GDSEventPlayConfig> load_event_play_config_list(const nlohmann::json& cfg_data);
[[nodiscard]] std::vector<GDSEventBustupTalkConfig> load_event_bustup_talk_list(const nlohmann::json& cfg_data);

// GDD fonctions utilitaires
[[nodiscard]] uint32_t add_experience(CGDDChara& chara, uint32_t amount, const std::array<uint32_t, 99>& exp_table);
[[nodiscard]] bool equip_skill(CGDDChara& chara, uint32_t slot, uint32_t skill_id);
void unequip_skill(CGDDChara& chara, uint32_t slot);
[[nodiscard]] bool has_skill_equipped(const CGDDChara& chara, uint32_t skill_id);
[[nodiscard]] CGDDChara* find_chara(CGDDCharaCollection& collection, uint32_t chara_id);
[[nodiscard]] bool add_chara(CGDDCharaCollection& collection, CGDDChara chara);

// Inventaire
[[nodiscard]] uint32_t add_item(std::vector<InventorySlot>& items, uint32_t item_id, uint32_t quantity, uint32_t max_stack, uint32_t max_slots);
[[nodiscard]] uint32_t remove_item(std::vector<InventorySlot>& items, uint32_t item_id, uint32_t quantity);
[[nodiscard]] uint32_t count_item(const std::vector<InventorySlot>& items, uint32_t item_id);
[[nodiscard]] bool has_item(const std::vector<InventorySlot>& items, uint32_t item_id, uint32_t quantity);
void sort_by_id(std::vector<InventorySlot>& items);
void sort_by_quantity(std::vector<InventorySlot>& items);
void mark_all_seen(std::vector<InventorySlot>& items);
[[nodiscard]] uint32_t used_slots(const std::vector<InventorySlot>& items);
[[nodiscard]] uint32_t total_quantity(const std::vector<InventorySlot>& items);
} // namespace game

// ── GDSCharaBase ────────────────────────────────────────────────────

TEST(GDSCharaBase, LoadFromJson) {
    nlohmann::json data;
    data["CHARA_BASE_INFO"] = nlohmann::json::array({
        {{"chara_id", 1}, {"name_hash", 0x12345678}, {"name_key", "hero_001"},
         {"element", 0}, {"position", 0}, {"rarity", 3}, {"series_id", 1}, {"is_playable", true}},
        {{"chara_id", 2}, {"name_hash", 0xABCDEF00}, {"name_key", "rival_001"},
         {"element", 1}, {"position", 1}, {"rarity", 4}, {"series_id", 1}, {"is_playable", true}},
    });

    auto bases = game::load_chara_base_list(data);
    ASSERT_EQ(bases.size(), 2);

    EXPECT_EQ(bases[0].chara_id, 1);
    EXPECT_EQ(bases[0].name_hash.value, 0x12345678u);
    EXPECT_EQ(bases[0].name_key, "hero_001");
    EXPECT_EQ(bases[0].element, game::Element::Fire);
    EXPECT_EQ(bases[0].position, game::Position::FW);
    EXPECT_EQ(bases[0].rarity, game::Rarity::SR);
    EXPECT_TRUE(bases[0].is_playable);

    EXPECT_EQ(bases[1].chara_id, 2);
    EXPECT_EQ(bases[1].element, game::Element::Wind);
    EXPECT_EQ(bases[1].position, game::Position::MF);
}

TEST(GDSCharaBase, LoadMissingKey) {
    nlohmann::json data;  // Pas de cle CHARA_BASE_INFO
    auto bases = game::load_chara_base_list(data);
    EXPECT_TRUE(bases.empty());
}

TEST(GDSCharaBase, LoadInvalidType) {
    nlohmann::json data;
    data["CHARA_BASE_INFO"] = "not_an_array";
    auto bases = game::load_chara_base_list(data);
    EXPECT_TRUE(bases.empty());
}

// ── GDSCharaParam ───────────────────────────────────────────────────

TEST(GDSCharaParam, LoadFromJson) {
    nlohmann::json data;
    data["CHARA_PARAM_INFO"] = nlohmann::json::array({
        {{"chara_id", 1}, {"kick", 80}, {"guard", 60}, {"catch", 40},
         {"body", 70}, {"control", 75}, {"speed", 85}, {"stamina", 55}, {"luck", 30}},
    });

    auto params = game::load_chara_param_list(data);
    ASSERT_EQ(params.size(), 1);
    EXPECT_EQ(params[0].kick, 80);
    EXPECT_EQ(params[0].speed, 85);
    EXPECT_EQ(params[0].luck, 30);
}

// ── GDSCharaDetailsConfig ───────────────────────────────────────────

TEST(GDSCharaDetails, LoadFromJson) {
    nlohmann::json data;
    data["CHARA_DETAILS_CONFIG"] = nlohmann::json::array({
        {{"chara_id", 1}, {"bio_key", "bio_hero"}, {"height", 160},
         {"weight", 55}, {"birth_month", 3}, {"birth_day", 14}},
    });

    auto details = game::load_chara_details_list(data);
    ASSERT_EQ(details.size(), 1);
    EXPECT_EQ(details[0].height, 160);
    EXPECT_EQ(details[0].birth_month, 3);
}

// ── GDSSkillConfig ──────────────────────────────────────────────────

TEST(GDSSkillConfig, LoadFromJson) {
    nlohmann::json data;
    data["SKILL_CONFIG"] = nlohmann::json::array({
        {{"skill_id", 100}, {"name_hash", 0x11111111}, {"name_key", "fire_tornado"},
         {"desc_key", "desc_fire_tornado"}, {"type", 0}, {"tp_cost", 30},
         {"element", 0}, {"power", 90}, {"is_unlock", true}},
        {{"skill_id", 200}, {"name_hash", 0x22222222}, {"name_key", "god_hand"},
         {"desc_key", "desc_god_hand"}, {"type", 0}, {"tp_cost", 25},
         {"element", 2}, {"power", 85}, {"is_unlock", false}},
    });

    auto skills = game::load_skill_config_list(data);
    ASSERT_EQ(skills.size(), 2);
    EXPECT_EQ(skills[0].name_key, "fire_tornado");
    EXPECT_EQ(skills[0].tp_cost, 30);
    EXPECT_EQ(skills[0].power, 90);
    EXPECT_TRUE(skills[0].is_unlock);

    EXPECT_EQ(skills[1].element, game::Element::Earth);
    EXPECT_FALSE(skills[1].is_unlock);
}

// ── GDSAbilityLearningConfig ────────────────────────────────────────

TEST(GDSAbilityLearning, LoadFromJson) {
    nlohmann::json data;
    data["ABILITY_LEARNING_CONFIG"] = nlohmann::json::array({
        {{"chara_id", 1}, {"skill_id", 100}, {"learn_level", 15}},
        {{"chara_id", 1}, {"skill_id", 200}, {"learn_level", 30}},
    });

    auto learning = game::load_ability_learning_list(data);
    ASSERT_EQ(learning.size(), 2);
    EXPECT_EQ(learning[0].learn_level, 15);
    EXPECT_EQ(learning[1].learn_level, 30);
}

// ── GDSMapConfig ────────────────────────────────────────────────────

TEST(GDSMapConfig, LoadFromJson) {
    nlohmann::json data;
    data["MAP_CONFIG"] = nlohmann::json::array({
        {{"map_id", 1}, {"name_hash", 0x33333333}, {"name_key", "raimon_school"},
         {"field_id", 10}, {"is_indoor", false}},
    });

    auto maps = game::load_map_config_list(data);
    ASSERT_EQ(maps.size(), 1);
    EXPECT_EQ(maps[0].name_key, "raimon_school");
    EXPECT_FALSE(maps[0].is_indoor);
}

// ── GDSSoccerGameConfig ─────────────────────────────────────────────

TEST(GDSSoccerConfig, LoadFromJson) {
    nlohmann::json data;
    data["SOCCER_GAME_CONFIG"] = nlohmann::json::array({
        {{"config_id", 1}, {"match_duration", 300}, {"overtime_sec", 60},
         {"ball_gravity", 2.0f}, {"max_players", 58}, {"field_size", 1}},
    });

    auto configs = game::load_soccer_game_config_list(data);
    ASSERT_EQ(configs.size(), 1);
    EXPECT_EQ(configs[0].match_duration, 300u);
    EXPECT_FLOAT_EQ(configs[0].ball_gravity, 2.f);
    EXPECT_EQ(configs[0].max_players, 58u);
}

TEST(GDSSoccerConfig, DefaultValues) {
    game::GDSSoccerGameConfig cfg;
    EXPECT_FLOAT_EQ(cfg.ball_gravity, 2.f);
    EXPECT_EQ(cfg.max_players, 58u);
}

// ── GDSEventPlayConfig ──────────────────────────────────────────────

TEST(GDSEventConfig, LoadFromJson) {
    nlohmann::json data;
    data["EVENT_PLAY_CONFIG"] = nlohmann::json::array({
        {{"event_id", 1}, {"script_key", "opening_event"}, {"map_id", 5},
         {"chapter", 1}, {"is_skippable", false}},
    });

    auto events = game::load_event_play_config_list(data);
    ASSERT_EQ(events.size(), 1);
    EXPECT_EQ(events[0].script_key, "opening_event");
    EXPECT_FALSE(events[0].is_skippable);
}

// ── GDSEventBustupTalkConfig ────────────────────────────────────────

TEST(GDSEventTalk, LoadFromJson) {
    nlohmann::json data;
    data["EVENT_BUSTUP_TALK_CONFIG"] = nlohmann::json::array({
        {{"talk_id", 1}, {"chara_id", 100}, {"bust_hash", 0x44444444},
         {"text_key", "dialog_001"}, {"expression", 1}, {"is_left", true}},
    });

    auto talks = game::load_event_bustup_talk_list(data);
    ASSERT_EQ(talks.size(), 1);
    EXPECT_EQ(talks[0].text_key, "dialog_001");
    EXPECT_EQ(talks[0].expression, 1);
    EXPECT_TRUE(talks[0].is_left);
}

// ── GDD — CGDDChara ─────────────────────────────────────────────────

TEST(GDDChara, AddExperience) {
    game::CGDDChara chara;
    chara.chara_id = 1;
    chara.level = 1;
    chara.exp = 0;

    // Table simple : chaque niveau coute 100 exp
    std::array<uint32_t, 99> exp_table = {};
    for (auto& e : exp_table) { e = 100; }

    uint32_t levels = game::add_experience(chara, 250, exp_table);
    EXPECT_EQ(levels, 2);       // 250 / 100 = 2 niveaux + 50 restant
    EXPECT_EQ(chara.level, 3u);
    EXPECT_EQ(chara.exp, 50u);
}

TEST(GDDChara, AddExperienceMaxLevel) {
    game::CGDDChara chara;
    chara.level = 98;
    chara.exp = 0;

    std::array<uint32_t, 99> exp_table = {};
    for (auto& e : exp_table) { e = 100; }

    (void)game::add_experience(chara, 500, exp_table);
    EXPECT_EQ(chara.level, 99u);  // Cap a 99
}

TEST(GDDChara, EquipSkill) {
    game::CGDDChara chara;
    EXPECT_TRUE(game::equip_skill(chara, 0, 1000));
    EXPECT_TRUE(game::has_skill_equipped(chara, 1000));

    // Deja equipee dans un autre slot
    EXPECT_FALSE(game::equip_skill(chara, 1, 1000));

    // Slot hors limites
    EXPECT_FALSE(game::equip_skill(chara, 99, 2000));
}

TEST(GDDChara, UnequipSkill) {
    game::CGDDChara chara;
    (void)game::equip_skill(chara, 0, 1000);
    game::unequip_skill(chara, 0);
    EXPECT_FALSE(game::has_skill_equipped(chara, 1000));
}

TEST(GDDChara, FindInCollection) {
    game::CGDDCharaCollection collection;
    game::CGDDChara c1;
    c1.chara_id = 1;
    c1.level = 10;
    (void)game::add_chara(collection, c1);

    auto* found = game::find_chara(collection, 1);
    ASSERT_NE(found, nullptr);
    EXPECT_EQ(found->level, 10u);

    auto* not_found = game::find_chara(collection, 999);
    EXPECT_EQ(not_found, nullptr);
}

TEST(GDDChara, AddCharaDuplicate) {
    game::CGDDCharaCollection collection;
    game::CGDDChara c1;
    c1.chara_id = 1;
    EXPECT_TRUE(game::add_chara(collection, c1));
    EXPECT_FALSE(game::add_chara(collection, c1));  // Doublon
}

// ── GDD — Inventaire ────────────────────────────────────────────────

TEST(GDDInventory, AddItem) {
    std::vector<game::InventorySlot> items;
    uint32_t added = game::add_item(items, 100, 5, 99, 999);
    EXPECT_EQ(added, 5u);
    EXPECT_EQ(game::count_item(items, 100), 5u);
    EXPECT_TRUE(game::has_item(items, 100, 5));
}

TEST(GDDInventory, AddItemStack) {
    std::vector<game::InventorySlot> items;
    (void)game::add_item(items, 100, 50, 99, 999);
    (void)game::add_item(items, 100, 30, 99, 999);
    EXPECT_EQ(game::count_item(items, 100), 80u);
    EXPECT_EQ(game::used_slots(items), 1u);  // Empile dans le meme slot
}

TEST(GDDInventory, AddItemOverflow) {
    std::vector<game::InventorySlot> items;
    (void)game::add_item(items, 100, 120, 99, 999);
    EXPECT_EQ(game::count_item(items, 100), 120u);
    EXPECT_EQ(game::used_slots(items), 2u);  // 99 + 21
}

TEST(GDDInventory, AddItemMaxSlots) {
    std::vector<game::InventorySlot> items;
    // Remplir 2 slots max
    uint32_t added = game::add_item(items, 100, 50, 99, 2);
    EXPECT_EQ(added, 50u);

    added = game::add_item(items, 200, 50, 99, 2);
    EXPECT_EQ(added, 50u);

    // Plus de slots
    added = game::add_item(items, 300, 50, 99, 2);
    EXPECT_EQ(added, 0u);
}

TEST(GDDInventory, RemoveItem) {
    std::vector<game::InventorySlot> items;
    (void)game::add_item(items, 100, 10, 99, 999);
    uint32_t removed = game::remove_item(items, 100, 3);
    EXPECT_EQ(removed, 3u);
    EXPECT_EQ(game::count_item(items, 100), 7u);
}

TEST(GDDInventory, RemoveItemPartial) {
    std::vector<game::InventorySlot> items;
    (void)game::add_item(items, 100, 5, 99, 999);
    uint32_t removed = game::remove_item(items, 100, 10);
    EXPECT_EQ(removed, 5u);  // Seulement 5 disponibles
    EXPECT_EQ(game::count_item(items, 100), 0u);
    EXPECT_EQ(game::used_slots(items), 0u);  // Slot nettoye
}

TEST(GDDInventory, RemoveNonExistentItem) {
    std::vector<game::InventorySlot> items;
    uint32_t removed = game::remove_item(items, 999, 5);
    EXPECT_EQ(removed, 0u);
}

TEST(GDDInventory, SortById) {
    std::vector<game::InventorySlot> items;
    (void)game::add_item(items, 300, 1, 99, 999);
    (void)game::add_item(items, 100, 1, 99, 999);
    (void)game::add_item(items, 200, 1, 99, 999);

    game::sort_by_id(items);
    EXPECT_EQ(items[0].item_id, 100u);
    EXPECT_EQ(items[1].item_id, 200u);
    EXPECT_EQ(items[2].item_id, 300u);
}

TEST(GDDInventory, SortByQuantity) {
    std::vector<game::InventorySlot> items;
    (void)game::add_item(items, 100, 5, 99, 999);
    (void)game::add_item(items, 200, 20, 99, 999);
    (void)game::add_item(items, 300, 10, 99, 999);

    game::sort_by_quantity(items);
    EXPECT_EQ(items[0].quantity, 20u);
    EXPECT_EQ(items[1].quantity, 10u);
    EXPECT_EQ(items[2].quantity, 5u);
}

TEST(GDDInventory, MarkAllSeen) {
    std::vector<game::InventorySlot> items;
    (void)game::add_item(items, 100, 1, 99, 999);
    (void)game::add_item(items, 200, 1, 99, 999);

    EXPECT_TRUE(items[0].is_new);
    game::mark_all_seen(items);
    EXPECT_FALSE(items[0].is_new);
    EXPECT_FALSE(items[1].is_new);
}

TEST(GDDInventory, TotalQuantity) {
    std::vector<game::InventorySlot> items;
    (void)game::add_item(items, 100, 10, 99, 999);
    (void)game::add_item(items, 200, 20, 99, 999);
    EXPECT_EQ(game::total_quantity(items), 30u);
}

TEST(GDDInventory, AddItemZeroId) {
    std::vector<game::InventorySlot> items;
    uint32_t added = game::add_item(items, 0, 5, 99, 999);
    EXPECT_EQ(added, 0u);
}

TEST(GDDInventory, AddItemZeroQuantity) {
    std::vector<game::InventorySlot> items;
    uint32_t added = game::add_item(items, 100, 0, 99, 999);
    EXPECT_EQ(added, 0u);
}

// ── GDS CFG_KEY ─────────────────────────────────────────────────────

TEST(GDSTypes, CfgKeys) {
    // Verifier que les cles CFG_KEY sont definies et coherentes.
    EXPECT_EQ(game::GDSCharaBase::CFG_KEY, "CHARA_BASE_INFO");
    EXPECT_EQ(game::GDSCharaParam::CFG_KEY, "CHARA_PARAM_INFO");
    EXPECT_EQ(game::GDSSkillConfig::CFG_KEY, "SKILL_CONFIG");
    EXPECT_EQ(game::GDSMapConfig::CFG_KEY, "MAP_CONFIG");
    EXPECT_EQ(game::GDSSoccerGameConfig::CFG_KEY, "SOCCER_GAME_CONFIG");
    EXPECT_EQ(game::GDSEventPlayConfig::CFG_KEY, "EVENT_PLAY_CONFIG");
}

// ── GDSTable<T> ─────────────────────────────────────────────────────

TEST(GDSTable, AssignSortsByCharaId) {
    game::GDSTable<game::GDSCharaParam> table;
    std::vector<game::GDSCharaParam> rows = {
        {.chara_id = 30, .kick = 70},
        {.chara_id = 10, .kick = 50},
        {.chara_id = 20, .kick = 60},
    };
    table.assign(std::move(rows));
    ASSERT_EQ(table.size(), 3u);
    EXPECT_EQ(table.all()[0].chara_id, 10u);
    EXPECT_EQ(table.all()[1].chara_id, 20u);
    EXPECT_EQ(table.all()[2].chara_id, 30u);
}

TEST(GDSTable, FindByIdBinarySearch) {
    game::GDSTable<game::GDSCharaParam> table;
    table.assign({
        {.chara_id = 1,   .kick = 10},
        {.chara_id = 42,  .kick = 80},
        {.chara_id = 100, .kick = 99},
    });

    const auto* hit = table.find_by_id(42);
    ASSERT_NE(hit, nullptr);
    EXPECT_EQ(hit->kick, 80);

    EXPECT_EQ(table.find_by_id(7), nullptr);
    EXPECT_EQ(table.find_by_id(0), nullptr);
}

TEST(GDSTable, EmptyByDefault) {
    game::GDSTable<game::GDSCharaParam> table;
    EXPECT_TRUE(table.empty());
    EXPECT_EQ(table.size(), 0u);
    EXPECT_EQ(table.find_by_id(1), nullptr);
}

// ── GDD Serialize ───────────────────────────────────────────────────

TEST(GDDSerialize, TypeNames) {
    game::CGDDChara chara;
    EXPECT_EQ(chara.gdd_type_name(), "CGDDChara");

    game::CGDDCharaCollection collection;
    EXPECT_EQ(collection.gdd_type_name(), "CGDDCharaCollection");

    game::CGDDHeaderData header;
    EXPECT_EQ(header.gdd_type_name(), "CGDDHeaderData");

    game::CGDDInventoryConsume inv;
    EXPECT_EQ(inv.gdd_type_name(), "CGDDInventoryConsume");
}
