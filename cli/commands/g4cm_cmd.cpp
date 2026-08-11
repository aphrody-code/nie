#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/g4cm.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Info : resume du conteneur G4CM ───────────────────────────────

static void cmd_g4cm_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4cm_parse(data);
    if (!parsed) { emit_error("G4CM parse failed"); return; }

    // Compter les types
    int g4mg_count = 0, g4tx_count = 0, g4sk_count = 0, g4md_count = 0, other_count = 0;
    for (const auto& e : parsed->entries) {
        if (e.type == "g4mg") ++g4mg_count;
        else if (e.type == "g4tx") ++g4tx_count;
        else if (e.type == "g4sk") ++g4sk_count;
        else if (e.type == "g4md") ++g4md_count;
        else ++other_count;
    }

    auto entries_json = json::array();
    for (const auto& e : parsed->entries) {
        entries_json.push_back(json{
            {"type", e.type},
            {"name", e.name},
            {"offset", e.offset},
            {"size", e.size},
        });
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"size", data.size()},
        {"version", parsed->version},
        {"headerSize", parsed->header_size},
        {"entryCount", parsed->entries.size()},
        {"typeCounts", {
            {"g4mg", g4mg_count},
            {"g4tx", g4tx_count},
            {"g4sk", g4sk_count},
            {"g4md", g4md_count},
            {"other", other_count},
        }},
        {"entries", std::move(entries_json)},
    });
}

// ── List : liste JSON des fichiers embarques ──────────────────────

static void cmd_g4cm_list(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4cm_parse(data);
    if (!parsed) { emit_error("G4CM parse failed"); return; }

    auto entries_json = json::array();
    for (const auto& e : parsed->entries) {
        entries_json.push_back(json{
            {"type", e.type},
            {"name", e.name},
            {"offset", e.offset},
            {"size", e.size},
        });
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"entryCount", parsed->entries.size()},
        {"entries", std::move(entries_json)},
    });
}

// ── Extract : extraction de tous les sous-fichiers ────────────────

static void cmd_g4cm_extract(const std::string& input_path,
                             const std::string& output_dir,
                             bool verbose) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4cm_parse(data);
    if (!parsed) { emit_error("G4CM parse failed"); return; }

    // Repertoire de sortie : option fournie ou a cote du fichier
    const fs::path out = output_dir.empty()
        ? fs::path(input_path).parent_path() / fs::path(input_path).stem()
        : fs::path(output_dir);

    const auto extracted = level5::g4cm_extract_all(data, *parsed, out, verbose);

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"entryCount", parsed->entries.size()},
        {"extracted", extracted},
        {"outputDir", out.string()},
    });
}

// ── Registration ────────────────────────────────────────────────────

void register_g4cm_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("g4cm", "G4CM character model container operations");

    // ── g4cm info ──
    auto* info_cmd = cmd->add_subcommand("info", "Show container summary");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "G4CM file path")->required();
    info_cmd->callback([]() { cmd_g4cm_info(info_input); });

    // ── g4cm list ──
    auto* list_cmd = cmd->add_subcommand("list", "List embedded files");
    static std::string list_input;
    list_cmd->add_option("input", list_input, "G4CM file path")->required();
    list_cmd->callback([]() { cmd_g4cm_list(list_input); });

    // ── g4cm extract ──
    auto* extract_cmd = cmd->add_subcommand("extract", "Extract all sub-files from container");
    static std::string extract_input;
    static std::string extract_output;
    static bool extract_verbose = false;
    extract_cmd->add_option("input", extract_input, "G4CM file path")->required();
    extract_cmd->add_option("-o,--output", extract_output,
                            "Output directory (default: file stem next to input)");
    extract_cmd->add_flag("-v,--verbose", extract_verbose,
                          "Print each extracted file");
    extract_cmd->callback([]() {
        cmd_g4cm_extract(extract_input, extract_output, extract_verbose);
    });
}

} // namespace iecode::cli
