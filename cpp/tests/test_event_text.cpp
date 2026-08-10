#include <gtest/gtest.h>

#include "iecode/gamedata/event_text.h"
#include "iecode/formats/level5/cfgbin.h"

using namespace iecode::gamedata;
using namespace iecode::level5;

// ── Helpers ─────────────────────────────────────────────────────────

namespace {

/// Cree un CfgBinFile T2B avec des entrees de texte evenementiel.
CfgBinFile make_event_text_t2b() {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    // Entree EVENT_TEXT_INFO_0 : [hash, unk, text]
    CfgEntry text_info;
    text_info.name = "EVENT_TEXT_INFO_0";
    text_info.crc32 = 0x12345678;
    text_info.variables = {
        CfgVariable{CfgVarType::Int,    static_cast<int32_t>(0xAABBCCDD), "hash"},
        CfgVariable{CfgVarType::Int,    int32_t{0},                       "unk"},
        CfgVariable{CfgVarType::String, std::string{"Bonjour le monde"},  "text"},
    };
    cfg.entries.push_back(text_info);

    // Entree EVENT_TEXT_INFO_1 avec speaker et voice
    CfgEntry text_info2;
    text_info2.name = "EVENT_TEXT_INFO_1";
    text_info2.crc32 = 0x12345679;
    text_info2.variables = {
        CfgVariable{CfgVarType::Int,    int32_t{0x11223344},        "hash"},
        CfgVariable{CfgVarType::Int,    int32_t{0},                 "unk"},
        CfgVariable{CfgVarType::String, std::string{"Allons-y !"}, "text"},
        CfgVariable{CfgVarType::Int,    int32_t{42},                "speaker"},
        CfgVariable{CfgVarType::Int,    int32_t{100},               "voice"},
    };
    cfg.entries.push_back(text_info2);

    return cfg;
}

/// Cree un CfgBinFile T2B avec des sous-titres.
CfgBinFile make_subtitle_t2b() {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    CfgEntry subtitle;
    subtitle.name = "EVENT_SUBTITLE_DATA_0";
    subtitle.crc32 = 0xDEADBEEF;
    subtitle.variables = {
        CfgVariable{CfgVarType::Int,    static_cast<int32_t>(0x55667788), "hash"},
        CfgVariable{CfgVarType::String, std::string{"Sous-titre de test"}, "text"},
        CfgVariable{CfgVarType::Float,  1.5f,                              "start"},
        CfgVariable{CfgVarType::Float,  3.0f,                              "end"},
        CfgVariable{CfgVarType::Int,    int32_t{7},                        "speaker"},
    };
    cfg.entries.push_back(subtitle);

    return cfg;
}

/// Cree un CfgBinFile T2B avec des donnees bust-up.
CfgBinFile make_bustup_t2b() {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    CfgEntry bustup;
    bustup.name = "EVENT_BUSTUP_TALK_DATA_0";
    bustup.crc32 = 0xCAFEBABE;
    bustup.variables = {
        CfgVariable{CfgVarType::Int,    static_cast<int32_t>(0xFEDCBA98), "hash"},
        CfgVariable{CfgVarType::Int,    int32_t{15},                       "speaker"},
        CfgVariable{CfgVarType::String, std::string{"Dialogue bust-up"},  "text"},
        CfgVariable{CfgVarType::Int,    int32_t{200},                      "voice"},
    };
    cfg.entries.push_back(bustup);

    return cfg;
}

/// Cree un CfgBinFile RDBN avec des textes evenementiels.
CfgBinFile make_event_text_rdbn() {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::RDBN;

    RdbnList list;
    list.name = "EVENT_TEXT_INFO_LIST";
    list.name_hash = 0xA7131928; // CRC32 de "EVENT_TEXT_INFO"

    // Entree avec hash, texte et speaker
    RdbnEntry entry;
    entry.fields.push_back(RdbnField{
        .name = "textId",
        .name_hash = 0x11111111,
        .type = RdbnFieldType::Int,
        .value = static_cast<int32_t>(0xBBBBBBBB),
    });
    entry.fields.push_back(RdbnField{
        .name = "speakerId",
        .name_hash = 0x22222222,
        .type = RdbnFieldType::Int,
        .value = int32_t{5},
    });
    entry.fields.push_back(RdbnField{
        .name = "text",
        .name_hash = 0x33333333,
        .type = RdbnFieldType::Condition,
        .value = std::string{"Texte RDBN evenementiel"},
    });

    list.entries.push_back(std::move(entry));
    cfg.lists.push_back(std::move(list));

    return cfg;
}

} // namespace

// ── Tests event_text_extract (T2B) ─────────────────────────────────

TEST(EventText, ExtractT2B_TextInfo) {
    auto cfg = make_event_text_t2b();
    auto result = event_text_extract(cfg);

    ASSERT_EQ(result.entries.size(), 2u);

    // Premier texte
    EXPECT_EQ(result.entries[0].hash, 0xAABBCCDDu);
    EXPECT_EQ(result.entries[0].text, "Bonjour le monde");
    EXPECT_EQ(result.entries[0].key, "EVENT_TEXT_INFO_0");
    EXPECT_EQ(result.entries[0].speaker_id, 0u);
    EXPECT_EQ(result.entries[0].voice_id, 0u);

    // Deuxieme texte avec speaker et voice
    EXPECT_EQ(result.entries[1].hash, 0x11223344u);
    EXPECT_EQ(result.entries[1].text, "Allons-y !");
    EXPECT_EQ(result.entries[1].speaker_id, 42u);
    EXPECT_EQ(result.entries[1].voice_id, 100u);
}

