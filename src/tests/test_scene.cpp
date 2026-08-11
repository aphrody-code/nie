/// @file test_scene.cpp
/// Tests unitaires pour les parsers de scene (OBJBIN, COL, G4NV).

#include <gtest/gtest.h>

#include "iecode/formats/level5/objbin_parser.h"
#include "iecode/formats/level5/col_parser.h"
#include "iecode/formats/level5/g4nv_parser.h"
#include "iecode/types.h"

#include <array>
#include <cstring>
#include <vector>

// ════════════════════════════════════════════════════════════════════
// OBJBIN
// ════════════════════════════════════════════════════════════════════

TEST(ObjbinTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 8> tiny = {};
    EXPECT_FALSE(iecode::level5::objbin_parse(tiny).has_value());
}

TEST(ObjbinTest, ZeroObjectsIsValid) {
    // Header minimal : magic(4) + version(4) + count=0(4) + string_pool=0(4)
    std::vector<uint8_t> data(16, 0);

    // Magic "OBJB" en little-endian
    data[0] = 'O'; data[1] = 'B'; data[2] = 'J'; data[3] = 'B';

    // Version = 1
    data[4] = 1;

    // object_count = 0 (deja zero)

    auto parsed = iecode::level5::objbin_parse(data);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->version, 1u);
    EXPECT_EQ(parsed->objects.size(), 0u);
}

TEST(ObjbinTest, LargeCountBoundsCheck) {
    // Header avec un count enorme qui depasse la taille des donnees
    std::vector<uint8_t> data(16, 0);
    data[0] = 'O'; data[1] = 'B'; data[2] = 'J'; data[3] = 'B';
    data[4] = 1;

    // object_count = 1000 mais pas assez de donnees
    iecode::write_u32_le(data.data() + 8, 1000);

    auto parsed = iecode::level5::objbin_parse(data);
    EXPECT_FALSE(parsed.has_value());
}

TEST(ObjbinTest, SingleObjectParsesCorrectly) {
    // Header (16 octets) + 1 entree (52 octets) = 68 octets
    std::vector<uint8_t> data(68, 0);

    // Magic "OBJB"
    data[0] = 'O'; data[1] = 'B'; data[2] = 'J'; data[3] = 'B';
    // Version = 2
    iecode::write_u32_le(data.data() + 4, 2);
    // object_count = 1
    iecode::write_u32_le(data.data() + 8, 1);

    // Entree a l'offset 0x10 :
    // model_crc32 = 0xDEADBEEF
    iecode::write_u32_le(data.data() + 0x10, 0xDEADBEEF);

    // Position X = 1.0
    float pos_x = 1.0f;
    std::memcpy(data.data() + 0x14, &pos_x, 4);

    // Scale X = 2.0 (offset 0x10 + 32 = 0x30)
    float scale_x = 2.0f;
    std::memcpy(data.data() + 0x30, &scale_x, 4);

    // Flags = 0x42 (offset 0x10 + 44 = 0x3C)
    iecode::write_u32_le(data.data() + 0x3C, 0x42);

    // Layer = 3 (offset 0x10 + 48 = 0x40)
    iecode::write_u32_le(data.data() + 0x40, 3);

    auto parsed = iecode::level5::objbin_parse(data);
    ASSERT_TRUE(parsed.has_value());
    ASSERT_EQ(parsed->objects.size(), 1u);

    const auto& obj = parsed->objects[0];
    EXPECT_EQ(obj.model_crc32, 0xDEADBEEFu);
    EXPECT_FLOAT_EQ(obj.transform.position[0], 1.0f);
    EXPECT_FLOAT_EQ(obj.transform.scale[0], 2.0f);
    EXPECT_EQ(obj.flags, 0x42u);
    EXPECT_EQ(obj.layer, 3u);
}

TEST(ObjbinTest, UnknownMagicStillParses) {
    // Un fichier avec un magic inconnu mais un count raisonnable
    std::vector<uint8_t> data(16, 0);
    data[0] = 0xFF; data[1] = 0xFF; data[2] = 0xFF; data[3] = 0xFF;
    // version = 1, count = 0
    data[4] = 1;

    auto parsed = iecode::level5::objbin_parse(data);
    // Devrait parser malgre le magic inconnu (parsing speculatif)
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->objects.size(), 0u);
}

TEST(ObjbinTest, ToJsonProducesValidOutput) {
    iecode::level5::ObjbinFile file;
    file.version = 1;
    auto json_str = iecode::level5::objbin_to_json(file);
    EXPECT_FALSE(json_str.empty());
    EXPECT_NE(json_str.find("OBJBIN"), std::string::npos);
}

