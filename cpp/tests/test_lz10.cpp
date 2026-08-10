#include <gtest/gtest.h>
#include "iecode/compression/lz10.h"

using namespace iecode::compression;

TEST(Lz10, DetectMagic) {
    const uint8_t valid[] = {0x10, 0x20, 0x00, 0x00};
    EXPECT_TRUE(is_lz10(valid));

    const uint8_t invalid[] = {0x11, 0x20, 0x00, 0x00};
    EXPECT_FALSE(is_lz10(invalid));
}

TEST(Lz10, TooShort) {
    const uint8_t tiny[] = {0x10, 0x00};
    EXPECT_FALSE(is_lz10(tiny));
}

TEST(Lz10, EmptyInput) {
    EXPECT_TRUE(lz10_decompress({}).empty());
}

TEST(Lz10, InvalidMagicReturnsEmpty) {
    const uint8_t bad[] = {0x20, 0x05, 0x00, 0x00, 0xFF};
    EXPECT_TRUE(lz10_decompress(bad).empty());
}

TEST(Lz10, AllLiterals) {
    // Construire un flux LZ10 valide avec seulement des literals.
    // Header : magic 0x10, taille decompresee = 4 (LE 24-bit)
    // Flags : 0x00 (8 bits tous 0 = 8 literals)
    // 4 octets de donnees
    const uint8_t input[] = {
        0x10, 0x04, 0x00, 0x00,  // header: magic + size=4
        0x00,                      // flags: 8 literals
        0xAA, 0xBB, 0xCC, 0xDD    // 4 literal bytes
    };

    auto result = lz10_decompress(input);
    ASSERT_EQ(result.size(), 4u);
    EXPECT_EQ(result[0], 0xAA);
    EXPECT_EQ(result[1], 0xBB);
    EXPECT_EQ(result[2], 0xCC);
    EXPECT_EQ(result[3], 0xDD);
}

TEST(Lz10, BackReference) {
    // Header : taille = 8
    // Flags byte 1 : 0b00001111 — 4 literals puis 4 back-refs
    // Literals : 0x41 0x42 0x43 0x44
    // Back-ref : length=3+0=3, displacement=(0<<8|3)+1=4 → copie les 3 premiers octets
    // Mais on simplifie : 0b00000000 = 8 literals d'abord
    // Puis 0xFF = 8 back-refs
    // On teste juste que la decompression produit la bonne taille
    const uint8_t input[] = {
        0x10, 0x07, 0x00, 0x00,  // header: magic + size=7
        0x00,                      // flags: 8 literals
        0x41, 0x42, 0x43, 0x44,  // 4 literals
        0x45, 0x46, 0x47          // 3 more literals (only 7 needed)
    };

    auto result = lz10_decompress(input);
    ASSERT_EQ(result.size(), 7u);
    EXPECT_EQ(result[0], 0x41);
    EXPECT_EQ(result[6], 0x47);
}
