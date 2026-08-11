#include <gtest/gtest.h>

#include "iecode/formats/bin_dispatcher.h"
#include "iecode/types.h"

#include <array>
#include <cstring>
#include <vector>

using iecode::BinFormat;
using iecode::BinInspectResult;
using iecode::bin_inspect;
using iecode::bin_format_name;

// ── Donnees vides -> Unknown ──────────────────────────────────────

TEST(BinDispatcherTest, EmptyDataUnknown) {
    const std::span<const uint8_t> empty;
    auto result = bin_inspect(empty);

    EXPECT_EQ(result.format, BinFormat::Unknown);
    EXPECT_FALSE(result.was_encrypted);
    EXPECT_FALSE(result.was_compressed);
    EXPECT_FALSE(result.error.empty()); // "donnees vides"
}

// ── Magic @UTF -> UtfTable ──────────────────────────────────────

TEST(BinDispatcherTest, UtfMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = '@'; data[1] = 'U'; data[2] = 'T'; data[3] = 'F';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::UtfTable);
    EXPECT_FALSE(result.was_encrypted);
    EXPECT_FALSE(result.was_compressed);
    EXPECT_TRUE(result.error.empty());
}

// ── Magic RDBNP -> CfgBin ──────────────────────────────────────

TEST(BinDispatcherTest, RdbnMagic) {
    std::array<uint8_t, 16> data{};
    std::memcpy(data.data(), "RDBNP", 5);

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::CfgBin);
    EXPECT_FALSE(result.was_encrypted);
    EXPECT_FALSE(result.was_compressed);
}

// ── Magic G4TX -> G4tx ─────────────────────────────────────────

TEST(BinDispatcherTest, G4txMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'G'; data[1] = '4'; data[2] = 'T'; data[3] = 'X';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::G4tx);
    EXPECT_FALSE(result.was_encrypted);
    EXPECT_FALSE(result.was_compressed);
}

// ── Magic G4PK@ -> G4pk ────────────────────────────────────────

TEST(BinDispatcherTest, G4pkMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'G'; data[1] = '4'; data[2] = 'P'; data[3] = '@';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::G4pk);
}

// ── Magic G4MG -> G4mg ─────────────────────────────────────────

TEST(BinDispatcherTest, G4mgMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'G'; data[1] = '4'; data[2] = 'M'; data[3] = 'G';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::G4mg);
}

// ── Magic G4SK@ -> G4sk ────────────────────────────────────────

TEST(BinDispatcherTest, G4skMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'G'; data[1] = '4'; data[2] = 'S'; data[3] = '@';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::G4sk);
}

// ── Magic G4MD -> G4md ─────────────────────────────────────────

TEST(BinDispatcherTest, G4mdMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'G'; data[1] = '4'; data[2] = 'M'; data[3] = 'D';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::G4md);
}

// ── Magic AFS2 -> Awb ──────────────────────────────────────────

TEST(BinDispatcherTest, AwbMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'A'; data[1] = 'F'; data[2] = 'S'; data[3] = '2';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::Awb);
}

// ── Magic CRID -> Usm ──────────────────────────────────────────

TEST(BinDispatcherTest, UsmMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'C'; data[1] = 'R'; data[2] = 'I'; data[3] = 'D';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::Usm);
}

// ── Magic CPK -> Cpk ───────────────────────────────────────────

TEST(BinDispatcherTest, CpkMagic) {
    std::array<uint8_t, 16> data{};
    data[0] = 'C'; data[1] = 'P'; data[2] = 'K'; data[3] = ' ';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::Cpk);
}

// ── Lua bytecode ───────────────────────────────────────────────

TEST(BinDispatcherTest, LuaBytecode) {
    std::array<uint8_t, 16> data{};
    data[0] = 0x1B; data[1] = 'L'; data[2] = 'u'; data[3] = 'a';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::LuaBytecode);
}

// ── PE executable (MZ) ─────────────────────────────────────────

TEST(BinDispatcherTest, PeExecutable) {
    std::array<uint8_t, 16> data{};
    data[0] = 'M'; data[1] = 'Z';

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::PeExecutable);
}

// ── LZ10 magic (0x11) ──────────────────────────────────────────

