#include <gtest/gtest.h>
#include "iecode/formats/level5/anm_parser.h"

#include <array>
#include <cstring>

using namespace iecode::level5;

// ── Helper pour construire des donnees ANMx de test ─────────────────

/// Ecrit un uint32 big-endian dans un buffer.
static void write_u32_be(uint8_t* p, uint32_t v) {
    p[0] = static_cast<uint8_t>(v >> 24);
    p[1] = static_cast<uint8_t>(v >> 16);
    p[2] = static_cast<uint8_t>(v >> 8);
    p[3] = static_cast<uint8_t>(v);
}

/// Ecrit un float32 big-endian dans un buffer.
static void write_f32_be(uint8_t* p, float v) {
    uint32_t bits{};
    std::memcpy(&bits, &v, sizeof(float));
    write_u32_be(p, bits);
}

/// Construit un fichier ANMx minimal (header + table d'entrees + keyframes).
static std::vector<uint8_t> make_anm_data(
    const char* magic,
    uint32_t version,
    uint32_t data_size,
    uint32_t entry_count,
    uint32_t frame_count,
    float fps,
    const std::vector<std::tuple<uint32_t, uint32_t, uint32_t>>& entries = {},
    const std::vector<std::pair<float, float>>& keyframes = {})
{
    // Header = 24 octets
    // Table d'entrees = entry_count * 12 octets
    // Keyframes = total_keyframes * 8 octets
    const size_t header_size = 24;
    const size_t table_size = entries.size() * 12;

    size_t kf_size = keyframes.size() * 8;

    std::vector<uint8_t> data(header_size + table_size + kf_size, 0);

    // Magic
    std::memcpy(data.data(), magic, 4);

    // Header en big-endian
    write_u32_be(data.data() + 0x04, version);
    write_u32_be(data.data() + 0x08, data_size);
    write_u32_be(data.data() + 0x0C, entry_count);
    write_u32_be(data.data() + 0x10, frame_count);
    write_f32_be(data.data() + 0x14, fps);

    // Table d'entrees
    for (size_t i = 0; i < entries.size(); ++i) {
        const auto& [hash, channel, kf_count] = entries[i];
        const size_t off = header_size + i * 12;
        write_u32_be(data.data() + off + 0x00, hash);
        write_u32_be(data.data() + off + 0x04, channel);
        write_u32_be(data.data() + off + 0x08, kf_count);
    }

    // Keyframes
    size_t kf_off = header_size + table_size;
    for (const auto& [time, value] : keyframes) {
        write_f32_be(data.data() + kf_off, time);
        write_f32_be(data.data() + kf_off + 4, value);
        kf_off += 8;
    }

    return data;
}

// ── Detection du magic ──────────────────────────────────────────────

TEST(AnmParser, DetectAllTypes) {
    const char* magics[] = {"ANMC", "ANMV", "ANMA", "ANMN", "ANMP"};
    const AnmType expected[] = {
        AnmType::ANMC, AnmType::ANMV, AnmType::ANMA,
        AnmType::ANMN, AnmType::ANMP
    };

    for (int i = 0; i < 5; ++i) {
        std::array<uint8_t, 24> data{};
        std::memcpy(data.data(), magics[i], 4);
        EXPECT_TRUE(anm_is_valid(data)) << "Magic: " << magics[i];
        EXPECT_EQ(anm_detect_type(data), expected[i]) << "Magic: " << magics[i];
    }
}

TEST(AnmParser, DetectInvalidMagic) {
    std::array<uint8_t, 24> data{};
    std::memcpy(data.data(), "ANMX", 4); // Pas un type connu
    EXPECT_FALSE(anm_is_valid(data));
    EXPECT_EQ(anm_detect_type(data), AnmType::Unknown);
}

TEST(AnmParser, DetectTooShort) {
    const uint8_t tiny[] = {'A', 'N', 'M'};
    EXPECT_FALSE(anm_is_valid(tiny));
    EXPECT_EQ(anm_detect_type(tiny), AnmType::Unknown);
}

TEST(AnmParser, DetectEmpty) {
    EXPECT_FALSE(anm_is_valid({}));
    EXPECT_EQ(anm_detect_type({}), AnmType::Unknown);
}

// ── Noms des types ──────────────────────────────────────────────────

