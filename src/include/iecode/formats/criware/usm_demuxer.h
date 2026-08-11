#pragma once

/// @file usm_demuxer.h
/// Demuxeur de videos USM (CRI Sofdec2).
///
/// Le format USM est un conteneur multiplexe avec des flux video (VP9/H.264),
/// audio (HCA/ADX), sous-titres et alpha. Chaque chunk a un header de 0x1C octets.
///
/// Ce module offre deux niveaux d'API :
///   - usm_parse_header() : lecture rapide des metadonnees (codec, resolution, etc.)
///   - usm_demux() : extraction complete des flux vers des fichiers

#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace iecode::criware {

// ── Constantes du format USM ─────────────────────────────────────────

/// Taille minimale d'un header de chunk USM (stmid + chunk_size + sub-header).
inline constexpr size_t USM_CHUNK_HEADER_SIZE = 0x1C;

/// Stream IDs (4 octets big-endian).
inline constexpr uint32_t USM_STMID_CRID = 0x43524944;  // "CRID" — header global
inline constexpr uint32_t USM_STMID_SFV  = 0x40534656;  // "@SFV" — video
inline constexpr uint32_t USM_STMID_SFA  = 0x40534641;  // "@SFA" — audio
inline constexpr uint32_t USM_STMID_SPI  = 0x40535049;  // "@SPI" — sous-titres/chapitres
inline constexpr uint32_t USM_STMID_CUI  = 0x40435549;  // "@CUI" — alpha/metadata

// ── Types ────────────────────────────────────────────────────────────

/// Type de section dans un chunk USM.
enum class UsmChunkType : uint8_t {
    Header = 0,   // Section d'en-tete (metadonnees @UTF)
    Stream = 1,   // Donnees de flux (video/audio brut)
    End    = 2,   // Marqueur de fin
};

/// Chunk demuxe depuis un fichier USM.
struct UsmChunk {
    uint32_t stmid = 0;          // Identifiant du flux (CRID, @SFV, @SFA, etc.)
    uint32_t chunk_size = 0;     // Taille totale du chunk (header inclus)
    UsmChunkType type = UsmChunkType::Header;
    uint32_t frame_time = 0;     // Timestamp de la frame
    uint32_t frame_rate = 0;     // Denominateur du framerate (ex: 30000)
    uint16_t data_offset = 0;    // Offset du payload depuis le debut du chunk
    uint16_t padding_size = 0;   // Taille du padding en fin de payload
    std::vector<uint8_t> payload; // Donnees utiles (sans padding)
};

/// Informations sur un flux demuxe.
struct UsmStream {
    uint32_t stmid = 0;          // Identifiant (@SFV, @SFA, etc.)
    std::string codec;           // "vp9", "h264", "hca", "adx", "unknown"
    uint32_t width = 0;          // Video uniquement
    uint32_t height = 0;         // Video uniquement
    uint32_t sample_rate = 0;    // Audio uniquement
    uint32_t channels = 0;       // Audio uniquement
    std::vector<UsmChunk> chunks; // Tous les chunks de ce flux
};

/// Fichier USM parse.
struct UsmFile {
    uint32_t version = 0;
    std::vector<UsmStream> streams;
};

// ── API ──────────────────────────────────────────────────────────────

/// Parse les en-tetes USM (fast path — metadonnees uniquement).
/// Retourne nullopt si le fichier est invalide ou trop court.
[[nodiscard]] std::optional<UsmFile> usm_parse_header(std::span<const uint8_t> data);

/// Demuxe un fichier USM complet.
/// Extrait tous les flux vers output_dir :
///   - Video VP9 : <base_name>_video.ivf (conteneur IVF)
///   - Video H.264 : <base_name>_video.264
///   - Audio HCA : <base_name>_audio_N.hca
///   - Audio ADX : <base_name>_audio_N.adx
/// @return nombre total d'octets ecrits, 0 en cas d'erreur.
[[nodiscard]] uint64_t usm_demux(std::span<const uint8_t> data,
                                  const std::filesystem::path& output_dir,
                                  std::string_view base_name,
                                  bool verbose = false);

/// Convertit un stmid en nom lisible.
[[nodiscard]] const char* usm_stmid_name(uint32_t stmid) noexcept;

} // namespace iecode::criware
