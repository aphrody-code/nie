#include <gtest/gtest.h>

#include "iecode/formats/criware/usm_demuxer.h"
#include "iecode/types.h"

#include <array>
#include <cstring>
#include <vector>

using iecode::criware::usm_parse_header;
using iecode::criware::usm_stmid_name;
using iecode::criware::USM_STMID_CRID;
using iecode::criware::USM_STMID_SFV;
using iecode::criware::USM_STMID_SFA;
using iecode::criware::USM_CHUNK_HEADER_SIZE;
using iecode::criware::UsmChunkType;

// ══════════════════════════════════════════════════════════════════════
//  Helpers pour construire des chunks USM synthetiques
// ══════════════════════════════════════════════════════════════════════

namespace {

/// Ecrit un chunk USM complet dans un vecteur a la position donnee.
/// Le chunk fait exactement USM_CHUNK_HEADER_SIZE + payload_size + padding_size octets.
void write_usm_chunk(std::vector<uint8_t>& buf, size_t pos,
                     uint32_t stmid, UsmChunkType type,
                     uint32_t frame_time, uint32_t frame_rate,
                     const std::vector<uint8_t>& payload,
                     uint16_t padding_size = 0) {
    const auto data_offset = static_cast<uint16_t>(USM_CHUNK_HEADER_SIZE);
    const auto chunk_size = static_cast<uint32_t>(
        USM_CHUNK_HEADER_SIZE + payload.size() + padding_size);

    // S'assurer que le buffer est assez grand
    if (pos + chunk_size > buf.size()) {
        buf.resize(pos + chunk_size, 0);
    }

    uint8_t* p = buf.data() + pos;

    // stmid (uint32 BE)
    iecode::write_u32_be(p, stmid);

    // chunk_size (uint32 BE)
    iecode::write_u32_be(p + 4, chunk_size);

    // r01 (uint16 BE) = 0
    iecode::write_u16_be(p + 8, 0);

    // r02 (uint8) = 0
    p[0x0A] = 0;

    // type (uint8)
    p[0x0B] = static_cast<uint8_t>(type);

    // frame_time (uint32 BE)
    iecode::write_u32_be(p + 0x0C, frame_time);

    // frame_rate (uint32 BE)
    iecode::write_u32_be(p + 0x10, frame_rate);

    // r04 (uint32 BE) = 0
    iecode::write_u32_be(p + 0x14, 0);

    // data_offset (uint16 BE)
    iecode::write_u16_be(p + 0x18, data_offset);

    // padding_size (uint16 BE)
    iecode::write_u16_be(p + 0x1A, padding_size);

    // Payload
    if (!payload.empty()) {
        std::memcpy(p + data_offset, payload.data(), payload.size());
    }
}

} // namespace

// ══════════════════════════════════════════════════════════════════════
//  Tests USM
// ══════════════════════════════════════════════════════════════════════

/// Donnees trop courtes -> parsing echoue.
TEST(UsmTest, TooSmallReturnsNullopt) {
    const std::array<uint8_t, 8> tiny = {};
    EXPECT_FALSE(usm_parse_header(tiny).has_value());
}

/// Magic invalide -> parsing echoue.
TEST(UsmTest, InvalidMagicReturnsNullopt) {
    std::vector<uint8_t> data(64, 0xAA);
    EXPECT_FALSE(usm_parse_header(data).has_value());
}

/// Un seul chunk CRID valide (header minimal).
TEST(UsmTest, MinimalCridChunk) {
    std::vector<uint8_t> buf;
    write_usm_chunk(buf, 0, USM_STMID_CRID, UsmChunkType::Header, 0, 0, {});

    auto result = usm_parse_header(buf);
    ASSERT_TRUE(result.has_value());
    // Pas de flux — juste le header CRID
    EXPECT_TRUE(result->streams.empty());
}

/// CRID + un chunk @SFV video (type=Stream).
TEST(UsmTest, CridPlusVideoChunk) {
    std::vector<uint8_t> buf;

    // Chunk CRID (header global)
    write_usm_chunk(buf, 0, USM_STMID_CRID, UsmChunkType::Header, 0, 0, {});
    const auto crid_end = buf.size();

    // Chunk @SFV (video stream) — payload = quelques octets arbitraires (VP9-like)
    std::vector<uint8_t> video_payload = {0x82, 0x49, 0x83, 0x42, 0x00, 0x00, 0x00, 0x00};
    write_usm_chunk(buf, crid_end, USM_STMID_SFV, UsmChunkType::Stream,
                    0, 30000, video_payload);

    auto result = usm_parse_header(buf);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->streams.size(), 1u);

    const auto& stream = result->streams[0];
    EXPECT_EQ(stream.stmid, USM_STMID_SFV);
    EXPECT_EQ(stream.codec, "vp9");
    ASSERT_EQ(stream.chunks.size(), 1u);
    EXPECT_EQ(stream.chunks[0].type, UsmChunkType::Stream);
    EXPECT_EQ(stream.chunks[0].frame_rate, 30000u);
    EXPECT_EQ(stream.chunks[0].payload.size(), video_payload.size());
}

