#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/criware/acb_reader.h"
#include "iecode/formats/criware/awb_reader.h"
#include "iecode/types.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

namespace {

/// Detecte le type de fichier audio CRI (ACB ou AWB).
enum class AudioType { ACB, AWB, Unknown };

[[nodiscard]] AudioType detect_audio_type(std::span<const uint8_t> data) {
    if (data.size() < 4) return AudioType::Unknown;

    // AWB/AFS2 : magic "AFS2" (0x41 0x46 0x53 0x32) en LE = 0x32534641
    const uint32_t magic_le = iecode::read_u32_le(data.data());
    if (magic_le == 0x32534641) return AudioType::AWB;

    // ACB : c'est une table @UTF (magic "@UTF" = 0x40555446 en LE)
    // ou table chiffree (magic 0x1F9EF3F5)
    if (magic_le == 0x46545540 || magic_le == 0x1F9EF3F5) return AudioType::ACB;

    return AudioType::Unknown;
}

} // namespace

// ── Info : resume du fichier audio CRI ────────────────────────────

static void cmd_audio_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    const auto type = detect_audio_type(data);

    if (type == AudioType::AWB) {
        auto parsed = criware::awb_parse(data);
        if (!parsed) { emit_error("AWB parse failed"); return; }

        auto entries_json = json::array();
        for (const auto& entry : parsed->entries) {
            entries_json.push_back(json{
                {"cue_id", entry.cue_id},
                {"offset", entry.offset},
                {"size", entry.size}
            });
        }

        emit(json{
            {"ok", true},
            {"type", "AWB"},
            {"file", fs::path(input_path).filename().string()},
            {"size", data.size()},
            {"version", parsed->version},
            {"block_size", parsed->block_size},
            {"key", fmt::format("{:#010x}", parsed->key)},
            {"entry_count", parsed->entries.size()},
            {"entries", std::move(entries_json)}
        });
    } else if (type == AudioType::ACB) {
        auto parsed = criware::acb_parse(data);
        if (!parsed) { emit_error("ACB parse failed"); return; }

        emit(json{
            {"ok", true},
            {"type", "ACB"},
            {"file", fs::path(input_path).filename().string()},
            {"size", data.size()},
            {"name", parsed->name},
            {"version", parsed->version},
            {"cue_count", parsed->cue_count},
            {"has_embedded_awb", parsed->has_embedded_awb},
            {"has_stream_awb", parsed->has_stream_awb},
            {"cue_names", parsed->cue_names}
        });
    } else {
        emit_error("unknown audio format (expected ACB or AWB/AFS2)");
    }
}

// ── List : liste des entrees ──────────────────────────────────────

static void cmd_audio_list(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    const auto type = detect_audio_type(data);

    if (type == AudioType::AWB) {
        auto parsed = criware::awb_parse(data);
        if (!parsed) { emit_error("AWB parse failed"); return; }

        auto entries_json = json::array();
        for (const auto& entry : parsed->entries) {
            entries_json.push_back(json{
                {"cue_id", entry.cue_id},
                {"offset", fmt::format("{:#x}", entry.offset)},
                {"size", entry.size}
            });
        }

        emit(json{
            {"ok", true},
            {"type", "AWB"},
            {"entry_count", parsed->entries.size()},
            {"entries", std::move(entries_json)}
        });
    } else if (type == AudioType::ACB) {
        auto parsed = criware::acb_parse(data);
        if (!parsed) { emit_error("ACB parse failed"); return; }

        auto cues_json = json::array();
        for (size_t i = 0; i < parsed->cue_names.size(); ++i) {
            cues_json.push_back(json{
                {"index", i},
                {"name", parsed->cue_names[i]}
            });
        }

        emit(json{
            {"ok", true},
            {"type", "ACB"},
            {"cue_count", parsed->cue_count},
            {"cues", std::move(cues_json)}
        });
    } else {
        emit_error("unknown audio format (expected ACB or AWB/AFS2)");
    }
}

// ── Extract : extraction des pistes audio ─────────────────────────

