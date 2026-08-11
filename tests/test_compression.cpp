#include <gtest/gtest.h>

#include "iecode/compression/huffman.h"
#include "iecode/compression/level5_compress.h"
#include "iecode/compression/rle.h"
#include "iecode/compression/zlib_decompress.h"

#include <zlib.h>

#include <cstdint>
#include <vector>

using namespace iecode::compression;

// ═══════════════════════════════════════════════════════════════════
// Utilitaires
// ═══════════════════════════════════════════════════════════════════

namespace {

/// Construit un header Level-5 : methode + taille 24-bit LE.
std::vector<uint8_t> make_level5_header(uint8_t method, uint32_t decompressed_size) {
    if (decompressed_size < 0x1000000) {
        // Taille sur 24 bits
        return {
            method,
            static_cast<uint8_t>(decompressed_size & 0xFF),
            static_cast<uint8_t>((decompressed_size >> 8) & 0xFF),
            static_cast<uint8_t>((decompressed_size >> 16) & 0xFF),
        };
    }
    // Taille etendue sur 32 bits (24-bit = 0)
    return {
        method, 0x00, 0x00, 0x00,
        static_cast<uint8_t>(decompressed_size & 0xFF),
        static_cast<uint8_t>((decompressed_size >> 8) & 0xFF),
        static_cast<uint8_t>((decompressed_size >> 16) & 0xFF),
        static_cast<uint8_t>((decompressed_size >> 24) & 0xFF),
    };
}

} // namespace

// ═══════════════════════════════════════════════════════════════════
// Tests RLE
// ═══════════════════════════════════════════════════════════════════

TEST(RleDecompress, EmptyInput) {
    auto result = rle_decompress({});
    EXPECT_FALSE(result.has_value());
}

TEST(RleDecompress, TooShort) {
    const uint8_t tiny[] = {0x04, 0x01};
    auto result = rle_decompress(tiny);
    EXPECT_FALSE(result.has_value());
}

TEST(RleDecompress, CompressedRun) {
    // Header methode 4, taille = 5
    // Flag 0x82 = bit7 set, longueur = (0x02 & 0x7F) + 3 = 5
    // Valeur = 0xAB
    // Resultat attendu : 5x 0xAB
    std::vector<uint8_t> input = {
        0x04, 0x05, 0x00, 0x00,  // header: methode=4, size=5
        0x82,                      // flag: compressed, count = 2+3 = 5
        0xAB,                      // valeur a repeter
    };

    auto result = rle_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 5u);
    for (auto b : *result) {
        EXPECT_EQ(b, 0xAB);
    }
}

TEST(RleDecompress, UncompressedRun) {
    // Header methode 4, taille = 4
    // Flag 0x03 = bit7 clear, copier (3 + 1) = 4 octets
    std::vector<uint8_t> input = {
        0x04, 0x04, 0x00, 0x00,  // header: methode=4, size=4
        0x03,                      // flag: uncompressed, count = 3+1 = 4
        0x11, 0x22, 0x33, 0x44,  // 4 octets verbatim
    };

    auto result = rle_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 4u);
    EXPECT_EQ((*result)[0], 0x11);
    EXPECT_EQ((*result)[1], 0x22);
    EXPECT_EQ((*result)[2], 0x33);
    EXPECT_EQ((*result)[3], 0x44);
}

TEST(RleDecompress, MixedRuns) {
    // Taille decompresee = 7
    // Run compresse : 3 x 0xFF  (flag 0x80, count = 0+3 = 3)
    // Run non-compresse : 4 octets (flag 0x03, count = 3+1 = 4)
    std::vector<uint8_t> input = {
        0x04, 0x07, 0x00, 0x00,  // header: methode=4, size=7
        0x80, 0xFF,              // compresse: 3 x 0xFF
        0x03,                     // non-compresse: 4 octets
        0xAA, 0xBB, 0xCC, 0xDD,
    };

    auto result = rle_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 7u);
    EXPECT_EQ((*result)[0], 0xFF);
    EXPECT_EQ((*result)[1], 0xFF);
    EXPECT_EQ((*result)[2], 0xFF);
    EXPECT_EQ((*result)[3], 0xAA);
    EXPECT_EQ((*result)[4], 0xBB);
    EXPECT_EQ((*result)[5], 0xCC);
    EXPECT_EQ((*result)[6], 0xDD);
}

