#include <gtest/gtest.h>

#include "iecode/formats/format_detector.h"
#include "iecode/types.h"

#include <array>
#include <cstring>
#include <vector>

using iecode::formats::FileFormat;
using iecode::formats::detect;
using iecode::formats::format_name;

/// Buffer trop court -> Unknown
TEST(FormatDetectorTest, TooShort) {
    const std::array<uint8_t, 2> data = {0x00, 0x01};
    EXPECT_EQ(detect(data), FileFormat::Unknown);
}

/// Buffer vide -> Unknown
TEST(FormatDetectorTest, Empty) {
    const std::span<const uint8_t> empty;
    EXPECT_EQ(detect(empty), FileFormat::Unknown);
}

/// Magic "G4TX" (big-endian: 0x47 0x34 0x54 0x58)
TEST(FormatDetectorTest, G4txMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'G'; data[1] = '4'; data[2] = 'T'; data[3] = 'X';
    EXPECT_EQ(detect(data), FileFormat::G4TX);
}

/// Magic "G4MG" (big-endian)
TEST(FormatDetectorTest, G4mgMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'G'; data[1] = '4'; data[2] = 'M'; data[3] = 'G';
    EXPECT_EQ(detect(data), FileFormat::G4MG);
}

/// Magic "G4MD" (big-endian)
TEST(FormatDetectorTest, G4mdMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'G'; data[1] = '4'; data[2] = 'M'; data[3] = 'D';
    EXPECT_EQ(detect(data), FileFormat::G4MD);
}

/// Magic "CPK " (little-endian: 0x43 0x50 0x4B 0x20)
TEST(FormatDetectorTest, CpkMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'C'; data[1] = 'P'; data[2] = 'K'; data[3] = ' ';
    EXPECT_EQ(detect(data), FileFormat::CPK);
}

/// Magic "@UTF" (big-endian: 0x40 0x55 0x54 0x46)
TEST(FormatDetectorTest, UtfMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = '@'; data[1] = 'U'; data[2] = 'T'; data[3] = 'F';
    EXPECT_EQ(detect(data), FileFormat::UTF);
}

/// Magic "RDBNP" (5 octets)
TEST(FormatDetectorTest, RdbnMagic) {
    std::array<uint8_t, 16> data{};
    std::memcpy(data.data(), "RDBNP", 5);
    EXPECT_EQ(detect(data), FileFormat::RDBN);
}

/// Magic "CRILAYLA" (8 octets)
TEST(FormatDetectorTest, CrilaylaMagic) {
    std::array<uint8_t, 16> data{};
    std::memcpy(data.data(), "CRILAYLA\0", 8);
    EXPECT_EQ(detect(data), FileFormat::CRILAYLA);
}

/// Magic "CRID" -> USM
TEST(FormatDetectorTest, UsmMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'C'; data[1] = 'R'; data[2] = 'I'; data[3] = 'D';
    EXPECT_EQ(detect(data), FileFormat::USM);
}

/// Magic "SSZL" -> SSZL (InazumaLZSS)
TEST(FormatDetectorTest, SszlMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'S'; data[1] = 'S'; data[2] = 'Z'; data[3] = 'L';
    EXPECT_EQ(detect(data), FileFormat::SSZL);
}

/// Magic "ANMC" -> ANM
TEST(FormatDetectorTest, AnmcMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'A'; data[1] = 'N'; data[2] = 'M'; data[3] = 'C';
    EXPECT_EQ(detect(data), FileFormat::ANM);
}

/// Magic "ANMV" -> ANM
TEST(FormatDetectorTest, AnmvMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'A'; data[1] = 'N'; data[2] = 'M'; data[3] = 'V';
    EXPECT_EQ(detect(data), FileFormat::ANM);
}

/// Donnees aleatoires -> Unknown
TEST(FormatDetectorTest, RandomData) {
    const std::array<uint8_t, 16> data = {
        0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03, 0x04,
        0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C
    };
    EXPECT_EQ(detect(data), FileFormat::Unknown);
}

/// format_name retourne le bon nom pour chaque format
TEST(FormatDetectorTest, FormatNames) {
    EXPECT_EQ(format_name(FileFormat::G4TX), "G4TX");
    EXPECT_EQ(format_name(FileFormat::CPK), "CPK");
    EXPECT_EQ(format_name(FileFormat::Unknown), "Unknown");
    EXPECT_EQ(format_name(FileFormat::RDBN), "RDBN");
    EXPECT_EQ(format_name(FileFormat::CRILAYLA), "CRILAYLA");
    EXPECT_EQ(format_name(FileFormat::SSZL), "SSZL");
    EXPECT_EQ(format_name(FileFormat::ANM), "ANM");
}
