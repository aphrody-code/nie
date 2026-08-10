#include <gtest/gtest.h>

#include "iecode/crypto/crc32.h"
#include "iecode/types.h"

#include <array>
#include <cstring>
#include <vector>

using iecode::crypto::crc32_compute;

/// Vecteur vide -> CRC32 = 0x00000000
TEST(Crc32Test, EmptyBuffer) {
    const std::span<const uint8_t> empty;
    EXPECT_EQ(crc32_compute(empty), 0x00000000u);
}

/// Vecteur de reference "123456789" -> CRC32 = 0xCBF43926
/// (valeur standard ITU-T V.42 / zlib)
TEST(Crc32Test, CheckValue123456789) {
    const std::string_view input = "123456789";
    EXPECT_EQ(crc32_compute(input), 0xCBF43926u);
}

/// Test avec un buffer d'un seul octet
TEST(Crc32Test, SingleByte) {
    const std::array<uint8_t, 1> data = {0x00};
    EXPECT_EQ(crc32_compute(data), 0xD202EF8Du);
}

/// Test incremental : la seed permet de chainer les calculs
TEST(Crc32Test, IncrementalComputation) {
    const std::string_view full = "123456789";
    const auto full_crc = crc32_compute(full);

    // Calcul en deux morceaux
    const std::string_view part1 = "12345";
    const std::string_view part2 = "6789";

    const auto crc1 = crc32_compute(
        std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(part1.data()), part1.size()));
    const auto crc2 = crc32_compute(crc1,
        std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(part2.data()), part2.size()));

    EXPECT_EQ(crc2, full_crc);
}

/// Test avec la cle CRI XOR connue
TEST(Crc32Test, CriXorKeyIsKnown) {
    // La cle XOR CRI est 0x1717E18E — on verifie juste qu'elle est definie
    EXPECT_EQ(iecode::CRI_XOR_KEY, 0x1717E18Eu);
}

/// Test CRC32 sur une chaine string_view
TEST(Crc32Test, StringViewOverload) {
    const auto crc_sv = crc32_compute(std::string_view("test"));

    std::vector<uint8_t> bytes = {'t', 'e', 's', 't'};
    const auto crc_span = crc32_compute(std::span<const uint8_t>(bytes));

    EXPECT_EQ(crc_sv, crc_span);
}