TEST(RleDecompress, ExtendedHeader) {
    // Header etendu : taille 24-bit = 0, taille 32-bit dans octets 4-7
    std::vector<uint8_t> input = {
        0x04, 0x00, 0x00, 0x00,       // header: methode=4, size24=0
        0x03, 0x00, 0x00, 0x00,       // size32=3
        0x80, 0x42,                    // compresse: 3 x 0x42
    };

    auto result = rle_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 3u);
    for (auto b : *result) {
        EXPECT_EQ(b, 0x42);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Tests ZLib
// ═══════════════════════════════════════════════════════════════════

TEST(ZlibDecompress, EmptyInput) {
    auto result = zlib_decompress({});
    EXPECT_FALSE(result.has_value());
}

TEST(ZlibDecompress, TooShort) {
    const uint8_t tiny[] = {0x05, 0x01};
    auto result = zlib_decompress(tiny);
    EXPECT_FALSE(result.has_value());
}

TEST(ZlibDecompress, RoundTrip) {
    // Donnees de test
    const std::vector<uint8_t> original = {
        0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x2C, 0x20, 0x57,
        0x6F, 0x72, 0x6C, 0x64, 0x21, 0x00, 0x00, 0x00,
    };

    // Compresser avec zlib
    uLongf compressed_len = compressBound(static_cast<uLong>(original.size()));
    std::vector<uint8_t> compressed(compressed_len);
    int ret = ::compress(compressed.data(), &compressed_len,
                         original.data(), static_cast<uLong>(original.size()));
    ASSERT_EQ(ret, Z_OK);
    compressed.resize(static_cast<size_t>(compressed_len));

    // Construire le buffer Level-5 : header + donnees zlib
    auto header = make_level5_header(5, static_cast<uint32_t>(original.size()));
    std::vector<uint8_t> input;
    input.insert(input.end(), header.begin(), header.end());
    input.insert(input.end(), compressed.begin(), compressed.end());

    // Decompresser
    auto result = zlib_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), original.size());
    EXPECT_EQ(*result, original);
}

TEST(ZlibDecompress, CorruptedData) {
    // Header valide mais donnees zlib corrompues
    std::vector<uint8_t> input = {
        0x05, 0x10, 0x00, 0x00,        // header: methode=5, size=16
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF,  // donnees invalides
    };

    auto result = zlib_decompress(input);
    EXPECT_FALSE(result.has_value());
}

// ═══════════════════════════════════════════════════════════════════
// Tests Huffman
// ═══════════════════════════════════════════════════════════════════

TEST(Huffman4Decompress, EmptyInput) {
    auto result = huffman4_decompress({});
    EXPECT_FALSE(result.has_value());
}

TEST(Huffman8Decompress, EmptyInput) {
    auto result = huffman8_decompress({});
    EXPECT_FALSE(result.has_value());
}

TEST(Huffman4Decompress, TooShort) {
    const uint8_t tiny[] = {0x02, 0x01};
    auto result = huffman4_decompress(tiny);
    EXPECT_FALSE(result.has_value());
}

TEST(Huffman8Decompress, TooShort) {
    const uint8_t tiny[] = {0x03, 0x01};
    auto result = huffman8_decompress(tiny);
    EXPECT_FALSE(result.has_value());
}

