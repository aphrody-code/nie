#include <gtest/gtest.h>
#include "iecode/formats/dds_parser.h"

#include <array>
#include <cstring>

using namespace iecode::formats;

// ── Helper : construire un header DDS minimal valide ───────────────

/// Construit un fichier DDS minimal avec un header DXT1 4x4 (un bloc).
static std::vector<uint8_t> make_dds_bc1(uint32_t width, uint32_t height,
                                          const std::vector<uint8_t>& pixel_data = {}) {
    // Header DDS = 128 octets
    std::vector<uint8_t> data(128, 0);
    auto* p = data.data();

    // Magic "DDS "
    p[0] = 0x44; p[1] = 0x44; p[2] = 0x53; p[3] = 0x20;

    // DDS_HEADER.dwSize = 124
    iecode::write_u32_le(p + 0x04, 124);

    // DDS_HEADER.dwFlags (CAPS | HEIGHT | WIDTH | PIXELFORMAT | LINEARSIZE)
    iecode::write_u32_le(p + 0x08, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000);

    // Dimensions
    iecode::write_u32_le(p + 0x0C, height);
    iecode::write_u32_le(p + 0x10, width);

    // PitchOrLinearSize
    const uint32_t blocks_x = (width + 3) / 4;
    const uint32_t blocks_y = (height + 3) / 4;
    iecode::write_u32_le(p + 0x14, blocks_x * blocks_y * 8);

    // MipMapCount = 1
    iecode::write_u32_le(p + 0x1C, 1);

    // DDS_PIXELFORMAT a l'offset 0x50 (absolu)
    iecode::write_u32_le(p + 0x50, 32);           // pf_size
    iecode::write_u32_le(p + 0x54, DDPF_FOURCC);  // pf_flags
    iecode::write_u32_le(p + 0x58, FOURCC_DXT1);  // pf_fourcc = "DXT1"

    // Caps
    iecode::write_u32_le(p + 0x70, 0x1000);       // DDSCAPS_TEXTURE

    // Ajouter les donnees pixel
    data.insert(data.end(), pixel_data.begin(), pixel_data.end());
    return data;
}

/// Construit un fichier DDS BC3 (DXT5).
static std::vector<uint8_t> make_dds_bc3(uint32_t width, uint32_t height,
                                          const std::vector<uint8_t>& pixel_data = {}) {
    auto data = make_dds_bc1(width, height, {});
    auto* p = data.data();

    // Changer le FourCC en DXT5
    iecode::write_u32_le(p + 0x58, FOURCC_DXT5);

    // Mettre a jour le LinearSize (16 octets par bloc pour BC3)
    const uint32_t blocks_x = (width + 3) / 4;
    const uint32_t blocks_y = (height + 3) / 4;
    iecode::write_u32_le(p + 0x14, blocks_x * blocks_y * 16);

    data.insert(data.end(), pixel_data.begin(), pixel_data.end());
    return data;
}

// ── Tests de validation ────────────────────────────────────────────

TEST(DdsParser, IsValidEmpty) {
    EXPECT_FALSE(dds_is_valid({}));
}

TEST(DdsParser, IsValidTooShort) {
    const uint8_t tiny[] = {0x44, 0x44, 0x53};
    EXPECT_FALSE(dds_is_valid(tiny));
}

TEST(DdsParser, IsValidCorrectMagic) {
    const uint8_t magic[] = {0x44, 0x44, 0x53, 0x20};
    EXPECT_TRUE(dds_is_valid(magic));
}

TEST(DdsParser, IsValidWrongMagic) {
    const uint8_t wrong[] = {0xFF, 0xFF, 0xFF, 0xFF};
    EXPECT_FALSE(dds_is_valid(wrong));
}

// ── Tests de parsing du header ─────────────────────────────────────

TEST(DdsParser, ParseHeaderTooShort) {
    const uint8_t magic[] = {0x44, 0x44, 0x53, 0x20};
    EXPECT_FALSE(dds_parse_header(magic).has_value());
}

TEST(DdsParser, ParseHeaderInvalidMagic) {
    std::vector<uint8_t> data(128, 0);
    data[0] = 0xFF;
    EXPECT_FALSE(dds_parse_header(data).has_value());
}

