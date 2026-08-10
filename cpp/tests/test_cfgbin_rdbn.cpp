#include <gtest/gtest.h>

#include "iecode/formats/level5/cfgbin.h"

#include <array>
#include <cstring>
#include <vector>

using namespace iecode::level5;

// ── Helpers pour construire des donnees de test ──────────────────────

namespace {

/// Construit un CfgBinFile RDBN minimal avec une liste et quelques champs.
CfgBinFile make_test_rdbn() {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::RDBN;

    RdbnList list;
    list.name = "TestList";
    list.name_hash = 0xAABBCCDD;

    // Entree avec differents types de champs
    RdbnEntry entry;

    // Int
    entry.fields.push_back(RdbnField{
        .name = "field_int",
        .name_hash = 0x11111111,
        .type = RdbnFieldType::Int,
        .value = int32_t{42},
    });

    // Float
    entry.fields.push_back(RdbnField{
        .name = "field_float",
        .name_hash = 0x22222222,
        .type = RdbnFieldType::Float,
        .value = 3.14f,
    });

    // Bool
    entry.fields.push_back(RdbnField{
        .name = "field_bool",
        .name_hash = 0x33333333,
        .type = RdbnFieldType::Bool,
        .value = true,
    });

    // Short
    entry.fields.push_back(RdbnField{
        .name = "field_short",
        .name_hash = 0x44444444,
        .type = RdbnFieldType::Short,
        .value = int16_t{-100},
    });

    list.entries.push_back(std::move(entry));

    // Deuxieme entree avec les memes champs
    RdbnEntry entry2;
    entry2.fields.push_back(RdbnField{
        .name = "field_int",
        .name_hash = 0x11111111,
        .type = RdbnFieldType::Int,
        .value = int32_t{99},
    });
    entry2.fields.push_back(RdbnField{
        .name = "field_float",
        .name_hash = 0x22222222,
        .type = RdbnFieldType::Float,
        .value = 2.71f,
    });
    entry2.fields.push_back(RdbnField{
        .name = "field_bool",
        .name_hash = 0x33333333,
        .type = RdbnFieldType::Bool,
        .value = false,
    });
    entry2.fields.push_back(RdbnField{
        .name = "field_short",
        .name_hash = 0x44444444,
        .type = RdbnFieldType::Short,
        .value = int16_t{200},
    });

    list.entries.push_back(std::move(entry2));
    cfg.lists.push_back(std::move(list));

    return cfg;
}

/// Construit un CfgBinFile RDBN avec plusieurs listes et types varies.
CfgBinFile make_multi_list_rdbn() {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::RDBN;

    // Liste 1 : Hash + Flag
    {
        RdbnList list;
        list.name = "HashList";
        list.name_hash = 0x10203040;

        RdbnEntry entry;
        entry.fields.push_back(RdbnField{
            .name = "hash_val",
            .name_hash = 0x50607080,
            .type = RdbnFieldType::Hash,
            .value = std::string{"0xDEADBEEF"},
        });
        entry.fields.push_back(RdbnField{
            .name = "flag_val",
            .name_hash = 0x90A0B0C0,
            .type = RdbnFieldType::Flag,
            .value = int32_t{7},
        });
        list.entries.push_back(std::move(entry));
        cfg.lists.push_back(std::move(list));
    }

    // Liste 2 : Rates (4 floats)
    {
        RdbnList list;
        list.name = "RatesList";
        list.name_hash = 0xA1B2C3D4;

        RdbnEntry entry;
        entry.fields.push_back(RdbnField{
            .name = "rates",
            .name_hash = 0xE5F60718,
            .type = RdbnFieldType::Rates,
            .value = std::vector<float>{1.0f, 2.0f, 3.0f, 4.0f},
        });
        list.entries.push_back(std::move(entry));
        cfg.lists.push_back(std::move(list));
    }

    // Liste 3 : ShortTuple
    {
        RdbnList list;
        list.name = "TupleList";
        list.name_hash = 0xF1F2F3F4;

        RdbnEntry entry;
        entry.fields.push_back(RdbnField{
            .name = "tuple",
            .name_hash = 0x01020304,
            .type = RdbnFieldType::ShortTuple,
            .value = std::vector<int16_t>{10, -20},
        });
        list.entries.push_back(std::move(entry));
        cfg.lists.push_back(std::move(list));
    }

    return cfg;
}

/// Construit un RDBN avec un champ Byte pour tester l'alignement.
CfgBinFile make_byte_field_rdbn() {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::RDBN;

    RdbnList list;
    list.name = "ByteList";
    list.name_hash = 0xBBBBBBBB;

    RdbnEntry entry;
    entry.fields.push_back(RdbnField{
        .name = "byte_val",
        .name_hash = 0xCCCCCCCC,
        .type = RdbnFieldType::Byte,
        .value = uint8_t{0xFF},
    });
    list.entries.push_back(std::move(entry));
    cfg.lists.push_back(std::move(list));

    return cfg;
}

} // namespace