TEST(Huffman8Decompress, SingleNodeTree) {
    // Arbre Huffman trivial : un seul noeud racine avec deux feuilles identiques.
    //
    // Format de la table d'arbre (spec GBATEK / Nintendo) :
    // - tree_size = 1 → table = (1+1)*2 = 4 octets de donnees apres l'octet tree_size
    // - Noeud racine : 0xC0 = bits 7+6 set (deux enfants feuilles), offset=0
    // - Feuille gauche : 0x42
    // - Feuille droite : 0x42
    // - Padding : 0x00 (inutilise, complete la table)
    //
    // Bitstream : bits 0,0 → deux fois feuille gauche = 0x42
    std::vector<uint8_t> input = {
        0x03, 0x02, 0x00, 0x00,  // header: methode=3, size=2
        0x01,                     // tree_size = 1 → table = 4 octets
        0xC0,                     // [1] racine: deux feuilles, offset=0
        0x42,                     // [2] feuille gauche = 0x42
        0x42,                     // [3] feuille droite = 0x42
        0x00,                     // [4] padding (complete la table)
        0x00, 0x00, 0x00, 0x00,  // bitstream: mot LE 0x00000000, bits 0,0
    };

    auto result = huffman8_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 2u);
    EXPECT_EQ((*result)[0], 0x42);
    EXPECT_EQ((*result)[1], 0x42);
}

TEST(Huffman8Decompress, TwoSymbols) {
    // Arbre avec deux symboles differents :
    // Racine : 0xC0 (deux feuilles, offset=0)
    // Feuille gauche (bit 0) : 0xAA
    // Feuille droite (bit 1) : 0xBB
    //
    // tree_size = 1 → table = (1+1)*2 = 4 octets de donnees
    //
    // Bitstream pour decoder 3 octets (0xAA, 0xBB, 0xAA) :
    // Bits MSB-first dans un mot LE 32-bit : 0, 1, 0
    // Mot = 0x40000000 → en LE bytes : 0x00, 0x00, 0x00, 0x40
    // bit 31=0 (gauche=0xAA), bit 30=1 (droite=0xBB), bit 29=0 (gauche=0xAA)
    std::vector<uint8_t> input = {
        0x03, 0x03, 0x00, 0x00,  // header: methode=3, size=3
        0x01,                     // tree_size = 1 → table = 4 octets
        0xC0,                     // [1] racine: deux feuilles, offset=0
        0xAA,                     // [2] feuille gauche
        0xBB,                     // [3] feuille droite
        0x00,                     // [4] padding (complete la table)
        // Bitstream : mot LE 0x40000000 → bits 0,1,0,...
        0x00, 0x00, 0x00, 0x40,
    };

    auto result = huffman8_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 3u);
    EXPECT_EQ((*result)[0], 0xAA);
    EXPECT_EQ((*result)[1], 0xBB);
    EXPECT_EQ((*result)[2], 0xAA);
}

TEST(Huffman4Decompress, SimpleNibbles) {
    // Arbre identique au test TwoSymbols mais en mode 4-bit.
    // Racine : 0xC0 (deux feuilles, offset=0)
    // Feuille gauche (bit 0) : 0x05
    // Feuille droite (bit 1) : 0x0A
    //
    // tree_size = 1 → table = (1+1)*2 = 4 octets de donnees
    //
    // Pour 1 octet de sortie, il faut 2 nibbles (2 symboles).
    // Premier symbole = nibble bas, second = nibble haut.
    // Bits: 0, 1 → symboles 0x05, 0x0A → octet = 0x05 | (0x0A << 4) = 0xA5
    std::vector<uint8_t> input = {
        0x02, 0x01, 0x00, 0x00,  // header: methode=2, size=1
        0x01,                     // tree_size = 1 → table = 4 octets
        0xC0,                     // [1] racine: deux feuilles, offset=0
        0x05,                     // [2] feuille gauche = nibble 0x5
        0x0A,                     // [3] feuille droite = nibble 0xA
        0x00,                     // [4] padding (complete la table)
        // Bitstream : mot LE 0x40000000 → bits 0,1
        0x00, 0x00, 0x00, 0x40,
    };

    auto result = huffman4_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 1u);
    EXPECT_EQ((*result)[0], 0xA5);
}

// ═══════════════════════════════════════════════════════════════════
// Tests Level5 Dispatcher
// ═══════════════════════════════════════════════════════════════════