TEST(DdsParser, ParseHeaderZeroDimensions) {
    auto data = make_dds_bc1(0, 0);
    // Dimensions nulles = invalide
    EXPECT_FALSE(dds_parse_header(data).has_value());
}

TEST(DdsParser, ParseHeaderBC1Valid) {
    auto data = make_dds_bc1(256, 128);
    auto hdr = dds_parse_header(data);
    ASSERT_TRUE(hdr.has_value());
    EXPECT_EQ(hdr->magic, DDS_MAGIC);
    EXPECT_EQ(hdr->size, 124u);
    EXPECT_EQ(hdr->width, 256u);
    EXPECT_EQ(hdr->height, 128u);
    EXPECT_EQ(hdr->mipmap_count, 1u);
    EXPECT_TRUE(hdr->has_fourcc());
    EXPECT_TRUE(hdr->is_bc1());
    EXPECT_FALSE(hdr->is_bc3());
    EXPECT_FALSE(hdr->has_dx10_extension());
    EXPECT_EQ(hdr->data_offset(), 128u);
}

TEST(DdsParser, ParseHeaderBC3Valid) {
    auto data = make_dds_bc3(64, 64);
    auto hdr = dds_parse_header(data);
    ASSERT_TRUE(hdr.has_value());
    EXPECT_EQ(hdr->width, 64u);
    EXPECT_EQ(hdr->height, 64u);
    EXPECT_TRUE(hdr->is_bc3());
    EXPECT_FALSE(hdr->is_bc1());
}

// ── Tests d'acces aux donnees pixel ────────────────────────────────

TEST(DdsParser, PixelDataEmpty) {
    auto pixels = dds_pixel_data({});
    EXPECT_TRUE(pixels.empty());
}

TEST(DdsParser, PixelDataHeaderOnly) {
    auto data = make_dds_bc1(4, 4);
    // Header uniquement, pas de donnees pixel
    auto pixels = dds_pixel_data(data);
    EXPECT_TRUE(pixels.empty());
}

TEST(DdsParser, PixelDataWithBlocks) {
    // Un bloc BC1 4x4 = 8 octets
    std::vector<uint8_t> block(8, 0xAA);
    auto data = make_dds_bc1(4, 4, block);
    auto pixels = dds_pixel_data(data);
    EXPECT_EQ(pixels.size(), 8u);
}

// ── Tests de decompression BC1 ─────────────────────────────────────

TEST(DdsParser, DecompressBC1EmptyInput) {
    auto result = dds_decompress_bc1({}, 4, 4);
    EXPECT_TRUE(result.empty());
}

TEST(DdsParser, DecompressBC1ZeroDimensions) {
    const uint8_t block[8] = {};
    auto result = dds_decompress_bc1(block, 0, 0);
    EXPECT_TRUE(result.empty());
}

TEST(DdsParser, DecompressBC1SingleBlock) {
    // Bloc BC1 : couleur0=blanc (0xFFFF), couleur1=noir (0x0000), indices=0
    // Tous les pixels utilisent la couleur 0 (blanc)
    uint8_t block[8] = {};
    // RGB565 blanc = 0xFFFF (R=31, G=63, B=31)
    block[0] = 0xFF; block[1] = 0xFF;
    // RGB565 noir = 0x0000
    block[2] = 0x00; block[3] = 0x00;
    // Indices : tous a 0 (couleur 0 = blanc)
    block[4] = 0x00; block[5] = 0x00; block[6] = 0x00; block[7] = 0x00;

    auto result = dds_decompress_bc1(block, 4, 4);
    ASSERT_EQ(result.size(), 4u * 4u * 4u); // 4x4 pixels RGBA8

    // Verifier que le premier pixel est blanc (ou quasi-blanc)
    // bcdec decode en RGBA, les valeurs exactes dependent de l'expansion 5/6/5->8
    EXPECT_GT(result[0], 200); // R quasi-blanc
    EXPECT_GT(result[1], 200); // G quasi-blanc
    EXPECT_GT(result[2], 200); // B quasi-blanc
    EXPECT_EQ(result[3], 255); // A opaque
}