TEST(AnmParser, TypeNames) {
    EXPECT_EQ(anm_type_name(AnmType::ANMC), "ANMC");
    EXPECT_EQ(anm_type_name(AnmType::ANMV), "ANMV");
    EXPECT_EQ(anm_type_name(AnmType::ANMA), "ANMA");
    EXPECT_EQ(anm_type_name(AnmType::ANMN), "ANMN");
    EXPECT_EQ(anm_type_name(AnmType::ANMP), "ANMP");
    EXPECT_EQ(anm_type_name(AnmType::Unknown), "Unknown");
}

// ── Parsing — cas d'erreur ──────────────────────────────────────────

TEST(AnmParser, ParseEmptyReturnsNullopt) {
    EXPECT_FALSE(anm_parse({}).has_value());
}

TEST(AnmParser, ParseTooShortReturnsNullopt) {
    const uint8_t tiny[] = {'A', 'N', 'M', 'C', 0x00};
    EXPECT_FALSE(anm_parse(tiny).has_value());
}

TEST(AnmParser, ParseInvalidMagicReturnsNullopt) {
    std::array<uint8_t, 24> data{};
    std::memcpy(data.data(), "XXXX", 4);
    EXPECT_FALSE(anm_parse(data).has_value());
}

// ── Parsing — donnees valides ───────────────────────────────────────

TEST(AnmParser, ParseHeaderOnly) {
    // Un fichier ANMx avec 0 entrees
    auto data = make_anm_data("ANMC", 1, 24, 0, 100, 30.0f);

    auto result = anm_parse(data);
    ASSERT_TRUE(result.has_value());

    EXPECT_EQ(result->header.type, AnmType::ANMC);
    EXPECT_EQ(result->header.version, 1u);
    EXPECT_EQ(result->header.entry_count, 0u);
    EXPECT_EQ(result->header.frame_count, 100u);
    EXPECT_FLOAT_EQ(result->header.fps, 30.0f);
    EXPECT_TRUE(result->entries.empty());
}

TEST(AnmParser, ParseWithEntries) {
    // 2 entrees avec 1 keyframe chacune
    auto data = make_anm_data(
        "ANMV", 2, 0, 2, 60, 60.0f,
        // Entrees : {target_hash, channel, keyframe_count}
        {{0xDEADBEEF, 0, 1}, {0xCAFEBABE, 1, 1}},
        // Keyframes : {time, value}
        {{0.0f, 1.0f}, {0.5f, 2.0f}}
    );

    auto result = anm_parse(data);
    ASSERT_TRUE(result.has_value());

    EXPECT_EQ(result->header.type, AnmType::ANMV);
    EXPECT_EQ(result->header.entry_count, 2u);
    ASSERT_EQ(result->entries.size(), 2u);

    // Premiere entree
    EXPECT_EQ(result->entries[0].target_hash, 0xDEADBEEF);
    EXPECT_EQ(result->entries[0].channel, 0u);
    EXPECT_EQ(result->entries[0].keyframe_count, 1u);
    ASSERT_EQ(result->entries[0].times.size(), 1u);
    EXPECT_FLOAT_EQ(result->entries[0].times[0], 0.0f);
    EXPECT_FLOAT_EQ(result->entries[0].values[0], 1.0f);

    // Deuxieme entree
    EXPECT_EQ(result->entries[1].target_hash, 0xCAFEBABE);
    EXPECT_EQ(result->entries[1].channel, 1u);
    EXPECT_EQ(result->entries[1].keyframe_count, 1u);
    ASSERT_EQ(result->entries[1].times.size(), 1u);
    EXPECT_FLOAT_EQ(result->entries[1].times[0], 0.5f);
    EXPECT_FLOAT_EQ(result->entries[1].values[0], 2.0f);
}