// ── Tests ────────────────────────────────────────────────────────────

/// Ecrire un RDBN et verifier que le magic est correct.
TEST(CfgBinRdbnWriteTest, MagicHeader) {
    auto cfg = make_test_rdbn();
    auto data = cfgbin_write_rdbn(cfg);

    ASSERT_GE(data.size(), 0x50u);
    EXPECT_EQ(data[0], 'R');
    EXPECT_EQ(data[1], 'D');
    EXPECT_EQ(data[2], 'B');
    EXPECT_EQ(data[3], 'N');
}

/// Ecrire un RDBN et verifier les champs du header.
TEST(CfgBinRdbnWriteTest, HeaderFields) {
    auto cfg = make_test_rdbn();
    auto data = cfgbin_write_rdbn(cfg);

    ASSERT_GE(data.size(), 0x50u);

    // Header size = 0x50
    uint16_t header_size;
    std::memcpy(&header_size, data.data() + 0x04, 2);
    EXPECT_EQ(header_size, 0x50u);

    // Version = 0x64
    uint32_t version;
    std::memcpy(&version, data.data() + 0x06, 4);
    EXPECT_EQ(version, 0x64u);
}

/// Roundtrip : ecrire puis relire doit donner les memes donnees.
TEST(CfgBinRdbnWriteTest, Roundtrip) {
    auto cfg_orig = make_test_rdbn();
    auto data = cfgbin_write_rdbn(cfg_orig);

    ASSERT_FALSE(data.empty());

    auto cfg_read = cfgbin_parse(data);
    ASSERT_TRUE(cfg_read.has_value());
    EXPECT_EQ(cfg_read->format, CfgBinFile::Format::RDBN);
    ASSERT_EQ(cfg_read->lists.size(), 1u);

    const auto& list = cfg_read->lists[0];
    EXPECT_EQ(list.name_hash, 0xAABBCCDDu);
    EXPECT_EQ(list.name, "TestList");
    ASSERT_EQ(list.entries.size(), 2u);

    // Verifier la premiere entree
    const auto& e0 = list.entries[0];
    ASSERT_EQ(e0.fields.size(), 4u);

    // Int
    EXPECT_EQ(e0.fields[0].type, RdbnFieldType::Int);
    ASSERT_TRUE(std::holds_alternative<int32_t>(e0.fields[0].value));
    EXPECT_EQ(std::get<int32_t>(e0.fields[0].value), 42);

    // Float
    EXPECT_EQ(e0.fields[1].type, RdbnFieldType::Float);
    ASSERT_TRUE(std::holds_alternative<float>(e0.fields[1].value));
    EXPECT_FLOAT_EQ(std::get<float>(e0.fields[1].value), 3.14f);

    // Bool
    EXPECT_EQ(e0.fields[2].type, RdbnFieldType::Bool);
    ASSERT_TRUE(std::holds_alternative<bool>(e0.fields[2].value));
    EXPECT_TRUE(std::get<bool>(e0.fields[2].value));

    // Short
    EXPECT_EQ(e0.fields[3].type, RdbnFieldType::Short);
    ASSERT_TRUE(std::holds_alternative<int16_t>(e0.fields[3].value));
    EXPECT_EQ(std::get<int16_t>(e0.fields[3].value), -100);

    // Deuxieme entree
    const auto& e1 = list.entries[1];
    ASSERT_EQ(e1.fields.size(), 4u);
    EXPECT_EQ(std::get<int32_t>(e1.fields[0].value), 99);
    EXPECT_FLOAT_EQ(std::get<float>(e1.fields[1].value), 2.71f);
    EXPECT_FALSE(std::get<bool>(e1.fields[2].value));
    EXPECT_EQ(std::get<int16_t>(e1.fields[3].value), 200);
}