TEST(Level5Method, DetectMethods) {
    // Methode 1 = LZ10
    const uint8_t lz10[] = {0x01, 0x00, 0x00, 0x00};
    EXPECT_EQ(detect_level5_method(lz10), Level5Method::LZ10);

    // Methode 2 = Huffman4
    const uint8_t huf4[] = {0x02, 0x00, 0x00, 0x00};
    EXPECT_EQ(detect_level5_method(huf4), Level5Method::HUFFMAN4);

    // Methode 3 = Huffman8
    const uint8_t huf8[] = {0x03, 0x00, 0x00, 0x00};
    EXPECT_EQ(detect_level5_method(huf8), Level5Method::HUFFMAN8);

    // Methode 4 = RLE
    const uint8_t rle[] = {0x04, 0x00, 0x00, 0x00};
    EXPECT_EQ(detect_level5_method(rle), Level5Method::RLE);

    // Methode 5 = ZLib
    const uint8_t zlib[] = {0x05, 0x00, 0x00, 0x00};
    EXPECT_EQ(detect_level5_method(zlib), Level5Method::ZLIB);
}

TEST(Level5Method, DetectUnknown) {
    const uint8_t unknown[] = {0xFF, 0x00, 0x00, 0x00};
    EXPECT_EQ(detect_level5_method(unknown), Level5Method::NONE);
}

TEST(Level5Method, EmptyInput) {
    EXPECT_EQ(detect_level5_method({}), Level5Method::NONE);
}

TEST(Level5Size, Read24Bit) {
    // Taille 24-bit = 0x000304 = 772
    const uint8_t data[] = {0x01, 0x04, 0x03, 0x00};
    EXPECT_EQ(level5_decompressed_size(data), 772u);
}

TEST(Level5Size, ReadExtended32Bit) {
    // Taille 24-bit = 0 → lire 32-bit
    const uint8_t data[] = {
        0x01, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x01, 0x00, // 65536
    };
    EXPECT_EQ(level5_decompressed_size(data), 65536u);
}

TEST(Level5Size, TooShort) {
    const uint8_t tiny[] = {0x01};
    EXPECT_EQ(level5_decompressed_size(tiny), 0u);
}

TEST(Level5Decompress, DispatchRle) {
    // Construit un flux RLE Level-5 valide et verifie que le dispatcher le route
    std::vector<uint8_t> input = {
        0x04, 0x03, 0x00, 0x00,  // header: methode=4 (RLE), size=3
        0x80, 0x55,              // compresse: 3 x 0x55
    };

    auto result = level5_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 3u);
    for (auto b : *result) {
        EXPECT_EQ(b, 0x55);
    }
}

TEST(Level5Decompress, DispatchZlib) {
    // Compresser des donnees avec zlib, puis envelopper dans un header Level-5
    const std::vector<uint8_t> original = {0x01, 0x02, 0x03, 0x04, 0x05};

    uLongf compressed_len = compressBound(static_cast<uLong>(original.size()));
    std::vector<uint8_t> compressed(compressed_len);
    int ret = ::compress(compressed.data(), &compressed_len,
                         original.data(), static_cast<uLong>(original.size()));
    ASSERT_EQ(ret, Z_OK);
    compressed.resize(static_cast<size_t>(compressed_len));

    auto header = make_level5_header(5, static_cast<uint32_t>(original.size()));
    std::vector<uint8_t> input;
    input.insert(input.end(), header.begin(), header.end());
    input.insert(input.end(), compressed.begin(), compressed.end());

    auto result = level5_decompress(input);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(*result, original);
}

TEST(Level5Decompress, UnknownMethod) {
    const uint8_t data[] = {0xFF, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
    auto result = level5_decompress(data);
    EXPECT_FALSE(result.has_value());
}

TEST(Level5Decompress, DispatchLz10) {
    // Construire un flux LZ10 Level-5 valide (methode 1)
    // avec des literals uniquement
    std::vector<uint8_t> input = {
        0x01, 0x04, 0x00, 0x00,  // header: methode=1 (LZ10), size=4
        0x00,                      // flags: 8 literals
        0xAA, 0xBB, 0xCC, 0xDD,  // 4 literal bytes
    };

    auto result = level5_decompress(input);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->size(), 4u);
    EXPECT_EQ((*result)[0], 0xAA);
    EXPECT_EQ((*result)[1], 0xBB);
    EXPECT_EQ((*result)[2], 0xCC);
    EXPECT_EQ((*result)[3], 0xDD);
}
