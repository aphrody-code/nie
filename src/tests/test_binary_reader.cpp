#include <gtest/gtest.h>

#include "iecode/io/binary_reader.h"

#include <array>
#include <vector>

using iecode::io::BinaryReader;

/// Lecture sequentielle u8
TEST(BinaryReaderTest, ReadU8) {
    const std::array<uint8_t, 3> data = {0xAA, 0xBB, 0xCC};
    BinaryReader reader(data);

    EXPECT_EQ(reader.read_u8(), 0xAA);
    EXPECT_EQ(reader.read_u8(), 0xBB);
    EXPECT_EQ(reader.read_u8(), 0xCC);
    EXPECT_EQ(reader.position(), 3u);
    EXPECT_TRUE(reader.eof());
}

/// Lecture u16 little-endian
TEST(BinaryReaderTest, ReadU16LE) {
    const std::array<uint8_t, 4> data = {0x34, 0x12, 0x78, 0x56};
    BinaryReader reader(data);

    EXPECT_EQ(reader.read_u16_le(), 0x1234u);
    EXPECT_EQ(reader.read_u16_le(), 0x5678u);
}

/// Lecture u32 little-endian
TEST(BinaryReaderTest, ReadU32LE) {
    const std::array<uint8_t, 4> data = {0x78, 0x56, 0x34, 0x12};
    BinaryReader reader(data);

    EXPECT_EQ(reader.read_u32_le(), 0x12345678u);
}

/// Lecture u16 big-endian
TEST(BinaryReaderTest, ReadU16BE) {
    const std::array<uint8_t, 2> data = {0x12, 0x34};
    BinaryReader reader(data);

    EXPECT_EQ(reader.read_u16_be(), 0x1234u);
}

/// Lecture u32 big-endian
TEST(BinaryReaderTest, ReadU32BE) {
    const std::array<uint8_t, 4> data = {0x12, 0x34, 0x56, 0x78};
    BinaryReader reader(data);

    EXPECT_EQ(reader.read_u32_be(), 0x12345678u);
}

/// Lecture au-dela du buffer retourne 0
TEST(BinaryReaderTest, ReadPastEnd) {
    const std::array<uint8_t, 2> data = {0xFF, 0xFF};
    BinaryReader reader(data);

    // u32 necessite 4 octets, on n'en a que 2
    EXPECT_EQ(reader.read_u32_le(), 0u);
    EXPECT_EQ(reader.position(), 0u);  // position inchangee
}

/// Seek et skip
TEST(BinaryReaderTest, SeekAndSkip) {
    const std::array<uint8_t, 8> data = {0, 1, 2, 3, 4, 5, 6, 7};
    BinaryReader reader(data);

    reader.seek(4);
    EXPECT_EQ(reader.position(), 4u);
    EXPECT_EQ(reader.read_u8(), 4);

    reader.skip(2);
    EXPECT_EQ(reader.position(), 7u);
    EXPECT_EQ(reader.read_u8(), 7);
}

/// Seek au-dela du buffer est clamp
TEST(BinaryReaderTest, SeekPastEnd) {
    const std::array<uint8_t, 4> data = {0, 1, 2, 3};
    BinaryReader reader(data);

    reader.seek(100);
    EXPECT_EQ(reader.position(), 4u);
    EXPECT_TRUE(reader.eof());
}

/// Remaining et size
TEST(BinaryReaderTest, RemainingAndSize) {
    const std::array<uint8_t, 8> data = {0, 1, 2, 3, 4, 5, 6, 7};
    BinaryReader reader(data);

    EXPECT_EQ(reader.size(), 8u);
    EXPECT_EQ(reader.remaining(), 8u);

    reader.skip(3);
    EXPECT_EQ(reader.remaining(), 5u);
}

/// Lecture de chaine null-terminated
TEST(BinaryReaderTest, ReadNullTerminatedString) {
    const std::array<uint8_t, 6> data = {'h', 'e', 'l', 'l', 'o', '\0'};
    BinaryReader reader(data);

    EXPECT_EQ(reader.read_null_terminated_string(), "hello");
    EXPECT_EQ(reader.position(), 6u);
}

/// Lecture de bytes bruts
TEST(BinaryReaderTest, ReadBytes) {
    const std::array<uint8_t, 4> data = {0xDE, 0xAD, 0xBE, 0xEF};
    BinaryReader reader(data);

    auto bytes = reader.read_bytes(2);
    EXPECT_EQ(bytes.size(), 2u);
    EXPECT_EQ(bytes[0], 0xDE);
    EXPECT_EQ(bytes[1], 0xAD);
    EXPECT_EQ(reader.remaining(), 2u);
}

/// Alignment
TEST(BinaryReaderTest, Alignment) {
    const std::array<uint8_t, 16> data{};
    BinaryReader reader(data);

    reader.seek(5);
    reader.align(4);
    EXPECT_EQ(reader.position(), 8u);

    // Deja aligne -> pas de changement
    reader.align(4);
    EXPECT_EQ(reader.position(), 8u);
}