static void cmd_audio_extract(const std::string& input_path,
                              const std::string& output_dir,
                              bool verbose) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    const auto type = detect_audio_type(data);

    // Repertoire de sortie : option fournie ou a cote du fichier
    const fs::path out = output_dir.empty()
        ? fs::path(input_path).parent_path() / fs::path(input_path).stem()
        : fs::path(output_dir);

    if (type == AudioType::AWB) {
        auto parsed = criware::awb_parse(data);
        if (!parsed) { emit_error("AWB parse failed"); return; }

        const auto extracted = criware::awb_extract_all(data, *parsed, out, verbose);

        emit(json{
            {"ok", true},
            {"type", "AWB"},
            {"file", fs::path(input_path).filename().string()},
            {"entry_count", parsed->entries.size()},
            {"extracted", extracted},
            {"output_dir", out.string()}
        });
    } else if (type == AudioType::ACB) {
        // Extraire le AWB embarque, puis en extraire les pistes
        auto awb_data = criware::acb_extract_awb(data);
        if (awb_data.empty()) {
            // Pas de AWB embarque — verifier s'il y a un .awb externe
            const auto awb_path = fs::path(input_path).replace_extension(".awb");
            if (fs::exists(awb_path)) {
                spdlog::info("ACB sans AWB embarque, utilisation du fichier externe '{}'",
                             awb_path.string());
                awb_data = read_file(awb_path);
            }

            if (awb_data.empty()) {
                emit_error("ACB has no embedded AWB and no external .awb file found");
                return;
            }
        }

        auto parsed = criware::awb_parse(awb_data);
        if (!parsed) { emit_error("embedded/external AWB parse failed"); return; }

        const auto extracted = criware::awb_extract_all(awb_data, *parsed, out, verbose);

        // Essayer de renommer les fichiers avec les noms des cues
        auto acb_info = criware::acb_parse(data);
        if (acb_info && !acb_info->cue_names.empty()) {
            // Renommer cue_XXXX.hca -> nom_du_cue.hca si possible
            for (size_t i = 0; i < parsed->entries.size() && i < acb_info->cue_names.size(); ++i) {
                const auto& name = acb_info->cue_names[i];
                if (name.empty()) continue;

                const auto& entry = parsed->entries[i];
                // Trouver le fichier extrait
                for (const auto& ext : {".hca", ".adx", ".bin"}) {
                    const auto old_name = fmt::format("cue_{:04d}{}", entry.cue_id, ext);
                    const auto old_path = out / old_name;
                    if (fs::exists(old_path)) {
                        const auto new_path = out / (name + ext);
                        std::error_code ec;
                        fs::rename(old_path, new_path, ec);
                        if (!ec && verbose) {
                            spdlog::info("  {} -> {}{}", old_name, name, ext);
                        }
                        break;
                    }
                }
            }
        }

        emit(json{
            {"ok", true},
            {"type", "ACB"},
            {"file", fs::path(input_path).filename().string()},
            {"entry_count", parsed->entries.size()},
            {"extracted", extracted},
            {"output_dir", out.string()}
        });
    } else {
        emit_error("unknown audio format (expected ACB or AWB/AFS2)");
    }
}

// ── Registration ────────────────────────────────────────────────────

void register_audio_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("audio", "CRI ADX2 audio operations (ACB/AWB)");

    // ── audio info ──
    auto* info_cmd = cmd->add_subcommand("info", "Show audio file summary");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "ACB or AWB file path")->required();
    info_cmd->callback([]() { cmd_audio_info(info_input); });

    // ── audio list ──
    auto* list_cmd = cmd->add_subcommand("list", "List cue entries");
    static std::string list_input;
    list_cmd->add_option("input", list_input, "ACB or AWB file path")->required();
    list_cmd->callback([]() { cmd_audio_list(list_input); });

    // ── audio extract ──
    auto* extract_cmd = cmd->add_subcommand("extract", "Extract audio tracks (HCA/ADX)");
    static std::string extract_input;
    static std::string extract_output;
    static bool extract_verbose = false;
    extract_cmd->add_option("input", extract_input, "ACB or AWB file path")->required();
    extract_cmd->add_option("-o,--output", extract_output,
                            "Output directory (default: file stem next to input)");
    extract_cmd->add_flag("-v,--verbose", extract_verbose,
                          "Print each extracted file");
    extract_cmd->callback([]() {
        cmd_audio_extract(extract_input, extract_output, extract_verbose);
    });
}

} // namespace iecode::cli