TEST(DdsParser, DecompressBC1OutputSize) {
    // Texture 8x8 = 4 blocs BC1 = 32 octets en entree
    std::vector<uint8_t> blocks(32, 0);
    auto result = dds_decompress_bc1(blocks, 8, 8);
    EXPECT_EQ(result.size(), 8u * 8u * 4u);
}

TEST(DdsParser, DecompressBC1NonMultipleOf4) {
    // Texture 5x5 — arrondie a 2x2 blocs = 4 blocs BC1
    std::vector<uint8_t> blocks(4 * 8, 0);
    auto result = dds_decompress_bc1(blocks, 5, 5);
    // Le resultat doit etre exactement 5x5 pixels (pas 8x8)
    EXPECT_EQ(result.size(), 5u * 5u * 4u);
}

// ── Tests de decompression BC3 ─────────────────────────────────────

TEST(DdsParser, DecompressBC3EmptyInput) {
    auto result = dds_decompress_bc3({}, 4, 4);
    EXPECT_TRUE(result.empty());
}

TEST(DdsParser, DecompressBC3SingleBlock) {
    // Bloc BC3 : 8 octets alpha + 8 octets couleur = 16 octets
    uint8_t block[16] = {};
    // Alpha : alpha0=255, alpha1=0, indices tous a 0 (alpha0=255)
    block[0] = 0xFF; block[1] = 0x00;
    // Les 6 octets suivants = indices alpha (tous 0 => alpha0=255)
    // Couleur : blanc, indices 0
    block[8] = 0xFF; block[9] = 0xFF;  // couleur0 = blanc
    block[10] = 0x00; block[11] = 0x00; // couleur1 = noir

    auto result = dds_decompress_bc3(block, 4, 4);
    ASSERT_EQ(result.size(), 4u * 4u * 4u);

    // Verifier le premier pixel
    EXPECT_GT(result[0], 200); // R
    EXPECT_GT(result[1], 200); // G
    EXPECT_GT(result[2], 200); // B
    EXPECT_EQ(result[3], 255); // A
}

TEST(DdsParser, DecompressBC3OutputSize) {
    // Texture 8x8 = 4 blocs BC3 = 64 octets en entree
    std::vector<uint8_t> blocks(64, 0);
    auto result = dds_decompress_bc3(blocks, 8, 8);
    EXPECT_EQ(result.size(), 8u * 8u * 4u);
}

// ── Tests FourCC to string ─────────────────────────────────────────

TEST(DdsParser, FourCCToStringDXT1) {
    EXPECT_EQ(dds_fourcc_to_string(FOURCC_DXT1), "DXT1");
}

TEST(DdsParser, FourCCToStringDXT5) {
    EXPECT_EQ(dds_fourcc_to_string(FOURCC_DXT5), "DXT5");
}

TEST(DdsParser, FourCCToStringDX10) {
    EXPECT_EQ(dds_fourcc_to_string(FOURCC_DX10), "DX10");
}

TEST(DdsParser, FourCCToStringNonPrintable) {
    auto result = dds_fourcc_to_string(0x00010203);
    // Doit retourner un format hexadecimal
    EXPECT_TRUE(result.find("0x") != std::string::npos);
}

// ── Test d'integration header + decompression ──────────────────────

TEST(DdsParser, FullPipelineBC1) {
    // Creer un DDS BC1 4x4 complet avec un bloc de donnees
    uint8_t block[8] = {};
    // Couleur uniforme noire
    std::vector<uint8_t> block_vec(block, block + 8);
    auto dds_data = make_dds_bc1(4, 4, block_vec);

    // Parser le header
    auto hdr = dds_parse_header(dds_data);
    ASSERT_TRUE(hdr.has_value());
    EXPECT_EQ(hdr->width, 4u);
    EXPECT_EQ(hdr->height, 4u);
    EXPECT_TRUE(hdr->is_bc1());

    // Extraire les donnees pixel
    auto pixels = dds_pixel_data(dds_data);
    ASSERT_EQ(pixels.size(), 8u);

    // Decompresser
    auto rgba = dds_decompress_bc1(pixels, hdr->width, hdr->height);
    ASSERT_EQ(rgba.size(), 4u * 4u * 4u);
}
