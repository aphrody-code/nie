#include <gtest/gtest.h>

#include "iecode/formats/level5/cfgbin.h"

using namespace iecode::level5;

// ── Helpers ──────────────────────────────────────────────────────

/// Cree une entree racine simple pour les tests.
static CfgEntry make_root(const std::string& name) {
    CfgEntry root;
    root.name = name;
    root.crc32 = 0;
    return root;
}

// ── Tests cfgbin_add_entry ──────────────────────────────────────

TEST(CfgBinCrud, AddEntryCreatesChild) {
    auto root = make_root("ROOT");
    auto& child = cfgbin_add_entry(root, "CHILD_PARAM");

    ASSERT_EQ(root.children.size(), 1u);
    EXPECT_EQ(child.name, "CHILD_PARAM");
    EXPECT_NE(child.crc32, 0u); // CRC32 calcule automatiquement
    EXPECT_TRUE(child.variables.empty());
    EXPECT_TRUE(child.children.empty());
}

TEST(CfgBinCrud, AddMultipleEntries) {
    auto root = make_root("ROOT");
    cfgbin_add_entry(root, "A");
    cfgbin_add_entry(root, "B");
    cfgbin_add_entry(root, "C");

    ASSERT_EQ(root.children.size(), 3u);
    EXPECT_EQ(root.children[0].name, "A");
    EXPECT_EQ(root.children[1].name, "B");
    EXPECT_EQ(root.children[2].name, "C");
}

// ── Tests cfgbin_remove_entry ───────────────────────────────────

TEST(CfgBinCrud, RemoveEntryByName) {
    auto root = make_root("ROOT");
    cfgbin_add_entry(root, "KEEP");
    cfgbin_add_entry(root, "REMOVE_ME");
    cfgbin_add_entry(root, "ALSO_KEEP");

    EXPECT_TRUE(cfgbin_remove_entry(root, "REMOVE_ME"));
    ASSERT_EQ(root.children.size(), 2u);
    EXPECT_EQ(root.children[0].name, "KEEP");
    EXPECT_EQ(root.children[1].name, "ALSO_KEEP");
}

TEST(CfgBinCrud, RemoveEntryNotFound) {
    auto root = make_root("ROOT");
    cfgbin_add_entry(root, "EXISTS");

    EXPECT_FALSE(cfgbin_remove_entry(root, "NOT_HERE"));
    EXPECT_EQ(root.children.size(), 1u);
}

TEST(CfgBinCrud, RemoveEntryMatchesSuffixedName) {
    // Les entrees parsees ont un suffixe _N (ex: "PARAM_0")
    auto root = make_root("ROOT");
    CfgEntry child;
    child.name = "PARAM_0"; // Suffixe d'index
    root.children.push_back(child);

    // Recherche par nom de base "PARAM" doit matcher "PARAM_0"
    EXPECT_TRUE(cfgbin_remove_entry(root, "PARAM"));
    EXPECT_TRUE(root.children.empty());
}

// ── Tests cfgbin_find_entry ─────────────────────────────────────

TEST(CfgBinCrud, FindEntryDirect) {
    auto root = make_root("ROOT");
    cfgbin_add_entry(root, "TARGET");
    cfgbin_add_entry(root, "OTHER");

    auto* found = cfgbin_find_entry(root, "TARGET");
    ASSERT_NE(found, nullptr);
    EXPECT_EQ(found->name, "TARGET");
}

TEST(CfgBinCrud, FindEntryNotFound) {
    auto root = make_root("ROOT");
    cfgbin_add_entry(root, "SOMETHING");

    EXPECT_EQ(cfgbin_find_entry(root, "MISSING"), nullptr);
}

TEST(CfgBinCrud, FindEntryRecursive) {
    auto root = make_root("ROOT");
    auto& level1 = cfgbin_add_entry(root, "LEVEL1");
    cfgbin_add_entry(level1, "DEEP_TARGET");

    // Sans recursion — pas trouve
    EXPECT_EQ(cfgbin_find_entry(root, "DEEP_TARGET", false), nullptr);

    // Avec recursion — trouve
    auto* found = cfgbin_find_entry(root, "DEEP_TARGET", true);
    ASSERT_NE(found, nullptr);
    EXPECT_EQ(found->name, "DEEP_TARGET");
}

TEST(CfgBinCrud, FindEntryConst) {
    auto root = make_root("ROOT");
    cfgbin_add_entry(root, "CONST_TARGET");

    const auto& cref = root;
    const auto* found = cfgbin_find_entry(cref, "CONST_TARGET");
    ASSERT_NE(found, nullptr);
    EXPECT_EQ(found->name, "CONST_TARGET");
}

// ── Tests cfgbin_add_field ──────────────────────────────────────

TEST(CfgBinCrud, AddFieldInt) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "health", CfgVarType::Int, 100);

    ASSERT_EQ(entry.variables.size(), 1u);
    EXPECT_EQ(entry.variables[0].name, "health");
    EXPECT_EQ(entry.variables[0].type, CfgVarType::Int);

    const auto* val = std::get_if<int32_t>(&entry.variables[0].value);
    ASSERT_NE(val, nullptr);
    EXPECT_EQ(*val, 100);
}

