#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/g4pk.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Info : resume du fichier G4PK ──────────────────────────────────

static void cmd_g4pk_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4pk_parse(data);
    if (!parsed) { emit_error("G4PK parse failed"); return; }

    auto entries_json = json::array();
    for (const auto& entry : parsed->entries) {
        entries_json.push_back(json{
            {"name", entry.name},
            {"offset", entry.offset},
            {"size", entry.size}
        });
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"size", data.size()},
        {"version", parsed->version},
        {"entry_count", parsed->entries.size()},
        {"entries", std::move(entries_json)}
    });
}

// ── List : liste tabulaire des fichiers ────────────────────────────

static void cmd_g4pk_list(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4pk_parse(data);
    if (!parsed) { emit_error("G4PK parse failed"); return; }

    auto entries_json = json::array();
    for (const auto& entry : parsed->entries) {
        entries_json.push_back(json{
            {"name", entry.name},
            {"offset", entry.offset},
            {"size", entry.size},
            {"hash", fmt::format("{:#010x}", entry.hash)}
        });
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"entry_count", parsed->entries.size()},
        {"entries", std::move(entries_json)}
    });
}

// ── Extract : extraction de tous les fichiers ──────────────────────

static void cmd_g4pk_extract(const std::string& input_path,
                             const std::string& output_dir,
                             bool verbose) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4pk_parse(data);
    if (!parsed) { emit_error("G4PK parse failed"); return; }

    // Repertoire de sortie : option fournie ou a cote de l'archive
    const fs::path out = output_dir.empty()
        ? fs::path(input_path).parent_path() / fs::path(input_path).stem()
        : fs::path(output_dir);

    const auto extracted = level5::g4pk_extract_all(data, *parsed, out, verbose);

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"entry_count", parsed->entries.size()},
        {"extracted", extracted},
        {"output_dir", out.string()}
    });
}

// ── Registration ────────────────────────────────────────────────────

void register_g4pk_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("g4pk", "G4PK archive operations");

    // ── g4pk info ──
    auto* info_cmd = cmd->add_subcommand("info", "Show archive summary");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "G4PK file path")->required();
    info_cmd->callback([]() { cmd_g4pk_info(info_input); });

    // ── g4pk list ──
    auto* list_cmd = cmd->add_subcommand("list", "List files in the archive");
    static std::string list_input;
    list_cmd->add_option("input", list_input, "G4PK file path")->required();
    list_cmd->callback([]() { cmd_g4pk_list(list_input); });

    // ── g4pk extract ──
    auto* extract_cmd = cmd->add_subcommand("extract", "Extract all files from the archive");
    static std::string extract_input;
    static std::string extract_output;
    static bool extract_verbose = false;
    extract_cmd->add_option("input", extract_input, "G4PK file path")->required();
    extract_cmd->add_option("-o,--output", extract_output,
                            "Output directory (default: archive name next to file)");
    extract_cmd->add_flag("-v,--verbose", extract_verbose,
                          "Print each extracted file");
    extract_cmd->callback([]() {
        cmd_g4pk_extract(extract_input, extract_output, extract_verbose);
    });
}

} // namespace iecode::cli
