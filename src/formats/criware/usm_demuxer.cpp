#include "iecode/formats/criware/usm_demuxer.h"

#include "iecode/types.h"

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <unordered_map>

namespace iecode::criware {

namespace {

// ── Helpers de lecture ────────────────────────────────────────────────

/// Lit un uint32 big-endian depuis un pointeur brut.
[[nodiscard]] inline uint32_t usm_read_u32(const uint8_t* p) noexcept {
    return iecode::read_u32_be(p);
}

/// Lit un uint16 big-endian depuis un pointeur brut.
[[nodiscard]] inline uint16_t usm_read_u16(const uint8_t* p) noexcept {
    return iecode::read_u16_be(p);
}

/// Determine si un stmid correspond a un flux video.
[[nodiscard]] inline bool is_video_stmid(uint32_t stmid) noexcept {
    return stmid == USM_STMID_SFV;
}

/// Determine si un stmid correspond a un flux audio.
[[nodiscard]] inline bool is_audio_stmid(uint32_t stmid) noexcept {
    return stmid == USM_STMID_SFA;
}

/// Detecte le codec video depuis les premiers octets du payload.
/// VP9 : octet de frame header commence avec des patterns specifiques.
/// En pratique, on detecte VP9 si les octets ne ressemblent pas a du H.264.
[[nodiscard]] std::string detect_video_codec(std::span<const uint8_t> payload) {
    if (payload.size() < 4) return "unknown";

    // VP9 frame sync code : les 3 premiers bits du premier octet sont le frame marker (0b10)
    // VP9 superframe marker : dernier octet & 0xE0 == 0xC0
    // Heuristique simple : H.264 commence souvent par un NAL unit (0x00 0x00 0x00 0x01 ou 0x00 0x00 0x01)
    if (payload[0] == 0x00 && payload[1] == 0x00 &&
        (payload[2] == 0x01 || (payload[2] == 0x00 && payload.size() > 3 && payload[3] == 0x01))) {
        return "h264";
    }

    // Par defaut pour ce jeu, c'est du VP9
    return "vp9";
}

/// Detecte le codec audio depuis les premiers octets du payload.
[[nodiscard]] std::string detect_audio_codec(std::span<const uint8_t> payload) {
    if (payload.size() < 4) return "unknown";

    // HCA : magic "HCA\0" (0x48 0x43 0x41 0x00) ou "HCA " (0x48 0x43 0x41 0x20)
    if (payload[0] == 0x48 && payload[1] == 0x43 && payload[2] == 0x41) {
        return "hca";
    }

    // ADX : magic 0x80 0x00
    if (payload[0] == 0x80 && payload[1] == 0x00) {
        return "adx";
    }

    return "unknown";
}

/// Parse un chunk USM a la position donnee.
/// Retourne nullopt si le chunk est invalide ou depasse les bornes.
[[nodiscard]] std::optional<UsmChunk> parse_chunk(std::span<const uint8_t> data,
                                                   size_t pos) {
    if (pos + USM_CHUNK_HEADER_SIZE > data.size()) {
        return std::nullopt;
    }

    UsmChunk chunk;
    const uint8_t* p = data.data() + pos;

    // offset 0x00 : stmid (uint32 BE)
    chunk.stmid = usm_read_u32(p);

    // offset 0x04 : chunk_size (uint32 BE) — taille totale incluant le header
    chunk.chunk_size = usm_read_u32(p + 4);

    // Validation : le chunk ne doit pas depasser les donnees
    if (pos + chunk.chunk_size > data.size()) {
        spdlog::warn("usm: chunk a 0x{:X} depasse les donnees (size={}, remain={})",
                      pos, chunk.chunk_size, data.size() - pos);
        return std::nullopt;
    }

    // Validation : chunk_size doit etre >= taille du header
    if (chunk.chunk_size < USM_CHUNK_HEADER_SIZE) {
        spdlog::warn("usm: chunk a 0x{:X} trop petit (size={})", pos, chunk.chunk_size);
        return std::nullopt;
    }

    // offset 0x08 : r01 (uint16 BE) — reserve
    // offset 0x0A : r02 (uint8)     — reserve
    // offset 0x0B : type (uint8)    — 0=header, 1=stream, 2=end
    chunk.type = static_cast<UsmChunkType>(p[0x0B]);

    // offset 0x0C : frame_time (uint32 BE)
    chunk.frame_time = usm_read_u32(p + 0x0C);

    // offset 0x10 : frame_rate (uint32 BE)
    chunk.frame_rate = usm_read_u32(p + 0x10);

    // offset 0x14 : r04 (uint32 BE) — reserve

    // offset 0x18 : data_offset (uint16 BE)
    chunk.data_offset = usm_read_u16(p + 0x18);

    // offset 0x1A : padding_size (uint16 BE)
    chunk.padding_size = usm_read_u16(p + 0x1A);

    // Validation du data_offset
    if (chunk.data_offset < USM_CHUNK_HEADER_SIZE) {
        // Certains fichiers utilisent 0 comme data_offset (= pas de sub-header)
        // Dans ce cas, les donnees commencent apres le header standard
        if (chunk.data_offset == 0) {
            chunk.data_offset = static_cast<uint16_t>(USM_CHUNK_HEADER_SIZE);
        }
    }

    // Calculer la taille du payload utile
    if (chunk.data_offset >= chunk.chunk_size) {
        // Pas de payload
        return chunk;
    }

    const size_t available = chunk.chunk_size - chunk.data_offset;
    if (chunk.padding_size > available) {
        spdlog::warn("usm: padding ({}) > available ({}) dans chunk a 0x{:X}",
                      chunk.padding_size, available, pos);
        chunk.padding_size = 0;
    }

    const size_t payload_size = available - chunk.padding_size;
    if (payload_size > 0) {
        const size_t payload_start = pos + chunk.data_offset;
        chunk.payload.assign(data.begin() + static_cast<ptrdiff_t>(payload_start),
                             data.begin() + static_cast<ptrdiff_t>(payload_start + payload_size));
    }

    return chunk;
}

// ── IVF container pour VP9 ───────────────────────────────────────────

/// Taille du header IVF.
constexpr size_t IVF_HEADER_SIZE = 32;

/// Taille du header de frame IVF.
constexpr size_t IVF_FRAME_HEADER_SIZE = 12;

/// Ecrit le header IVF pour VP9.
void write_ivf_header(std::ofstream& out, uint16_t width, uint16_t height,
                      uint32_t fps_num, uint32_t fps_den, uint32_t frame_count) {
    uint8_t hdr[IVF_HEADER_SIZE] = {};

    // Signature "DKIF"
    hdr[0] = 'D'; hdr[1] = 'K'; hdr[2] = 'I'; hdr[3] = 'F';

    // Version = 0 (uint16 LE)
    iecode::write_u16_le(hdr + 4, 0);

    // Header size = 32 (uint16 LE)
    iecode::write_u16_le(hdr + 6, IVF_HEADER_SIZE);

    // Codec FourCC "VP90" (uint32 LE)
    hdr[8] = 'V'; hdr[9] = 'P'; hdr[10] = '9'; hdr[11] = '0';

    // Width (uint16 LE)
    iecode::write_u16_le(hdr + 12, width);

    // Height (uint16 LE)
    iecode::write_u16_le(hdr + 14, height);

    // FPS numerator (uint32 LE)
    iecode::write_u32_le(hdr + 16, fps_num);

    // FPS denominator (uint32 LE)
    iecode::write_u32_le(hdr + 20, fps_den);

    // Frame count (uint32 LE)
    iecode::write_u32_le(hdr + 24, frame_count);

    // Unused (uint32 LE) = 0
    iecode::write_u32_le(hdr + 28, 0);

    out.write(reinterpret_cast<const char*>(hdr), IVF_HEADER_SIZE);
}

/// Ecrit un header de frame IVF.
void write_ivf_frame_header(std::ofstream& out, uint32_t frame_size, uint64_t timestamp) {
    uint8_t fhdr[IVF_FRAME_HEADER_SIZE] = {};

    // Frame size (uint32 LE)
    iecode::write_u32_le(fhdr, frame_size);

    // Timestamp (uint64 LE)
    iecode::write_u64_le(fhdr + 4, timestamp);

    out.write(reinterpret_cast<const char*>(fhdr), IVF_FRAME_HEADER_SIZE);
}

} // namespace

// ── API publique ─────────────────────────────────────────────────────

const char* usm_stmid_name(uint32_t stmid) noexcept {
    switch (stmid) {
        case USM_STMID_CRID: return "CRID";
        case USM_STMID_SFV:  return "@SFV";
        case USM_STMID_SFA:  return "@SFA";
        case USM_STMID_SPI:  return "@SPI";
        case USM_STMID_CUI:  return "@CUI";
        default:             return "????";
    }
}

std::optional<UsmFile> usm_parse_header(std::span<const uint8_t> data) {
    if (data.size() < USM_CHUNK_HEADER_SIZE) {
        spdlog::error("usm_parse_header: donnees trop courtes ({} octets)", data.size());
        return std::nullopt;
    }

    // Verifier le magic CRID
    const uint32_t magic = usm_read_u32(data.data());
    if (magic != USM_STMID_CRID) {
        spdlog::error("usm_parse_header: magic invalide (attendu CRID/0x{:08X}, recu 0x{:08X})",
                       USM_STMID_CRID, magic);
        return std::nullopt;
    }

    UsmFile file;

    // Map stmid -> index dans streams
    std::unordered_map<uint32_t, size_t> stream_map;

    size_t pos = 0;
    size_t chunk_count = 0;

    while (pos + USM_CHUNK_HEADER_SIZE <= data.size()) {
        auto chunk_opt = parse_chunk(data, pos);
        if (!chunk_opt) break;

        auto& chunk = *chunk_opt;
        const uint32_t stmid = chunk.stmid;

        // Avancer au prochain chunk
        pos += chunk.chunk_size;
        ++chunk_count;

        // Ignorer CRID pour le stream map (c'est le header global)
        if (stmid == USM_STMID_CRID) {
            continue;
        }

        // Trouver ou creer le flux
        auto it = stream_map.find(stmid);
        if (it == stream_map.end()) {
            UsmStream stream;
            stream.stmid = stmid;
            stream.codec = "unknown";

            stream_map[stmid] = file.streams.size();
            file.streams.push_back(std::move(stream));
            it = stream_map.find(stmid);
        }

        auto& stream = file.streams[it->second];

        // Pour les chunks header (type=0), extraire les metadonnees
        if (chunk.type == UsmChunkType::Header) {
            // Les metadonnees des flux sont dans les chunks header.
            // On ne stocke pas ces chunks dans la liste des chunks du stream.
            // Mais on tente de detecter le codec depuis le premier chunk stream.
            continue;
        }

        // Pour les chunks stream (type=1), detecter le codec si pas encore fait
        if (chunk.type == UsmChunkType::Stream && stream.codec == "unknown" &&
            !chunk.payload.empty()) {
            if (is_video_stmid(stmid)) {
                stream.codec = detect_video_codec(chunk.payload);
            } else if (is_audio_stmid(stmid)) {
                stream.codec = detect_audio_codec(chunk.payload);
            }
        }

        // Stocker le chunk
        stream.chunks.push_back(std::move(chunk));
    }

    spdlog::debug("usm_parse_header: {} chunks parses, {} flux trouves",
                   chunk_count, file.streams.size());

    for (const auto& s : file.streams) {
        spdlog::debug("  flux {} ({}): {} chunks",
                       usm_stmid_name(s.stmid), s.codec, s.chunks.size());
    }

    return file;
}

uint64_t usm_demux(std::span<const uint8_t> data,
                    const std::filesystem::path& output_dir,
                    std::string_view base_name,
                    bool verbose) {
    namespace fs = std::filesystem;

    auto file_opt = usm_parse_header(data);
    if (!file_opt) {
        spdlog::error("usm_demux: echec du parsing");
        return 0;
    }

    auto& file = *file_opt;
    if (file.streams.empty()) {
        spdlog::warn("usm_demux: aucun flux trouve");
        return 0;
    }

    // Creer le repertoire de sortie
    std::error_code ec;
    fs::create_directories(output_dir, ec);
    if (ec) {
        spdlog::error("usm_demux: impossible de creer '{}': {}",
                       output_dir.string(), ec.message());
        return 0;
    }

    uint64_t total_written = 0;
    uint32_t audio_index = 0;

    for (auto& stream : file.streams) {
        if (stream.chunks.empty()) continue;

        // Filtrer les chunks de type Stream uniquement
        std::vector<UsmChunk*> stream_chunks;
        for (auto& c : stream.chunks) {
            if (c.type == UsmChunkType::Stream && !c.payload.empty()) {
                stream_chunks.push_back(&c);
            }
        }

        if (stream_chunks.empty()) continue;

        if (is_video_stmid(stream.stmid)) {
            // ── Flux video ───────────────────────────────────────────
            if (stream.codec == "vp9") {
                // Ecrire dans un conteneur IVF
                const auto out_path = output_dir / fmt::format("{}_video.ivf", base_name);
                std::ofstream out(out_path, std::ios::binary);
                if (!out) {
                    spdlog::error("usm_demux: impossible de creer '{}'", out_path.string());
                    continue;
                }

                // Determiner le framerate depuis le premier chunk
                uint32_t fps_num = 30;
                uint32_t fps_den = 1;
                if (!stream_chunks.empty() && stream_chunks[0]->frame_rate > 0) {
                    fps_num = stream_chunks[0]->frame_rate;
                    // Le frame_rate dans USM est souvent 30000, avec un denominateur implicite de 1001
                    if (fps_num >= 23000 && fps_num <= 60000) {
                        fps_den = 1000;
                    }
                }

                // Ecrire le header IVF (on ne connait pas la resolution, defaut 0x0)
                const auto frame_count = static_cast<uint32_t>(stream_chunks.size());
                write_ivf_header(out, static_cast<uint16_t>(stream.width),
                                 static_cast<uint16_t>(stream.height),
                                 fps_num, fps_den, frame_count);

                uint64_t timestamp = 0;
                for (const auto* chunk : stream_chunks) {
                    const auto frame_size = static_cast<uint32_t>(chunk->payload.size());
                    write_ivf_frame_header(out, frame_size, timestamp);
                    out.write(reinterpret_cast<const char*>(chunk->payload.data()),
                              static_cast<std::streamsize>(chunk->payload.size()));
                    ++timestamp;
                }

                const auto bytes_written = static_cast<uint64_t>(out.tellp());
                total_written += bytes_written;

                if (verbose) {
                    spdlog::info("usm_demux: video VP9 -> '{}' ({} frames, {} octets)",
                                  out_path.filename().string(), frame_count, bytes_written);
                }
            } else {
                // H.264 : ecrire les NAL units bruts
                const auto ext = (stream.codec == "h264") ? "264" : "bin";
                const auto out_path = output_dir / fmt::format("{}_video.{}", base_name, ext);
                std::ofstream out(out_path, std::ios::binary);
                if (!out) {
                    spdlog::error("usm_demux: impossible de creer '{}'", out_path.string());
                    continue;
                }

                for (const auto* chunk : stream_chunks) {
                    out.write(reinterpret_cast<const char*>(chunk->payload.data()),
                              static_cast<std::streamsize>(chunk->payload.size()));
                }

                const auto bytes_written = static_cast<uint64_t>(out.tellp());
                total_written += bytes_written;

                if (verbose) {
                    spdlog::info("usm_demux: video {} -> '{}' ({} chunks, {} octets)",
                                  stream.codec, out_path.filename().string(),
                                  stream_chunks.size(), bytes_written);
                }
            }
        } else if (is_audio_stmid(stream.stmid)) {
            // ── Flux audio ───────────────────────────────────────────
            const auto ext = (stream.codec == "adx") ? "adx" : "hca";
            const auto out_path = output_dir / fmt::format("{}_audio_{}.{}",
                                                            base_name, audio_index, ext);
            std::ofstream out(out_path, std::ios::binary);
            if (!out) {
                spdlog::error("usm_demux: impossible de creer '{}'", out_path.string());
                ++audio_index;
                continue;
            }

            for (const auto* chunk : stream_chunks) {
                out.write(reinterpret_cast<const char*>(chunk->payload.data()),
                          static_cast<std::streamsize>(chunk->payload.size()));
            }

            const auto bytes_written = static_cast<uint64_t>(out.tellp());
            total_written += bytes_written;

            if (verbose) {
                spdlog::info("usm_demux: audio {} -> '{}' ({} chunks, {} octets)",
                              stream.codec, out_path.filename().string(),
                              stream_chunks.size(), bytes_written);
            }

            ++audio_index;
        } else {
            // ── Autres flux (sous-titres, alpha, etc.) ───────────────
            const auto out_path = output_dir / fmt::format("{}_stream_{:08X}.bin",
                                                            base_name, stream.stmid);
            std::ofstream out(out_path, std::ios::binary);
            if (!out) continue;

            for (const auto* chunk : stream_chunks) {
                out.write(reinterpret_cast<const char*>(chunk->payload.data()),
                          static_cast<std::streamsize>(chunk->payload.size()));
            }

            const auto bytes_written = static_cast<uint64_t>(out.tellp());
            total_written += bytes_written;

            if (verbose) {
                spdlog::info("usm_demux: stream {:08X} -> '{}' ({} chunks, {} octets)",
                              stream.stmid, out_path.filename().string(),
                              stream_chunks.size(), bytes_written);
            }
        }
    }

    spdlog::info("usm_demux: {} flux extraits, {} octets ecrits au total",
                  file.streams.size(), total_written);

    return total_written;
}

} // namespace iecode::criware
