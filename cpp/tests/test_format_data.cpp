/// @file test_format_data.cpp
/// Tests des structures de donnees : G4TX, G4MG, CfgBin, modding.

#include <gtest/gtest.h>

#include "iecode/formats/level5/g4tx.h"
#include "iecode/formats/level5/g4mg.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/modding/mod_info.h"
#include "iecode/modding/mod_conflict_detector.h"

#include <variant>
#include <string>

// ── Tests G4TX (donnees pour TextureViewer) ────────────────────────

TEST(EditorWidgetDataTest, G4txTextureDefaultConstruction) {
    iecode::level5::G4txTexture tex;
    EXPECT_EQ(tex.id, 0);
    EXPECT_EQ(tex.width, 0);
    EXPECT_EQ(tex.height, 0);
    EXPECT_EQ(tex.format, iecode::level5::G4txFormat::Unknown);
    EXPECT_EQ(tex.mip_count, 1);
    EXPECT_FALSE(tex.is_dds);
    EXPECT_TRUE(tex.data.empty());
    EXPECT_TRUE(tex.sub_textures.empty());
}

TEST(EditorWidgetDataTest, G4txFileDefaultConstruction) {
    iecode::level5::G4txFile file;
    EXPECT_EQ(file.version, 0u);
    EXPECT_TRUE(file.textures.empty());
}

// ── Tests G4MG (donnees pour ModelViewer) ──────────────────────────

TEST(EditorWidgetDataTest, G4mgVertexStride) {
    using iecode::level5::VertexFormatFlags;
    using iecode::level5::vertex_stride;

    // Position seule : 12 octets
    EXPECT_EQ(vertex_stride(VertexFormatFlags::POSITION), 12u);

    // Position + Normal + UV0 : 12 + 12 + 8 = 32
    const auto flags = VertexFormatFlags::POSITION
                     | VertexFormatFlags::NORMAL
                     | VertexFormatFlags::UV0;
    EXPECT_EQ(vertex_stride(flags), 32u);

    // Tous les attributs
    const auto all = VertexFormatFlags::POSITION
                   | VertexFormatFlags::BONE_WEIGHTS
                   | VertexFormatFlags::BONE_INDICES
                   | VertexFormatFlags::NORMAL
                   | VertexFormatFlags::UV0
                   | VertexFormatFlags::UV1
                   | VertexFormatFlags::COLOR
                   | VertexFormatFlags::TANGENT
                   | VertexFormatFlags::BINORMAL;
    // 12 + 4 + 4 + 12 + 8 + 8 + 4 + 12 + 12 = 76
    EXPECT_EQ(vertex_stride(all), 76u);
}

TEST(EditorWidgetDataTest, G4mgHeaderDefault) {
    iecode::level5::G4mgHeader header;
    EXPECT_EQ(header.magic, 0u);
    EXPECT_EQ(header.mesh_count, 0);
    EXPECT_EQ(header.sub_mesh_count, 0);
    EXPECT_FALSE(header.is_big_endian);
}

// ── Tests CfgBin (donnees pour CfgBinEditor) ──────────────────────

TEST(EditorWidgetDataTest, CfgBinFileFormat) {
    iecode::level5::CfgBinFile cfg;
    EXPECT_EQ(cfg.format, iecode::level5::CfgBinFile::Format::T2B);
    EXPECT_TRUE(cfg.entries.empty());
    EXPECT_TRUE(cfg.lists.empty());
}

TEST(EditorWidgetDataTest, CfgEntryChildren) {
    iecode::level5::CfgEntry parent;
    parent.name = "root";
    parent.crc32 = 0x12345678;

    iecode::level5::CfgEntry child;
    child.name = "child_0";
    parent.children.push_back(child);

    EXPECT_EQ(parent.children.size(), 1u);
    EXPECT_EQ(parent.children[0].name, "child_0");
}