TEST(EventText, ExtractT2B_Subtitle) {
    auto cfg = make_subtitle_t2b();
    auto result = event_text_extract(cfg);

    ASSERT_EQ(result.entries.size(), 1u);

    const auto& e = result.entries[0];
    EXPECT_EQ(e.hash, 0x55667788u);
    EXPECT_EQ(e.text, "Sous-titre de test");
    EXPECT_FLOAT_EQ(e.start_time, 1.5f);
    EXPECT_FLOAT_EQ(e.end_time, 3.0f);
    EXPECT_EQ(e.speaker_id, 7u);
}

TEST(EventText, ExtractT2B_BustUp) {
    auto cfg = make_bustup_t2b();
    auto result = event_text_extract(cfg);

    ASSERT_EQ(result.entries.size(), 1u);

    const auto& e = result.entries[0];
    EXPECT_EQ(e.hash, 0xFEDCBA98u);
    EXPECT_EQ(e.text, "Dialogue bust-up");
    EXPECT_EQ(e.speaker_id, 15u);
    EXPECT_EQ(e.voice_id, 200u);
}

// ── Tests event_text_extract (RDBN) ────────────────────────────────

TEST(EventText, ExtractRDBN_TextInfo) {
    auto cfg = make_event_text_rdbn();
    auto result = event_text_extract(cfg);

    ASSERT_EQ(result.entries.size(), 1u);

    const auto& e = result.entries[0];
    EXPECT_EQ(e.hash, 0xBBBBBBBBu);
    EXPECT_EQ(e.text, "Texte RDBN evenementiel");
    EXPECT_EQ(e.speaker_id, 5u);
}

// ── Tests event_text_find ──────────────────────────────────────────

TEST(EventText, FindByHash) {
    auto cfg = make_event_text_t2b();
    auto result = event_text_extract(cfg);

    auto found = event_text_find(result, 0xAABBCCDDu);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->text, "Bonjour le monde");

    auto not_found = event_text_find(result, 0xDEADu);
    EXPECT_FALSE(not_found.has_value());
}

TEST(EventText, FindByKey) {
    auto cfg = make_event_text_t2b();
    auto result = event_text_extract(cfg);

    auto found = event_text_find(result, std::string_view{"EVENT_TEXT_INFO_1"});
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->text, "Allons-y !");

    auto not_found = event_text_find(result, std::string_view{"MISSING_KEY"});
    EXPECT_FALSE(not_found.has_value());
}

// ── Tests cas limites ──────────────────────────────────────────────

TEST(EventText, EmptyCfgBin) {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    auto result = event_text_extract(cfg);
    EXPECT_TRUE(result.entries.empty());
}

TEST(EventText, IgnoreBeginEndEntries) {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    // Les entrees _BEGIN et _END ne doivent pas etre parsees
    CfgEntry begin_entry;
    begin_entry.name = "EVENT_TEXT_INFO_BEGIN";
    begin_entry.variables = {
        CfgVariable{CfgVarType::Int,    int32_t{0x999},                     "hash"},
        CfgVariable{CfgVarType::Int,    int32_t{0},                         "unk"},
        CfgVariable{CfgVarType::String, std::string{"Ne devrait pas apparaitre"}, "text"},
    };
    cfg.entries.push_back(begin_entry);

    CfgEntry end_entry;
    end_entry.name = "EVENT_TEXT_INFO_END";
    end_entry.variables = begin_entry.variables;
    cfg.entries.push_back(end_entry);

    auto result = event_text_extract(cfg);
    EXPECT_TRUE(result.entries.empty());
}

TEST(EventText, EmptyTextSkipped) {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    CfgEntry text_info;
    text_info.name = "EVENT_TEXT_INFO_0";
    text_info.variables = {
        CfgVariable{CfgVarType::Int,    int32_t{0xABCD}, "hash"},
        CfgVariable{CfgVarType::Int,    int32_t{0},      "unk"},
        CfgVariable{CfgVarType::String, std::string{""}, "text"},
    };
    cfg.entries.push_back(text_info);

    auto result = event_text_extract(cfg);
    EXPECT_TRUE(result.entries.empty());
}

TEST(EventText, TooFewVariablesSkipped) {
    CfgBinFile cfg;
    cfg.format = CfgBinFile::Format::T2B;

    CfgEntry text_info;
    text_info.name = "EVENT_TEXT_INFO_0";
    text_info.variables = {
        CfgVariable{CfgVarType::Int, int32_t{0xABCD}, "hash"},
        // Pas assez de variables (minimum 3)
    };
    cfg.entries.push_back(text_info);

    auto result = event_text_extract(cfg);
    EXPECT_TRUE(result.entries.empty());
}