/// CRID + un chunk @SFA audio (type=Stream) avec magic HCA.
TEST(UsmTest, CridPlusAudioChunk) {
    std::vector<uint8_t> buf;

    // Chunk CRID
    write_usm_chunk(buf, 0, USM_STMID_CRID, UsmChunkType::Header, 0, 0, {});
    const auto crid_end = buf.size();

    // Chunk @SFA (audio stream) — payload commence par "HCA\0"
    std::vector<uint8_t> audio_payload = {'H', 'C', 'A', 0x00, 0x01, 0x02, 0x03, 0x04};
    write_usm_chunk(buf, crid_end, USM_STMID_SFA, UsmChunkType::Stream,
                    0, 0, audio_payload);

    auto result = usm_parse_header(buf);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->streams.size(), 1u);

    const auto& stream = result->streams[0];
    EXPECT_EQ(stream.stmid, USM_STMID_SFA);
    EXPECT_EQ(stream.codec, "hca");
    ASSERT_EQ(stream.chunks.size(), 1u);
    EXPECT_EQ(stream.chunks[0].payload.size(), audio_payload.size());
}

/// Chunks header (type=0) sont ignores dans la liste des chunks du flux.
TEST(UsmTest, HeaderChunksIgnored) {
    std::vector<uint8_t> buf;

    // CRID
    write_usm_chunk(buf, 0, USM_STMID_CRID, UsmChunkType::Header, 0, 0, {});
    size_t pos = buf.size();

    // @SFV header (type=0) — metadonnees, pas de donnees stream
    write_usm_chunk(buf, pos, USM_STMID_SFV, UsmChunkType::Header, 0, 0, {0x01, 0x02});
    pos = buf.size();

    // @SFV stream (type=1) — donnees reelles
    std::vector<uint8_t> payload(16, 0x42);
    write_usm_chunk(buf, pos, USM_STMID_SFV, UsmChunkType::Stream, 0, 30000, payload);

    auto result = usm_parse_header(buf);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->streams.size(), 1u);

    // Seul le chunk stream est present (le header est ignore)
    ASSERT_EQ(result->streams[0].chunks.size(), 1u);
    EXPECT_EQ(result->streams[0].chunks[0].type, UsmChunkType::Stream);
}

/// Padding est correctement soustrait du payload.
TEST(UsmTest, PaddingSubtractedFromPayload) {
    std::vector<uint8_t> buf;

    // CRID
    write_usm_chunk(buf, 0, USM_STMID_CRID, UsmChunkType::Header, 0, 0, {});
    const auto crid_end = buf.size();

    // @SFV stream avec 4 octets de padding
    std::vector<uint8_t> payload = {0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08};
    const uint16_t padding = 4;
    write_usm_chunk(buf, crid_end, USM_STMID_SFV, UsmChunkType::Stream,
                    0, 30000, payload, padding);

    auto result = usm_parse_header(buf);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->streams.size(), 1u);
    ASSERT_EQ(result->streams[0].chunks.size(), 1u);

    // Le padding est une zone supplementaire apres les donnees utiles.
    // Le chunk total fait header + payload + padding.
    // Le parser extrait : (chunk_size - data_offset) - padding_size = payload.size()
    // car write_usm_chunk place payload ET padding dans le chunk.
    EXPECT_EQ(result->streams[0].chunks[0].payload.size(), payload.size());
}

/// usm_stmid_name retourne les noms corrects.
TEST(UsmTest, StmidNames) {
    EXPECT_STREQ(usm_stmid_name(USM_STMID_CRID), "CRID");
    EXPECT_STREQ(usm_stmid_name(USM_STMID_SFV), "@SFV");
    EXPECT_STREQ(usm_stmid_name(USM_STMID_SFA), "@SFA");
    EXPECT_STREQ(usm_stmid_name(0x12345678), "????");
}

/// Plusieurs flux video et audio dans le meme fichier.
TEST(UsmTest, MultipleStreams) {
    std::vector<uint8_t> buf;

    // CRID
    write_usm_chunk(buf, 0, USM_STMID_CRID, UsmChunkType::Header, 0, 0, {});
    size_t pos = buf.size();

    // @SFV stream (video)
    std::vector<uint8_t> vp = {0x82, 0x49, 0x00, 0x00};
    write_usm_chunk(buf, pos, USM_STMID_SFV, UsmChunkType::Stream, 0, 30000, vp);
    pos = buf.size();

    // @SFA stream (audio HCA)
    std::vector<uint8_t> ap = {'H', 'C', 'A', 0x00};
    write_usm_chunk(buf, pos, USM_STMID_SFA, UsmChunkType::Stream, 0, 0, ap);
    pos = buf.size();

    // @SFV stream (video frame 2)
    write_usm_chunk(buf, pos, USM_STMID_SFV, UsmChunkType::Stream, 1, 30000, vp);
    pos = buf.size();

    // @SFA stream (audio frame 2)
    write_usm_chunk(buf, pos, USM_STMID_SFA, UsmChunkType::Stream, 1, 0, ap);

    auto result = usm_parse_header(buf);
    ASSERT_TRUE(result.has_value());
    ASSERT_EQ(result->streams.size(), 2u);

    // Video : 2 chunks
    EXPECT_EQ(result->streams[0].stmid, USM_STMID_SFV);
    EXPECT_EQ(result->streams[0].chunks.size(), 2u);

    // Audio : 2 chunks
    EXPECT_EQ(result->streams[1].stmid, USM_STMID_SFA);
    EXPECT_EQ(result->streams[1].chunks.size(), 2u);
}
