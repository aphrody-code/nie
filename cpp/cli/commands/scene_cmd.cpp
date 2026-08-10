/// @file scene_cmd.cpp
/// Commande CLI 'scene' — operations sur les formats de scene (OBJBIN, COL, G4NV).

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/objbin_parser.h"
#include "iecode/formats/level5/col_parser.h"
#include "iecode/formats/level5/g4nv_parser.h"
#include "iecode/types.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Detection automatique du format ─────────────────────────────────

enum class SceneFormat { UNKNOWN, OBJBIN, COL, G4NV };

/// Detecte le format scene par extension ou par magic bytes.
static SceneFormat detect_scene_format(const fs::path& path,
                                       std::span<const uint8_t> data) {
    // Detection par extension (prioritaire)
    const auto ext = path.extension().string();
    if (ext == ".objbin") return SceneFormat::OBJBIN;
    if (ext == ".col")    return SceneFormat::COL;
    if (ext == ".g4nv")   return SceneFormat::G4NV;

    // Fallback : detection par magic bytes
    if (data.size() >= 4) {
        const uint32_t magic = iecode::read_u32_le(data, 0);
        if (magic == MAGIC_G4NV) return SceneFormat::G4NV;
        if (magic == MAGIC_COL0 || magic == MAGIC_COLS) return SceneFormat::COL;
    }

    // Si aucun magic reconnu, tenter OBJBIN (format sans magic fiable)
    return SceneFormat::OBJBIN;
}

// ── Info : resume des metadonnees ───────────────────────────────────

static void cmd_scene_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    const fs::path path(input_path);
    const auto format = detect_scene_format(path, data);

    switch (format) {
        case SceneFormat::OBJBIN: {
            auto parsed = level5::objbin_parse(data);
            if (!parsed) { emit_error("OBJBIN parse failed"); return; }
            emit(json{
                {"ok", true},
                {"format", "OBJBIN"},
                {"file", path.filename().string()},
                {"size", data.size()},
                {"version", parsed->version},
                {"object_count", parsed->objects.size()}
            });
            break;
        }
        case SceneFormat::COL: {
            auto parsed = level5::col_parse(data);
            if (!parsed) { emit_error("COL parse failed"); return; }
            emit(json{
                {"ok", true},
                {"format", "COL"},
                {"file", path.filename().string()},
                {"size", data.size()},
                {"version", parsed->version},
                {"vertex_count", parsed->vertices.size()},
                {"triangle_count", parsed->triangles.size()},
                {"bbox_min", {parsed->bbox_min[0], parsed->bbox_min[1], parsed->bbox_min[2]}},
                {"bbox_max", {parsed->bbox_max[0], parsed->bbox_max[1], parsed->bbox_max[2]}}
            });
            break;
        }
        case SceneFormat::G4NV: {
            auto parsed = level5::g4nv_parse(data);
            if (!parsed) { emit_error("G4NV parse failed"); return; }
            size_t total_edges = 0;
            for (const auto& node : parsed->nodes) {
                total_edges += node.connections.size();
            }
            emit(json{
                {"ok", true},
                {"format", "G4NV"},
                {"file", path.filename().string()},
                {"size", data.size()},
                {"version", parsed->version},
                {"node_count", parsed->nodes.size()},
                {"edge_count", total_edges}
            });
            break;
        }
        default:
            emit_error("unknown scene format");
            break;
    }
}

// ── Export : representation JSON complete ────────────────────────────

static void cmd_scene_export(const std::string& input_path,
                             const std::string& output_dir) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    const fs::path path(input_path);
    const auto format = detect_scene_format(path, data);

    std::string json_content;
    std::string format_name;

    switch (format) {
        case SceneFormat::OBJBIN: {
            auto parsed = level5::objbin_parse(data);
            if (!parsed) { emit_error("OBJBIN parse failed"); return; }
            json_content = level5::objbin_to_json(*parsed);
            format_name = "OBJBIN";
            break;
        }
        case SceneFormat::COL: {
            auto parsed = level5::col_parse(data);
            if (!parsed) { emit_error("COL parse failed"); return; }
            json_content = level5::col_to_json(*parsed);
            format_name = "COL";
            break;
        }
        case SceneFormat::G4NV: {
            auto parsed = level5::g4nv_parse(data);
            if (!parsed) { emit_error("G4NV parse failed"); return; }
            json_content = level5::g4nv_to_json(*parsed);
            format_name = "G4NV";
            break;
        }
        default:
            emit_error("unknown scene format");
            return;
    }

    // Determiner le chemin de sortie
    const fs::path out_dir = output_dir.empty()
        ? path.parent_path()
        : fs::path(output_dir);

    const fs::path out_file = out_dir / (path.stem().string() + ".json");
    fs::create_directories(out_dir);

    // Ecrire le JSON
    const auto json_bytes = std::vector<uint8_t>(
        json_content.begin(), json_content.end());
    if (!write_file(out_file, json_bytes)) {
        emit_error(fmt::format("failed to write {}", out_file.string()));
        return;
    }

    emit(json{
        {"ok", true},
        {"format", format_name},
        {"file", path.filename().string()},
        {"output", out_file.string()}
    });
}

// ── Registration ────────────────────────────────────────────────────

void register_scene_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("scene",
        "Scene format operations (OBJBIN, COL, G4NV)");

    // ── scene info ──
    auto* info_cmd = cmd->add_subcommand("info",
        "Show scene file metadata (auto-detect format)");
    static std::string info_input;
    info_cmd->add_option("input", info_input,
        "Scene file path (.objbin, .col, .g4nv)")->required();
    info_cmd->callback([]() { cmd_scene_info(info_input); });

    // ── scene export ──
    auto* export_cmd = cmd->add_subcommand("export",
        "Export scene file as JSON");
    static std::string export_input;
    static std::string export_output;
    export_cmd->add_option("input", export_input,
        "Scene file path (.objbin, .col, .g4nv)")->required();
    export_cmd->add_option("-o,--output", export_output,
        "Output directory (default: same as input)");
    export_cmd->callback([]() {
        cmd_scene_export(export_input, export_output);
    });
}

} // namespace iecode::cli
