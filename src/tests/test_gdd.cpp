/// @file test_gdd.cpp
/// Tests des wrappers GDD haut niveau (party, inventory, quetes, save).

#include "iecode/game/gdd/gdd_save.h"

#include <gtest/gtest.h>

#include <filesystem>

using namespace game;

TEST(GDD, RoundtripParty) {
    GDDParty p;
    p.player_ids[0] = 101;
    p.player_ids[1] = 202;
    p.player_ids[2] = 303;
    p.active_count  = 3;
    p.captain_id    = 101;

    const auto j  = p.to_json();
    const auto p2 = GDDParty::from_json(j);

    EXPECT_EQ(p2.active_count, 3u);
    EXPECT_EQ(p2.captain_id, 101u);
    EXPECT_EQ(p2.player_ids[0], 101u);
    EXPECT_EQ(p2.player_ids[1], 202u);
    EXPECT_EQ(p2.player_ids[2], 303u);
    EXPECT_EQ(p2.player_ids[3], 0u);
}

TEST(GDD, InventoryAdd) {
    GDDInventory inv;
    inv.add_item(1, 5);
    inv.add_item(1, 3);
    inv.add_item(2, 1);
    inv.gold = 1500;

    EXPECT_EQ(inv.items[1], 8u);
    EXPECT_EQ(inv.items[2], 1u);

    EXPECT_TRUE(inv.remove_item(1, 5));
    EXPECT_EQ(inv.items[1], 3u);

    EXPECT_FALSE(inv.remove_item(1, 999));
    EXPECT_TRUE(inv.remove_item(2, 1));
    EXPECT_EQ(inv.items.count(2), 0u);

    // Roundtrip JSON
    const auto j   = inv.to_json();
    const auto inv2 = GDDInventory::from_json(j);
    EXPECT_EQ(inv2.gold, 1500u);
    EXPECT_EQ(inv2.items.at(1), 3u);
}

TEST(GDD, QuestLog) {
    GDDQuestLog log;
    log.start_quest(42);
    EXPECT_EQ(log.quests.size(), 1u);
    EXPECT_EQ(log.quests[0].status, GDDQuestLog::Status::IN_PROGRESS);

    log.advance_quest(42);
    log.advance_quest(42);
    EXPECT_EQ(log.quests[0].step, 2u);

    log.complete_quest(42);
    EXPECT_EQ(log.quests[0].status, GDDQuestLog::Status::COMPLETED);

    // Quete inconnue : complete_quest doit l'ajouter
    log.complete_quest(99);
    EXPECT_EQ(log.quests.size(), 2u);

    // Roundtrip JSON
    const auto j    = log.to_json();
    const auto log2 = GDDQuestLog::from_json(j);
    ASSERT_EQ(log2.quests.size(), 2u);
    EXPECT_EQ(log2.quests[0].id, 42u);
    EXPECT_EQ(log2.quests[0].status, GDDQuestLog::Status::COMPLETED);
    EXPECT_EQ(log2.quests[0].step, 2u);
}

TEST(GDD, SaveRoundtripFile) {
    GDDSave s;
    s.save_name = "test_slot_01";
    s.chapter   = 5;
    s.party.active_count = 1;
    s.party.player_ids[0] = 777;
    s.party.captain_id = 777;
    s.inventory.add_item(10, 4);
    s.inventory.gold = 2000;
    s.quests.start_quest(1);

    const auto path = std::filesystem::temp_directory_path() / "iecode_gdd_test.json";
    ASSERT_TRUE(s.save_to_file(path));

    auto loaded = GDDSave::load_from_file(path);
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->save_name, "test_slot_01");
    EXPECT_EQ(loaded->chapter, 5u);
    EXPECT_EQ(loaded->party.captain_id, 777u);
    EXPECT_EQ(loaded->inventory.gold, 2000u);
    EXPECT_EQ(loaded->inventory.items.at(10), 4u);
    ASSERT_EQ(loaded->quests.quests.size(), 1u);
    EXPECT_EQ(loaded->quests.quests[0].id, 1u);

    std::filesystem::remove(path);
}
