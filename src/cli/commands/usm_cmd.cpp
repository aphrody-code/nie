#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/criware/usm_demuxer.h"
#include "iecode/types.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

namespace {

/// Commande `iecode usm info <file>` — affiche les metadonnees du fichier USM.
static void cmd_usm_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto file = criware::usm_parse_header(data);
    if (!file) { emit_error("USM parse failed"); return; }

    auto streams_json = json::array();
    for (const auto& stream : file->streams) {
        json sj;
        sj["stmid"] = fmt::format("{:#010x}", stream.stmid);
        sj["stmid_name"] = criware::usm_stmid_name(stream.stmid);
        sj["codec"] = stream.codec;
        sj["chunk_count"] = stream.chunks.size();

        // Compter les chunks de type stream uniquement
        size_t stream_chunk_count = 0;
        uint64_t total_payload = 0;
        for (const auto& c : stream.chunks) {
            if (c.type == criware::UsmChunkType::Stream) {
                ++stream_chunk_count;
                total_payload += c.payload.size();
            }
        }
        sj["stream_chunks"] = stream_chunk_count;
        sj["payload_bytes"] = total_payload;

        if (stream.width > 0) sj["width"] = stream.width;
        if (stream.height > 0) sj["height"] = stream.height;
        if (stream.sample_rate > 0) sj["sample_rate"] = stream.sample_rate;
        if (stream.channels > 0) sj["channels"] = stream.channels;

        // Frame rate depuis le premier chunk stream
        for (const auto& c : stream.chunks) {
            if (c.type == criware::UsmChunkType::Stream && c.frame_rate > 0) {
                sj["frame_rate"] = c.frame_rate;
                break;
            }
        }

        streams_json.push_back(std::move(sj));
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"size", data.size()},
        {"version", file->version},
        {"stream_count", file->streams.size()},
        {"streams", std::move(streams_json)}
    });
}

/// Commande `iecode usm demux <file> [-o dir] [-v]` — extrait les flux.
static void cmd_usm_demux(const std::string& input_path,
                           const std::string& output_dir,
                           bool verbose) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    // Determiner le repertoire de sortie
    fs::path out_dir;
    if (output_dir.empty()) {
        out_dir = fs::path(input_path).parent_path() / fs::path(input_path).stem();
    } else {
        out_dir = fs::path(output_dir);
    }

    // Nom de base depuis le fichier d'entree
    const auto base_name = fs::path(input_path).stem().string();

    const auto bytes_written = criware::usm_demux(data, out_dir, base_name, verbose);

    if (bytes_written == 0) {
        emit_error("USM demux failed or produced no output");
        return;
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"output_dir", out_dir.string()},
        {"bytes_written", bytes_written}
    });
}

} // namespace

void register_usm_command(CLI::App& app) {
    auto* usm = app.add_subcommand("usm", "Operations sur les videos USM (CRI Sofdec2)");
    usm->require_subcommand(1);

    // ── usm info ──────────────────────────────────────────────────
    auto* info = usm->add_subcommand("info", "Affiche les metadonnees d'un fichier USM");
    auto* info_input = info->add_option("file", "Fichier USM a analyser")->required();
    info->callback([info_input]() {
        cmd_usm_info(info_input->as<std::string>());
    });

    // ── usm demux ─────────────────────────────────────────────────
    auto* demux = usm->add_subcommand("demux", "Extrait les flux video/audio d'un USM");
    auto* demux_input = demux->add_option("file", "Fichier USM a demuxer")->required();
    std::string demux_output;
    bool demux_verbose = false;
    demux->add_option("-o,--output", demux_output, "Repertoire de sortie");
    demux->add_flag("-v,--verbose", demux_verbose, "Affiche les details");
    demux->callback([demux_input, &demux_output, &demux_verbose]() {
        cmd_usm_demux(demux_input->as<std::string>(), demux_output, demux_verbose);
    });
}

} // namespace iecode::cli
