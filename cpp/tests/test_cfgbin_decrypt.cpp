#include <gtest/gtest.h>

#include "iecode/crypto/cfgbin_decrypt.h"
#include "iecode/formats/level5/chara_base.h"

#include <array>
#include <cstdint>
#include <cstring>
#include <vector>

namespace {

// ── cfgbin_decrypt : involutivite ─────────────────────────────────────

TEST(CfgbinDecrypt, IsInvolutive) {
    // Deux passes successives doivent rendre le buffer original.
    std::vector<uint8_t> original(37);
    for (size_t i = 0; i < original.size(); ++i) {
        original[i] = static_cast<uint8_t>(i * 7 + 3);
    }
    std::vector<uint8_t> buf = original;

    iecode::crypto::cfgbin_decrypt(buf, 0, 0x1717E18Eu);
    EXPECT_NE(buf, original); // doit effectivement muter

    iecode::crypto::cfgbin_decrypt(buf, 0, 0x1717E18Eu);
    EXPECT_EQ(buf, original); // la 2e passe annule la 1re
}

TEST(CfgbinDecrypt, OffsetAlignmentSplit) {
    // Traiter [0..40) en une fois doit etre equivalent a [0..16) puis [16..40)
    // des lors que le start_offset du 2e appel est fourni.
    std::vector<uint8_t> src(40);
    for (size_t i = 0; i < src.size(); ++i) {
        src[i] = static_cast<uint8_t>(0xA5u ^ i);
    }

    std::vector<uint8_t> whole = src;
    iecode::crypto::cfgbin_decrypt(whole, 0, 0xDEADBEEFu);

    std::vector<uint8_t> split = src;
    iecode::crypto::cfgbin_decrypt(std::span{split.data(), 16}, 0, 0xDEADBEEFu);
    iecode::crypto::cfgbin_decrypt(std::span{split.data() + 16, 24}, 16, 0xDEADBEEFu);

    EXPECT_EQ(whole, split);
}

TEST(CfgbinDecrypt, IsEncryptedDetectsT2BFooter) {
    // Buffer avec footer T2B "01 74 32 62" → non chiffre.
    std::vector<uint8_t> buf(32, 0xAAu);
    buf[28] = 0x01; buf[29] = 0x74; buf[30] = 0x32; buf[31] = 0x62;
    EXPECT_FALSE(iecode::crypto::cfgbin_is_encrypted(buf));
}

TEST(CfgbinDecrypt, IsEncryptedDetectsRdbnMagic) {
    std::vector<uint8_t> buf(16, 0);
    std::memcpy(buf.data(), "RDBN", 4);
    EXPECT_FALSE(iecode::crypto::cfgbin_is_encrypted(buf));
}

TEST(CfgbinDecrypt, IsEncryptedRandomBuffer) {
    std::vector<uint8_t> buf(64, 0xCDu);
    EXPECT_TRUE(iecode::crypto::cfgbin_is_encrypted(buf));
}

// ── chara_base parser ─────────────────────────────────────────────────

namespace {

void append_u32_le(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back(static_cast<uint8_t>(v & 0xFFu));
    out.push_back(static_cast<uint8_t>((v >> 8) & 0xFFu));
    out.push_back(static_cast<uint8_t>((v >> 16) & 0xFFu));
    out.push_back(static_cast<uint8_t>((v >> 24) & 0xFFu));
}

/// Ajoute une entry T2B : CRC(4) + param_count(1) + types_bytes(ceil(n/4)) + pad -> aligne 4.
/// Remplit types et padding avec 0xFF (le parser ne valide pas les types).
void append_entry(std::vector<uint8_t>& out, uint32_t crc,
                  const std::vector<uint32_t>& values) {
    append_u32_le(out, crc);
    const uint8_t param_count = static_cast<uint8_t>(values.size());
    out.push_back(param_count);
    // Header alignment identique au parser : 1 (param_count) + ceil(n/4), pad a 4.
    size_t header_bytes = 1 + ((param_count + 3) / 4);
    while ((header_bytes % 4) != 0) {
        ++header_bytes;
    }
    // On a deja pousse 1 byte (param_count) ; completer jusqu'a header_bytes.
    for (size_t k = 1; k < header_bytes; ++k) {
        out.push_back(0xFF);
    }
    for (uint32_t v : values) {
        append_u32_le(out, v);
    }
}

} // namespace

TEST(CharaBaseParser, ParsesSyntheticFile) {
    std::vector<uint8_t> buf;

    // Entry racine 0xB688E1A5 avec count=3 en premier champ.
    append_entry(buf, 0xB688E1A5u, {3u});

    // 14 descripteurs de colonnes (vides — 0 params).
    for (int i = 0; i < 14; ++i) {
        append_entry(buf, 0x530F114Bu, {});
    }

    // Section dense : 3 * 15 bytes.
    for (uint32_t i = 0; i < 3; ++i) {
        append_u32_le(buf, 0x1000u + i); // id
        for (uint8_t b = 0; b < 11; ++b) {
            buf.push_back(static_cast<uint8_t>(i * 11 + b));
        }
    }

    auto result = iecode::level5::CharaBase::parse(buf);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->count, 3u);
    ASSERT_EQ(result->entries.size(), 3u);
    EXPECT_EQ(result->entries[0].id, 0x1000u);
    EXPECT_EQ(result->entries[1].id, 0x1001u);
    EXPECT_EQ(result->entries[2].id, 0x1002u);
    EXPECT_EQ(result->entries[2].data[0], static_cast<uint8_t>(22));
    EXPECT_EQ(result->entries[2].data[10], static_cast<uint8_t>(32));
}

TEST(CharaBaseParser, RejectsEmptyBuffer) {
    std::vector<uint8_t> buf;
    EXPECT_FALSE(iecode::level5::CharaBase::parse(buf).has_value());
}

TEST(CharaBaseParser, RejectsMissingHeader) {
    std::vector<uint8_t> buf(64, 0xFFu);
    EXPECT_FALSE(iecode::level5::CharaBase::parse(buf).has_value());
}

} // namespace