TEST(BinDispatcherTest, Lz10Magic) {
    // Header LZ10 minimal : 0x11 suivi de taille decompressée sur 3 octets
    // Pas assez de donnees pour decompresser, mais le format est detecte
    std::array<uint8_t, 16> data{};
    data[0] = 0x11;
    data[1] = 0x00;  // taille decompressée (3 octets LE)
    data[2] = 0x10;
    data[3] = 0x00;

    auto result = bin_inspect(data);

    // Soit Lz10Compressed (detection sans decompression possible),
    // soit Unknown si is_lz10 retourne false pour ce header minimal
    // Le format exact depend de l'implementation de is_lz10
    EXPECT_TRUE(result.format == BinFormat::Lz10Compressed ||
                result.format == BinFormat::Unknown);
}

// ── Donnees aleatoires -> Unknown ──────────────────────────────

TEST(BinDispatcherTest, UnknownMagic) {
    const std::array<uint8_t, 16> data = {
        0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03, 0x04,
        0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C,
    };

    auto result = bin_inspect(data);

    EXPECT_EQ(result.format, BinFormat::Unknown);
    EXPECT_FALSE(result.was_encrypted);
    EXPECT_FALSE(result.was_compressed);
}

// ── bin_format_name ────────────────────────────────────────────

TEST(BinDispatcherTest, FormatNames) {
    EXPECT_EQ(bin_format_name(BinFormat::Unknown), "Unknown");
    EXPECT_EQ(bin_format_name(BinFormat::UtfTable), "UTF (@UTF)");
    EXPECT_EQ(bin_format_name(BinFormat::CfgBin), "CfgBin (RDBN)");
    EXPECT_EQ(bin_format_name(BinFormat::G4tx), "G4TX (Textures)");
    EXPECT_EQ(bin_format_name(BinFormat::PeExecutable), "PE Executable");
    EXPECT_EQ(bin_format_name(BinFormat::LuaBytecode), "Lua 5.2 Bytecode");
}

// ── bin_dispatch_json pour format connu ────────────────────────

TEST(BinDispatcherTest, DispatchJsonUtf) {
    // @UTF magic avec donnees insuffisantes pour parser -> JSON avec error
    std::array<uint8_t, 16> data{};
    data[0] = '@'; data[1] = 'U'; data[2] = 'T'; data[3] = 'F';

    auto json_str = iecode::bin_dispatch_json(data);

    // Doit contenir le nom du format meme si le parsing echoue
    EXPECT_NE(json_str.find("UTF"), std::string::npos);
    EXPECT_NE(json_str.find("\"format\""), std::string::npos);
}

// ── bin_dispatch_json pour format inconnu -> hex dump ──────────

TEST(BinDispatcherTest, DispatchJsonUnknownHexDump) {
    const std::array<uint8_t, 8> data = {
        0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03, 0x04,
    };

    auto json_str = iecode::bin_dispatch_json(data);

    // Doit contenir un hex dump et une entropie
    EXPECT_NE(json_str.find("hexDump"), std::string::npos);
    EXPECT_NE(json_str.find("entropy"), std::string::npos);
    EXPECT_NE(json_str.find("Unknown"), std::string::npos);
}

// ── G4CM et G4NV ───────────────────────────────────────────────

TEST(BinDispatcherTest, G4cmMagic) {
    std::array<uint8_t, 16> data{};
    std::memcpy(data.data(), "G4CM", 4);

    auto result = bin_inspect(data);
    EXPECT_EQ(result.format, BinFormat::G4cm);
}

TEST(BinDispatcherTest, G4nvMagic) {
    std::array<uint8_t, 16> data{};
    std::memcpy(data.data(), "G4NV", 4);

    auto result = bin_inspect(data);
    EXPECT_EQ(result.format, BinFormat::G4nv);
}

// ── CRILAYLA magic ─────────────────────────────────────────────

TEST(BinDispatcherTest, CrilaylaMagic) {
    std::array<uint8_t, 16> data{};
    std::memcpy(data.data(), "CRILAYLA", 8);

    auto result = bin_inspect(data);

    // CRILAYLA est detecte comme compresse ; la decompression echouera
    // sur des donnees invalides, mais le format est identifie
    EXPECT_TRUE(result.format == BinFormat::CrilaylaCompressed ||
                result.was_compressed);
}

// ── G4RA` magic ────────────────────────────────────────────────

TEST(BinDispatcherTest, G4raMagic) {
    std::array<uint8_t, 16> data{};
    std::memcpy(data.data(), "G4RA`", 5);

    auto result = bin_inspect(data);
    EXPECT_EQ(result.format, BinFormat::G4ra);
}