TEST(ObjbinTest, ExcessiveCountReturnsNullopt) {
    std::vector<uint8_t> data(16, 0);
    data[0] = 'O'; data[1] = 'B'; data[2] = 'J'; data[3] = 'B';
    // count = 200000 (au-dela du maximum)
    iecode::write_u32_le(data.data() + 8, 200'000);

    EXPECT_FALSE(iecode::level5::objbin_parse(data).has_value());
}

// ════════════════════════════════════════════════════════════════════
// COL
// ════════════════════════════════════════════════════════════════════

TEST(ColTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 16> tiny = {};
    EXPECT_FALSE(iecode::level5::col_parse(tiny).has_value());
}

TEST(ColTest, InvalidMagicReturnsNullopt) {
    std::vector<uint8_t> data(64, 0);
    data[0] = 0xFF;
    EXPECT_FALSE(iecode::level5::col_parse(data).has_value());
}

TEST(ColTest, EmptyMeshIsValid) {
    // Header COL minimal avec 0 sommets et 0 triangles
    std::vector<uint8_t> data(0x28, 0);

    // Magic "COL\0"
    data[0] = 'C'; data[1] = 'O'; data[2] = 'L'; data[3] = 0;

    // Version = 1
    iecode::write_u32_le(data.data() + 4, 1);
    // vertex_count = 0, triangle_count = 0 (deja zeros)

    auto parsed = iecode::level5::col_parse(data);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->version, 1u);
    EXPECT_EQ(parsed->vertices.size(), 0u);
    EXPECT_EQ(parsed->triangles.size(), 0u);
}

TEST(ColTest, ColsMagicAlsoWorks) {
    std::vector<uint8_t> data(0x28, 0);

    // Magic "COLS"
    data[0] = 'C'; data[1] = 'O'; data[2] = 'L'; data[3] = 'S';
    iecode::write_u32_le(data.data() + 4, 2);

    auto parsed = iecode::level5::col_parse(data);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->version, 2u);
}

TEST(ColTest, SingleTriangleParsesCorrectly) {
    // Header(0x28) + 3 vertices(3*12=36) + 1 triangle(8) = 84 octets
    std::vector<uint8_t> data(84, 0);

    data[0] = 'C'; data[1] = 'O'; data[2] = 'L'; data[3] = 0;
    iecode::write_u32_le(data.data() + 4, 1);
    iecode::write_u32_le(data.data() + 8, 3);   // 3 sommets
    iecode::write_u32_le(data.data() + 0x0C, 1); // 1 triangle

    // BBox min = (-1, -1, -1)
    float neg1 = -1.0f;
    std::memcpy(data.data() + 0x10, &neg1, 4);
    std::memcpy(data.data() + 0x14, &neg1, 4);
    std::memcpy(data.data() + 0x18, &neg1, 4);

    // BBox max = (1, 1, 1)
    float pos1 = 1.0f;
    std::memcpy(data.data() + 0x1C, &pos1, 4);
    std::memcpy(data.data() + 0x20, &pos1, 4);
    std::memcpy(data.data() + 0x24, &pos1, 4);

    // Sommet 0 : (0, 0, 0) — deja zero
    // Sommet 1 : (1, 0, 0)
    std::memcpy(data.data() + 0x28 + 12, &pos1, 4);
    // Sommet 2 : (0, 1, 0)
    std::memcpy(data.data() + 0x28 + 28, &pos1, 4);

    // Triangle : indices 0,1,2, flags=0x01
    const size_t tri_offset = 0x28 + 36;
    iecode::write_u16_le(data.data() + tri_offset, 0);
    iecode::write_u16_le(data.data() + tri_offset + 2, 1);
    iecode::write_u16_le(data.data() + tri_offset + 4, 2);
    iecode::write_u16_le(data.data() + tri_offset + 6, 0x01);

    auto parsed = iecode::level5::col_parse(data);
    ASSERT_TRUE(parsed.has_value());
    ASSERT_EQ(parsed->vertices.size(), 3u);
    ASSERT_EQ(parsed->triangles.size(), 1u);

    EXPECT_FLOAT_EQ(parsed->bbox_min[0], -1.0f);
    EXPECT_FLOAT_EQ(parsed->bbox_max[0], 1.0f);

    EXPECT_EQ(parsed->triangles[0].a, 0u);
    EXPECT_EQ(parsed->triangles[0].b, 1u);
    EXPECT_EQ(parsed->triangles[0].c, 2u);
    EXPECT_EQ(parsed->triangles[0].flags, 0x01);
}

TEST(ColTest, InsufficientDataForVerticesReturnsNullopt) {
    std::vector<uint8_t> data(0x28, 0);
    data[0] = 'C'; data[1] = 'O'; data[2] = 'L'; data[3] = 0;
    // 1000 sommets mais seulement le header
    iecode::write_u32_le(data.data() + 8, 1000);

    EXPECT_FALSE(iecode::level5::col_parse(data).has_value());
}

