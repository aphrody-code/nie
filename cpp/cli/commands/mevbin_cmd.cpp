/// @file mevbin_cmd.cpp
/// Commande CLI 'mevbin' — parseur Motion Event Binary.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/mevbin_parser.h"

#include <CLI/CLI.hpp>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

static void cmd_mevbin_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::mevbin_parse(data);
    if (!parsed) { emit_error("MEVBIN parse failed"); return; }

    auto j = json::parse(level5::mevbin_to_json(*parsed));
    j["ok"] = true;
    j["file"] = fs::path(input_path).filename().string();
    emit(j);
}

static void cmd_mevbin_export(const std::string& input_path, const std::string& output_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::mevbin_parse(data);
    if (!parsed) { emit_error("MEVBIN parse failed"); return; }

    const fs::path out = output_path.empty()
        ? fs::path(input_path).replace_extension(".json")
        : fs::path(output_path);

    fs::create_directories(out.parent_path());
    std::ofstream f(out);
    if (!f) { emit_error("cannot write output file"); return; }
    f << level5::mevbin_to_json(*parsed);

    emit(json{{"ok", true}, {"output", out.string()},
              {"event_count", parsed->events.size()}});
}

void register_mevbin_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("mevbin", "Motion Event Binary operations");

    // ── mevbin info ──
    auto* info_cmd = cmd->add_subcommand("info", "Show MEVBIN event timeline");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "MEVBIN file path")->required();
    info_cmd->callback([]() { cmd_mevbin_info(info_input); });

    // ── mevbin export ──
    auto* exp_cmd = cmd->add_subcommand("export", "Export MEVBIN to JSON file");
    static std::string exp_input, exp_output;
    exp_cmd->add_option("input", exp_input, "MEVBIN file path")->required();
    exp_cmd->add_option("-o,--output", exp_output, "Output JSON path");
    exp_cmd->callback([]() { cmd_mevbin_export(exp_input, exp_output); });
}

} // namespace iecode::cli
