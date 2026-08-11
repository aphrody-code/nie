#include <gtest/gtest.h>
#include "iecode/compression/lz4_block.h"

using namespace iecode::compression;

TEST(Lz4Block, EmptyInput) {
    EXPECT_TRUE(lz4_decompress({}, 0).empty());
    EXPECT_TRUE(lz4_decompress({}, 100).empty());
}

TEST(Lz4Block, LiteralsOnly) {
    // LZ4 block : token=0x40 (4 literals, 0 match), suivi de 4 octets
    // Token : high nibble = 4 (literal length), low nibble = 0 (match length - ignored for last)
    const uint8_t input[] = {
        0x40,                      // token: 4 literals, 0 match
        0xDE, 0xAD, 0xBE, 0xEF    // 4 literal bytes
    };

    auto result = lz4_decompress(input, 4);
    ASSERT_EQ(result.size(), 4u);
    EXPECT_EQ(result[0], 0xDE);
    EXPECT_EQ(result[1], 0xAD);
    EXPECT_EQ(result[2], 0xBE);
    EXPECT_EQ(result[3], 0xEF);
}

TEST(Lz4Block, LiteralPlusMatch) {
    // Token: 0x41 = 4 literals + match of 4+1=5
    // Literals: AA BB CC DD
    // Offset: 0x04 0x00 (offset=4, points to beginning)
    // This should produce: AA BB CC DD AA BB CC DD AA
    // But match length = (1+4)=5, so: AA BB CC DD + 5 bytes from offset 4 back
    // = AA BB CC DD AA BB CC DD AA
    const uint8_t input[] = {
        0x41,                      // token: 4 literals, match_len = 1+4 = 5
        0xAA, 0xBB, 0xCC, 0xDD,   // 4 literals
        0x04, 0x00                 // offset = 4
    };

    auto result = lz4_decompress(input, 9);
    ASSERT_EQ(result.size(), 9u);
    EXPECT_EQ(result[0], 0xAA);
    EXPECT_EQ(result[3], 0xDD);
    // Match copies from offset 4 back = position 0
    EXPECT_EQ(result[4], 0xAA);
    EXPECT_EQ(result[7], 0xDD);
    EXPECT_EQ(result[8], 0xAA);
}

TEST(Lz4Block, ZeroOffsetFails) {
    // Token with literals then zero offset should fail
    const uint8_t input[] = {
        0x11,              // 1 literal + match
        0xFF,              // literal
        0x00, 0x00         // offset = 0 (invalid)
    };

    auto result = lz4_decompress(input, 10);
    EXPECT_TRUE(result.empty());
}