TEST(ColTest, ToJsonProducesValidOutput) {
    iecode::level5::ColFile file;
    file.version = 1;
    auto json_str = iecode::level5::col_to_json(file);
    EXPECT_FALSE(json_str.empty());
    EXPECT_NE(json_str.find("COL"), std::string::npos);
}

// ════════════════════════════════════════════════════════════════════
// G4NV
// ════════════════════════════════════════════════════════════════════

TEST(G4nvTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 8> tiny = {};
    EXPECT_FALSE(iecode::level5::g4nv_parse(tiny).has_value());
}

TEST(G4nvTest, InvalidMagicReturnsNullopt) {
    std::vector<uint8_t> data(32, 0);
    data[0] = 0xFF;
    EXPECT_FALSE(iecode::level5::g4nv_parse(data).has_value());
}

TEST(G4nvTest, CorrectMagicCheck) {
    std::vector<uint8_t> data(16, 0);
    // "G4NV" en little-endian = 0x564E3447
    data[0] = 0x47; data[1] = 0x34; data[2] = 0x4E; data[3] = 0x56;
    // version=1, node_count=0, edge_count=0

    auto parsed = iecode::level5::g4nv_parse(data);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->nodes.size(), 0u);
}

TEST(G4nvTest, SingleNodeWithEdge) {
    // Header(16) + 2 nodes(2*20=40) + 1 edge(8) = 64 octets
    std::vector<uint8_t> data(64, 0);

    // Magic "G4NV"
    data[0] = 0x47; data[1] = 0x34; data[2] = 0x4E; data[3] = 0x56;
    iecode::write_u32_le(data.data() + 4, 1);   // version
    iecode::write_u32_le(data.data() + 8, 2);   // 2 noeuds
    iecode::write_u32_le(data.data() + 12, 1);  // 1 edge

    // Noeud 0 : center=(1,2,3), radius=5, flags=0
    float vals[] = {1.0f, 2.0f, 3.0f, 5.0f};
    std::memcpy(data.data() + 16, vals, 16);

    // Noeud 1 : center=(10,20,30), radius=8, flags=1
    float vals2[] = {10.0f, 20.0f, 30.0f, 8.0f};
    std::memcpy(data.data() + 36, vals2, 16);
    iecode::write_u32_le(data.data() + 52, 1);  // flags=1

    // Edge : from=0, to=1
    iecode::write_u32_le(data.data() + 56, 0);
    iecode::write_u32_le(data.data() + 60, 1);

    auto parsed = iecode::level5::g4nv_parse(data);
    ASSERT_TRUE(parsed.has_value());
    ASSERT_EQ(parsed->nodes.size(), 2u);

    EXPECT_FLOAT_EQ(parsed->nodes[0].center[0], 1.0f);
    EXPECT_FLOAT_EQ(parsed->nodes[0].radius, 5.0f);
    ASSERT_EQ(parsed->nodes[0].connections.size(), 1u);
    EXPECT_EQ(parsed->nodes[0].connections[0], 1u);

    EXPECT_FLOAT_EQ(parsed->nodes[1].center[0], 10.0f);
    EXPECT_EQ(parsed->nodes[1].flags, 1u);
    EXPECT_EQ(parsed->nodes[1].connections.size(), 0u);
}

TEST(G4nvTest, InsufficientDataReturnsNullopt) {
    std::vector<uint8_t> data(16, 0);
    data[0] = 0x47; data[1] = 0x34; data[2] = 0x4E; data[3] = 0x56;
    // 100 noeuds mais seulement header
    iecode::write_u32_le(data.data() + 8, 100);

    EXPECT_FALSE(iecode::level5::g4nv_parse(data).has_value());
}

TEST(G4nvTest, ToJsonProducesValidOutput) {
    iecode::level5::G4nvFile file;
    file.version = 1;
    auto json_str = iecode::level5::g4nv_to_json(file);
    EXPECT_FALSE(json_str.empty());
    EXPECT_NE(json_str.find("G4NV"), std::string::npos);
}

TEST(G4nvTest, EdgeOutOfBoundsIsHandled) {
    // Header(16) + 1 node(20) + 1 edge(8) = 44 octets
    std::vector<uint8_t> data(44, 0);
    data[0] = 0x47; data[1] = 0x34; data[2] = 0x4E; data[3] = 0x56;
    iecode::write_u32_le(data.data() + 8, 1);   // 1 noeud
    iecode::write_u32_le(data.data() + 12, 1);  // 1 edge

    // Edge : from=0, to=99 (hors limites — 1 seul noeud)
    iecode::write_u32_le(data.data() + 36, 0);
    iecode::write_u32_le(data.data() + 40, 99);

    auto parsed = iecode::level5::g4nv_parse(data);
    ASSERT_TRUE(parsed.has_value());
    // L'edge hors limites ne doit pas etre ajoute
    EXPECT_EQ(parsed->nodes[0].connections.size(), 0u);
}