TEST(AnmParser, ParseWithMultipleKeyframes) {
    // 1 entree avec 3 keyframes
    auto data = make_anm_data(
        "ANMA", 1, 0, 1, 90, 30.0f,
        {{0x12345678, 2, 3}},
        {{0.0f, 0.0f}, {0.5f, 0.5f}, {1.0f, 1.0f}}
    );

    auto result = anm_parse(data);
    ASSERT_TRUE(result.has_value());

    ASSERT_EQ(result->entries.size(), 1u);
    EXPECT_EQ(result->entries[0].keyframe_count, 3u);
    ASSERT_EQ(result->entries[0].times.size(), 3u);
    ASSERT_EQ(result->entries[0].values.size(), 3u);

    EXPECT_FLOAT_EQ(result->entries[0].times[0], 0.0f);
    EXPECT_FLOAT_EQ(result->entries[0].times[1], 0.5f);
    EXPECT_FLOAT_EQ(result->entries[0].times[2], 1.0f);

    EXPECT_FLOAT_EQ(result->entries[0].values[0], 0.0f);
    EXPECT_FLOAT_EQ(result->entries[0].values[1], 0.5f);
    EXPECT_FLOAT_EQ(result->entries[0].values[2], 1.0f);
}

TEST(AnmParser, ParseAllAnmTypes) {
    // Verifier que chaque type ANMx peut etre parse
    const char* magics[] = {"ANMC", "ANMV", "ANMA", "ANMN", "ANMP"};
    const AnmType expected[] = {
        AnmType::ANMC, AnmType::ANMV, AnmType::ANMA,
        AnmType::ANMN, AnmType::ANMP
    };

    for (int i = 0; i < 5; ++i) {
        auto data = make_anm_data(magics[i], 1, 24, 0, 0, 30.0f);
        auto result = anm_parse(data);
        ASSERT_TRUE(result.has_value()) << "Type: " << magics[i];
        EXPECT_EQ(result->header.type, expected[i]) << "Type: " << magics[i];
    }
}

// ── Export JSON ─────────────────────────────────────────────────────

TEST(AnmParser, ToJsonHeaderOnly) {
    AnmFile anm;
    std::memcpy(anm.header.magic, "ANMC", 4);
    anm.header.type = AnmType::ANMC;
    anm.header.version = 1;
    anm.header.data_size = 24;
    anm.header.entry_count = 0;
    anm.header.frame_count = 60;
    anm.header.fps = 30.0f;

    const std::string json = anm_to_json(anm);

    // Verifier que le JSON contient les champs attendus
    EXPECT_NE(json.find("\"ANMC\""), std::string::npos);
    EXPECT_NE(json.find("\"entry_count\": 0"), std::string::npos);
    EXPECT_NE(json.find("\"entries\": []"), std::string::npos);
}

TEST(AnmParser, ToJsonWithEntries) {
    // Construire et parser, puis exporter
    auto data = make_anm_data(
        "ANMN", 1, 0, 1, 30, 30.0f,
        {{0xAABBCCDD, 0, 1}},
        {{0.0f, 42.0f}}
    );

    auto result = anm_parse(data);
    ASSERT_TRUE(result.has_value());

    const std::string json = anm_to_json(*result);

    // Verifier les champs cles
    EXPECT_NE(json.find("\"ANMN\""), std::string::npos);
    EXPECT_NE(json.find("0xaabbccdd"), std::string::npos);
    EXPECT_NE(json.find("\"keyframes\""), std::string::npos);
    EXPECT_NE(json.find("42.0"), std::string::npos);
}

// ── Cas limites ─────────────────────────────────────────────────────

TEST(AnmParser, ParseTruncatedEntryTable) {
    // Header annonce 10 entrees mais le fichier est trop court pour les contenir
    auto data = make_anm_data("ANMC", 1, 0, 10, 60, 30.0f);
    // Le fichier fait 24 octets (header seul) mais annonce 10 entrees (120 octets de table)
    // Le parser doit ajuster le nombre d'entrees

    auto result = anm_parse(data);
    ASSERT_TRUE(result.has_value());
    // Le parser devrait reduire a 0 entrees puisqu'il n'y a pas de place
    EXPECT_EQ(result->entries.size(), 0u);
}

TEST(AnmParser, ParseEntryWithNoKeyframeData) {
    // 1 entree qui annonce 5 keyframes mais aucune donnee keyframe disponible
    auto data = make_anm_data(
        "ANMC", 1, 0, 1, 30, 30.0f,
        {{0x11111111, 0, 5}},
        {}  // Pas de keyframes dans les donnees
    );

    auto result = anm_parse(data);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->entries.size(), 1u);
    // L'entree devrait avoir 0 keyframes (donnees hors limites)
    EXPECT_EQ(result->entries[0].keyframe_count, 0u);
    EXPECT_TRUE(result->entries[0].times.empty());
    EXPECT_TRUE(result->entries[0].values.empty());
}