TEST(EditorWidgetDataTest, CfgVariableTypes) {
    // String
    iecode::level5::CfgVariable str_var;
    str_var.type = iecode::level5::CfgVarType::String;
    str_var.value = std::string("test");
    EXPECT_TRUE(std::holds_alternative<std::string>(str_var.value));

    // Int
    iecode::level5::CfgVariable int_var;
    int_var.type = iecode::level5::CfgVarType::Int;
    int_var.value = int32_t(42);
    EXPECT_TRUE(std::holds_alternative<int32_t>(int_var.value));

    // Float
    iecode::level5::CfgVariable float_var;
    float_var.type = iecode::level5::CfgVarType::Float;
    float_var.value = 3.14f;
    EXPECT_TRUE(std::holds_alternative<float>(float_var.value));
}

// ── Tests RDBN (donnees pour CfgBinEditor) ─────────────────────────

TEST(EditorWidgetDataTest, RdbnFieldTypes) {
    iecode::level5::RdbnField field;
    field.name = "health";
    field.type = iecode::level5::RdbnFieldType::Int;
    field.value = int32_t(100);

    EXPECT_EQ(field.name, "health");
    EXPECT_TRUE(std::holds_alternative<int32_t>(field.value));
    EXPECT_EQ(std::get<int32_t>(field.value), 100);
}

TEST(EditorWidgetDataTest, RdbnListStructure) {
    iecode::level5::RdbnList list;
    list.name = "CharaData";
    list.name_hash = 0xAABBCCDD;

    iecode::level5::RdbnEntry entry;
    iecode::level5::RdbnField f1{.name = "id", .name_hash = 0, .type = iecode::level5::RdbnFieldType::Int, .value = int32_t(1)};
    iecode::level5::RdbnField f2{.name = "name", .name_hash = 0, .type = iecode::level5::RdbnFieldType::Hash, .value = std::string("0xDEADBEEF")};
    entry.fields.push_back(f1);
    entry.fields.push_back(f2);
    list.entries.push_back(entry);

    EXPECT_EQ(list.entries.size(), 1u);
    EXPECT_EQ(list.entries[0].fields.size(), 2u);
}

// ── Tests Mod (donnees pour ModManager) ────────────────────────────

TEST(EditorWidgetDataTest, ModInfoDefault) {
    iecode::modding::ModInfo mod;
    EXPECT_TRUE(mod.name.empty());
    EXPECT_TRUE(mod.enabled);
    EXPECT_TRUE(mod.metadata.display_name.empty());
}

TEST(EditorWidgetDataTest, ModProfileEntries) {
    iecode::modding::ModProfile profile;
    profile.name = "Default";

    iecode::modding::ModProfileEntry entry;
    entry.name = "custom_textures";
    entry.enabled = true;
    profile.mods.push_back(entry);

    EXPECT_EQ(profile.mods.size(), 1u);
    EXPECT_EQ(profile.mods[0].name, "custom_textures");
}

TEST(EditorWidgetDataTest, ConflictReportEmpty) {
    iecode::modding::ConflictReport report;
    EXPECT_FALSE(report.has_conflicts());
    EXPECT_EQ(report.count(), 0u);
}

TEST(EditorWidgetDataTest, ConflictReportWithConflicts) {
    iecode::modding::ConflictReport report;
    report.conflicts["data/textures/chara.g4tx"] = {"mod_a", "mod_b"};
    report.conflicts["data/config/game.cfg.bin"] = {"mod_a", "mod_c"};

    EXPECT_TRUE(report.has_conflicts());
    EXPECT_EQ(report.count(), 2u);
}

// ── Tests CancellationToken (pour ModManager async) ────────────────

TEST(EditorWidgetDataTest, CancellationToken) {
    iecode::modding::CancellationToken token;
    EXPECT_FALSE(token.is_cancelled());

    token.cancel();
    EXPECT_TRUE(token.is_cancelled());
}
