#include <gtest/gtest.h>
#include "iecode/compression/crilayla.h"

#include <cstring>

using namespace iecode::compression;

TEST(CriLayla, DetectMagic) {
    const uint8_t valid[] = {'C', 'R', 'I', 'L', 'A', 'Y', 'L', 'A', 0, 0, 0, 0, 0, 0, 0, 0};
    EXPECT_TRUE(is_crilayla(valid));

    const uint8_t invalid[] = {'C', 'R', 'I', 'L', 'A', 'Y', 'L', 'B'};
    EXPECT_FALSE(is_crilayla(invalid));
}

TEST(CriLayla, TooShort) {
    const uint8_t tiny[] = {'C', 'R', 'I', 'L'};
    EXPECT_FALSE(is_crilayla(tiny));
}

TEST(CriLayla, EmptyReturnsEmpty) {
    EXPECT_TRUE(crilayla_decompress({}).empty());
}

TEST(CriLayla, InvalidMagicReturnsEmpty) {
    const uint8_t bad[] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                           0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
    EXPECT_TRUE(crilayla_decompress(bad).empty());
}

TEST(CriLayla, HeaderTooShort) {
    const uint8_t short_header[] = {'C', 'R', 'I', 'L', 'A', 'Y', 'L', 'A',
                                     0x00, 0x00, 0x00}; // only 11 bytes
    EXPECT_TRUE(crilayla_decompress(short_header).empty());
}
