#include <gtest/gtest.h>

#include "iecode/formats/level5/g4pk.h"
#include "iecode/types.h"

#include <array>
#include <cstring>
#include <vector>

using iecode::level5::g4pk_parse;
using iecode::level5::g4pk_extract_entry;
using iecode::level5::G4pkEntry;

/// Donnees trop courtes -> parsing echoue (retourne nullopt).
TEST(G4pkTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 16> tiny = {};
    EXPECT_FALSE(g4pk_parse(tiny).has_value());
}

/// Magic invalide -> parsing echoue.
TEST(G4pkTest, InvalidMagicReturnsNullopt) {
    // 64 octets de zeros — magic invalide
    std::vector<uint8_t> data(64, 0);
    EXPECT_FALSE(g4pk_parse(data).has_value());
}

/// Magic correct "G4PK" (LE = 0x4B503447) mais 0 fichiers -> archive vide valide.
TEST(G4pkTest, EmptyArchiveIsValid) {
    // Construire un header G4PK minimal avec 0 fichiers
    std::vector<uint8_t> data(64, 0);

    // Magic "G4PK" en little-endian : 0x47, 0x34, 0x50, 0x4B
    data[0] = 0x47;
    data[1] = 0x34;
    data[2] = 0x50;
    data[3] = 0x4B;

    // header_size = 0x40 (64)
    data[4] = 0x40;
    data[5] = 0x00;

    // file_count a offset 0x20 = 0
    // (deja zero)

    auto parsed = g4pk_parse(data);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->entries.size(), 0u);
    EXPECT_EQ(parsed->header_size, 0x40);
}

/// g4pk_extract_entry retourne un span vide pour une entree hors limites.
TEST(G4pkTest, ExtractEntryOutOfBoundsReturnsEmpty) {
    std::vector<uint8_t> archive(128, 0xAA);

    G4pkEntry entry;
    entry.name = "test.bin";
    entry.offset = 200;  // Hors limites (archive = 128 octets)
    entry.size = 32;

    auto result = g4pk_extract_entry(archive, entry);
    EXPECT_TRUE(result.empty());
}

/// g4pk_extract_entry retourne les bonnes donnees pour une entree valide.
TEST(G4pkTest, ExtractEntryValidReturnsCorrectData) {
    std::vector<uint8_t> archive(256, 0);
    // Ecrire un pattern reconnaissable a l'offset 64
    for (size_t i = 0; i < 16; ++i) {
        archive[64 + i] = static_cast<uint8_t>(0xDE + i);
    }

    G4pkEntry entry;
    entry.name = "pattern.bin";
    entry.offset = 64;
    entry.size = 16;

    auto result = g4pk_extract_entry(archive, entry);
    ASSERT_EQ(result.size(), 16u);
    EXPECT_EQ(result[0], 0xDE);
    EXPECT_EQ(result[1], 0xDF);
    EXPECT_EQ(result[15], static_cast<uint8_t>(0xDE + 15));
}

/// g4pk_extract_entry avec taille 0 retourne un span vide.
TEST(G4pkTest, ExtractEntryZeroSizeReturnsEmpty) {
    std::vector<uint8_t> archive(128, 0);

    G4pkEntry entry;
    entry.name = "empty.bin";
    entry.offset = 32;
    entry.size = 0;

    auto result = g4pk_extract_entry(archive, entry);
    EXPECT_TRUE(result.empty());
}