TEST(CfgBinCrud, AddFieldString) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "label", CfgVarType::String, std::string("hello"));

    ASSERT_EQ(entry.variables.size(), 1u);
    EXPECT_EQ(entry.variables[0].type, CfgVarType::String);

    const auto* val = std::get_if<std::string>(&entry.variables[0].value);
    ASSERT_NE(val, nullptr);
    EXPECT_EQ(*val, "hello");
}

TEST(CfgBinCrud, AddFieldFloat) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "speed", CfgVarType::Float, 3.14f);

    ASSERT_EQ(entry.variables.size(), 1u);

    const auto* val = std::get_if<float>(&entry.variables[0].value);
    ASSERT_NE(val, nullptr);
    EXPECT_FLOAT_EQ(*val, 3.14f);
}

// ── Tests cfgbin_remove_field ───────────────────────────────────

TEST(CfgBinCrud, RemoveFieldValid) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "a", CfgVarType::Int, 1);
    cfgbin_add_field(entry, "b", CfgVarType::Int, 2);
    cfgbin_add_field(entry, "c", CfgVarType::Int, 3);

    EXPECT_TRUE(cfgbin_remove_field(entry, 1)); // Supprime "b"
    ASSERT_EQ(entry.variables.size(), 2u);
    EXPECT_EQ(entry.variables[0].name, "a");
    EXPECT_EQ(entry.variables[1].name, "c");
}

TEST(CfgBinCrud, RemoveFieldOutOfBounds) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "only", CfgVarType::Int, 42);

    EXPECT_FALSE(cfgbin_remove_field(entry, 5));
    EXPECT_EQ(entry.variables.size(), 1u);
}

// ── Tests cfgbin_set_field ──────────────────────────────────────

TEST(CfgBinCrud, SetFieldUpdatesExisting) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "hp", CfgVarType::Int, 100);

    EXPECT_TRUE(cfgbin_set_field(entry, "hp", 999));

    const auto* val = std::get_if<int32_t>(&entry.variables[0].value);
    ASSERT_NE(val, nullptr);
    EXPECT_EQ(*val, 999);
}

TEST(CfgBinCrud, SetFieldNotFound) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "exists", CfgVarType::Int, 1);

    EXPECT_FALSE(cfgbin_set_field(entry, "nope", 42));
}

// ── Tests cfgbin_find_field ─────────────────────────────────────

TEST(CfgBinCrud, FindFieldFound) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "target", CfgVarType::Float, 2.5f);
    cfgbin_add_field(entry, "other", CfgVarType::Int, 0);

    auto* val = cfgbin_find_field(entry, "target");
    ASSERT_NE(val, nullptr);

    const auto* fval = std::get_if<float>(val);
    ASSERT_NE(fval, nullptr);
    EXPECT_FLOAT_EQ(*fval, 2.5f);
}

TEST(CfgBinCrud, FindFieldNotFound) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "present", CfgVarType::Int, 1);

    EXPECT_EQ(cfgbin_find_field(entry, "absent"), nullptr);
}

TEST(CfgBinCrud, FindFieldConst) {
    auto entry = make_root("ENTRY");
    cfgbin_add_field(entry, "val", CfgVarType::Int, 42);

    const auto& cref = entry;
    const auto* val = cfgbin_find_field(cref, "val");
    ASSERT_NE(val, nullptr);

    const auto* ival = std::get_if<int32_t>(val);
    ASSERT_NE(ival, nullptr);
    EXPECT_EQ(*ival, 42);
}

// ── Test integration — arbre complet ────────────────────────────

TEST(CfgBinCrud, FullTreeManipulation) {
    // Construire un petit arbre cfg.bin programmatiquement
    CfgEntry root;
    root.name = "CONFIG_BEG_0";
    root.crc32 = 0;
    root.end_terminator = true;

    auto& player = cfgbin_add_entry(root, "PLAYER_PARAM");
    cfgbin_add_field(player, "name", CfgVarType::String, std::string("Endou"));
    cfgbin_add_field(player, "level", CfgVarType::Int, 50);
    cfgbin_add_field(player, "speed", CfgVarType::Float, 75.0f);

    auto& skill = cfgbin_add_entry(root, "SKILL_PARAM");
    cfgbin_add_field(skill, "power", CfgVarType::Int, 200);

    // Verifier la structure
    ASSERT_EQ(root.children.size(), 2u);

    // Chercher et modifier
    auto* found_player = cfgbin_find_entry(root, "PLAYER_PARAM");
    ASSERT_NE(found_player, nullptr);

    EXPECT_TRUE(cfgbin_set_field(*found_player, "level", 99));
    auto* level_val = cfgbin_find_field(*found_player, "level");
    ASSERT_NE(level_val, nullptr);
    EXPECT_EQ(std::get<int32_t>(*level_val), 99);

    // Supprimer un champ
    EXPECT_TRUE(cfgbin_remove_field(*found_player, 2)); // "speed"
    EXPECT_EQ(found_player->variables.size(), 2u);

    // Supprimer une entree
    EXPECT_TRUE(cfgbin_remove_entry(root, "SKILL_PARAM"));
    EXPECT_EQ(root.children.size(), 1u);
}
