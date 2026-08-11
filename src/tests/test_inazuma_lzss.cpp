#include <gtest/gtest.h>
#include "iecode/compression/inazuma_lzss.h"

#include <array>
#include <cstring>

using namespace iecode::compression;

// ── Detection du magic ──────────────────────────────────────────────

TEST(InazumaLzss, DetectMagicValid) {
    const uint8_t valid[] = {'S', 'S', 'Z', 'L', 0x00, 0x00, 0x00, 0x00};
    EXPECT_TRUE(is_inazuma_lzss(valid));
}

TEST(InazumaLzss, DetectMagicInvalid) {
    const uint8_t invalid[] = {'S', 'S', 'Z', 'M', 0x00, 0x00, 0x00, 0x00};
    EXPECT_FALSE(is_inazuma_lzss(invalid));
}

TEST(InazumaLzss, DetectMagicTooShort) {
    const uint8_t tiny[] = {'S', 'S', 'Z'};
    EXPECT_FALSE(is_inazuma_lzss(tiny));
}

TEST(InazumaLzss, DetectMagicEmpty) {
    EXPECT_FALSE(is_inazuma_lzss({}));
}

// ── Decompression — cas d'erreur ────────────────────────────────────

TEST(InazumaLzss, DecompressEmptyReturnsNullopt) {
    EXPECT_FALSE(inazuma_lzss_decompress({}).has_value());
}

TEST(InazumaLzss, DecompressInvalidMagicReturnsNullopt) {
    const uint8_t bad[] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07};
    EXPECT_FALSE(inazuma_lzss_decompress(bad).has_value());
}

TEST(InazumaLzss, DecompressHeaderTooShort) {
    const uint8_t short_data[] = {'S', 'S', 'Z', 'L', 0x10};
    EXPECT_FALSE(inazuma_lzss_decompress(short_data).has_value());
}

TEST(InazumaLzss, DecompressZeroSize) {
    // Magic + decompressed_size = 0 → vecteur vide
    const uint8_t data[] = {
        'S', 'S', 'Z', 'L',
        0x00, 0x00, 0x00, 0x00  // decompressed_size = 0
    };
    auto result = inazuma_lzss_decompress(data);
    ASSERT_TRUE(result.has_value());
    EXPECT_TRUE(result->empty());
}

// ── Decompression — donnees valides ─────────────────────────────────

TEST(InazumaLzss, DecompressAllLiterals) {
    // Construire un flux SSZL avec uniquement des octets litteraux.
    // Format : SSZL + decompressed_size(LE) + donnees compressees
    // Flag byte 0xFF = 8 bits a 1 = 8 litteraux
    const uint8_t data[] = {
        'S', 'S', 'Z', 'L',         // magic
        0x04, 0x00, 0x00, 0x00,      // decompressed_size = 4
        0xF0,                         // flags: 4 bits hauts a 1 = 4 litteraux
        0xAA, 0xBB, 0xCC, 0xDD       // 4 literal bytes
    };

    auto result = inazuma_lzss_decompress(data);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 4u);
    EXPECT_EQ((*result)[0], 0xAA);
    EXPECT_EQ((*result)[1], 0xBB);
    EXPECT_EQ((*result)[2], 0xCC);
    EXPECT_EQ((*result)[3], 0xDD);
}

TEST(InazumaLzss, DecompressFullFlagByte) {
    // 8 litteraux (flag byte = 0xFF)
    const uint8_t data[] = {
        'S', 'S', 'Z', 'L',
        0x08, 0x00, 0x00, 0x00,      // decompressed_size = 8
        0xFF,                         // flags: 8 litteraux
        0x01, 0x02, 0x03, 0x04,
        0x05, 0x06, 0x07, 0x08
    };

    auto result = inazuma_lzss_decompress(data);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 8u);
    for (uint8_t i = 0; i < 8; ++i) {
        EXPECT_EQ((*result)[i], i + 1);
    }
}

TEST(InazumaLzss, DecompressWithBackReference) {
    // Construire un flux avec des litteraux puis une back-reference.
    // On ecrit 4 litteraux (0x41, 0x42, 0x43, 0x44)
    // Puis une reference qui copie les 3 premiers octets : offset=4, length=3
    //
    // Flag byte 1 : 0xF0 = 1111 0000 = 4 litteraux + 4 slots
    //   mais on n'a besoin que d'1 reference, donc on utilise 2 flag bytes.
    //
    // Flag byte 1 : 0xFF = 8 litteraux
    // Flag byte 2 : 0x00 = 8 references (on n'utilise que la premiere)
    //
    // Plus simple : flag byte = 0xF8 = 1111 1000
    //   5 bits hauts a 1 = 5 litteraux (on n'en utilise que 4, mais on met 5 pour pas deborder)
    //   3 bits bas a 0 = 3 references... non, revoyons.
    //
    // On veut 4 litteraux + 1 reference = 5 operations, taille finale = 7
    // Flag byte : bits 7-4 = 1 (litteral) ; bit 3 = 0 (reference)
    //   => 0b11110xxx = 0xF0 (bit 3 = 0, bits 2-0 ignores car on atteint la taille)
    //
    // Reference : offset = 4 (les 4 octets precedents), length = 3 (byte2 & 0xF = 0)
    //   byte1 = offset & 0xFF = 0x04
    //   byte2 = ((offset >> 4) & 0xF0) | ((length - 3) & 0x0F) = 0x00 | 0x00 = 0x00
    //   Verifions : offset = ((0x00 & 0xF0) << 4) | 0x04 = 0x04 = 4 ✓
    //   length = (0x00 & 0x0F) + 3 = 3 ✓

    const uint8_t data[] = {
        'S', 'S', 'Z', 'L',
        0x07, 0x00, 0x00, 0x00,  // decompressed_size = 7
        0xF0,                     // flags: 1111 0 xxx → 4 litteraux + 1 reference
        0x41, 0x42, 0x43, 0x44,  // 4 litteraux
        0x04, 0x00               // reference: offset=4, length=3
    };

    auto result = inazuma_lzss_decompress(data);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 7u);
    // Les 4 premiers octets sont les litteraux
    EXPECT_EQ((*result)[0], 0x41);
    EXPECT_EQ((*result)[1], 0x42);
    EXPECT_EQ((*result)[2], 0x43);
    EXPECT_EQ((*result)[3], 0x44);
    // Les 3 suivants sont copies depuis offset 4 → debut du buffer
    EXPECT_EQ((*result)[4], 0x41);
    EXPECT_EQ((*result)[5], 0x42);
    EXPECT_EQ((*result)[6], 0x43);
}

TEST(InazumaLzss, DecompressTruncatedData) {
    // Donnees tronquees apres le flag byte — doit retourner nullopt
    const uint8_t data[] = {
        'S', 'S', 'Z', 'L',
        0x08, 0x00, 0x00, 0x00,  // decompressed_size = 8
        0xFF,                     // flags: 8 litteraux attendus
        0x01, 0x02               // seulement 2 octets au lieu de 8
    };

    EXPECT_FALSE(inazuma_lzss_decompress(data).has_value());
}

TEST(InazumaLzss, DecompressSingleLiteral) {
    // Un seul octet litteral
    const uint8_t data[] = {
        'S', 'S', 'Z', 'L',
        0x01, 0x00, 0x00, 0x00,  // decompressed_size = 1
        0x80,                     // flags: bit 7 = 1 (1 litteral)
        0x42                     // le litteral
    };

    auto result = inazuma_lzss_decompress(data);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 1u);
    EXPECT_EQ((*result)[0], 0x42);
}