/// Roundtrip avec plusieurs listes et types varies.
TEST(CfgBinRdbnWriteTest, RoundtripMultiList) {
    auto cfg_orig = make_multi_list_rdbn();
    auto data = cfgbin_write_rdbn(cfg_orig);

    ASSERT_FALSE(data.empty());

    auto cfg_read = cfgbin_parse(data);
    ASSERT_TRUE(cfg_read.has_value());
    EXPECT_EQ(cfg_read->format, CfgBinFile::Format::RDBN);
    ASSERT_EQ(cfg_read->lists.size(), 3u);

    // Liste 1 : Hash + Flag
    {
        const auto& list = cfg_read->lists[0];
        EXPECT_EQ(list.name_hash, 0x10203040u);
        ASSERT_EQ(list.entries.size(), 1u);
        ASSERT_EQ(list.entries[0].fields.size(), 2u);

        // Hash — lu comme chaine "0xDEADBEEF"
        EXPECT_EQ(list.entries[0].fields[0].type, RdbnFieldType::Hash);
        ASSERT_TRUE(std::holds_alternative<std::string>(list.entries[0].fields[0].value));
        EXPECT_EQ(std::get<std::string>(list.entries[0].fields[0].value), "0xDEADBEEF");

        // Flag
        EXPECT_EQ(list.entries[0].fields[1].type, RdbnFieldType::Flag);
        EXPECT_EQ(std::get<int32_t>(list.entries[0].fields[1].value), 7);
    }

    // Liste 2 : Rates
    {
        const auto& list = cfg_read->lists[1];
        EXPECT_EQ(list.name_hash, 0xA1B2C3D4u);
        ASSERT_EQ(list.entries.size(), 1u);
        ASSERT_EQ(list.entries[0].fields.size(), 1u);

        const auto& rates = std::get<std::vector<float>>(list.entries[0].fields[0].value);
        ASSERT_EQ(rates.size(), 4u);
        EXPECT_FLOAT_EQ(rates[0], 1.0f);
        EXPECT_FLOAT_EQ(rates[1], 2.0f);
        EXPECT_FLOAT_EQ(rates[2], 3.0f);
        EXPECT_FLOAT_EQ(rates[3], 4.0f);
    }

    // Liste 3 : ShortTuple
    {
        const auto& list = cfg_read->lists[2];
        ASSERT_EQ(list.entries.size(), 1u);
        const auto& tuple = std::get<std::vector<int16_t>>(list.entries[0].fields[0].value);
        ASSERT_EQ(tuple.size(), 2u);
        EXPECT_EQ(tuple[0], 10);
        EXPECT_EQ(tuple[1], -20);
    }
}

/// Byte field roundtrip (test alignement).
TEST(CfgBinRdbnWriteTest, RoundtripByteField) {
    auto cfg_orig = make_byte_field_rdbn();
    auto data = cfgbin_write_rdbn(cfg_orig);

    ASSERT_FALSE(data.empty());

    auto cfg_read = cfgbin_parse(data);
    ASSERT_TRUE(cfg_read.has_value());
    ASSERT_EQ(cfg_read->lists.size(), 1u);
    ASSERT_EQ(cfg_read->lists[0].entries.size(), 1u);

    const auto& f = cfg_read->lists[0].entries[0].fields[0];
    EXPECT_EQ(f.type, RdbnFieldType::Byte);
    EXPECT_EQ(std::get<uint8_t>(f.value), 0xFF);
}

/// cfgbin_write dispatche vers RDBN quand format == RDBN.
TEST(CfgBinRdbnWriteTest, WriteDispatchesRdbn) {
    auto cfg = make_test_rdbn();

    auto data_rdbn = cfgbin_write_rdbn(cfg);
    auto data_generic = cfgbin_write(cfg);

    EXPECT_EQ(data_rdbn.size(), data_generic.size());
    EXPECT_EQ(data_rdbn, data_generic);
}

/// Double roundtrip : write -> read -> write doit donner les memes octets.
TEST(CfgBinRdbnWriteTest, DoubleRoundtrip) {
    auto cfg_orig = make_test_rdbn();
    auto data1 = cfgbin_write_rdbn(cfg_orig);
    ASSERT_FALSE(data1.empty());

    auto cfg_read = cfgbin_parse(data1);
    ASSERT_TRUE(cfg_read.has_value());

    auto data2 = cfgbin_write_rdbn(*cfg_read);
    EXPECT_EQ(data1.size(), data2.size());
    EXPECT_EQ(data1, data2);
}

/// Format T2B ne doit pas etre accepte par cfgbin_write_rdbn.
TEST(CfgBinRdbnWriteTest, RejectsT2B) {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;
    auto data = cfgbin_write_rdbn(cfg);
    EXPECT_TRUE(data.empty());
}

/// Liste vide doit retourner un vecteur vide.
TEST(CfgBinRdbnWriteTest, EmptyLists) {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::RDBN;
    // Pas de listes
    auto data = cfgbin_write_rdbn(cfg);
    EXPECT_TRUE(data.empty());
}

/// Node count doit correspondre apres roundtrip.
TEST(CfgBinRdbnWriteTest, NodeCountPreserved) {
    auto cfg_orig = make_test_rdbn();
    size_t orig_count = cfg_orig.node_count();

    auto data = cfgbin_write_rdbn(cfg_orig);
    auto cfg_read = cfgbin_parse(data);
    ASSERT_TRUE(cfg_read.has_value());

    EXPECT_EQ(cfg_read->node_count(), orig_count);
}
