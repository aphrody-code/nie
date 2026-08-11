/// @file p3lip_cmd.cpp
/// Commande CLI 'p3lip' — lip-sync P3LIP.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/p3lip_parser.h"

#include <CLI/CLI.hpp>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

static void cmd_p3lip_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::p3lip_parse(data);
    if (!parsed) { emit_error("P3LIP parse failed"); return; }

    auto j = json::parse(level5::p3lip_to_json(*parsed));
    j["ok"]   = true;
    j["file"] = fs::path(input_path).filename().string();
    emit(j);
}

static void cmd_p3lip_export(const std::string& input_path, const std::string& output_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::p3lip_parse(data);
    if (!parsed) { emit_error("P3LIP parse failed"); return; }

    const fs::path out = output_path.empty()
        ? fs::path(input_path).replace_extension(".json")
        : fs::path(output_path);

    fs::create_directories(out.parent_path());
    std::ofstream f(out);
    if (!f) { emit_error("cannot write output file"); return; }
    f << level5::p3lip_to_json(*parsed);

    emit(json{{"ok", true}, {"output", out.string()},
              {"phoneme_count", parsed->phonemes.size()}});
}

void register_p3lip_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("p3lip", "P3LIP lip-sync operations");

    // ── p3lip info ──
    auto* info_cmd = cmd->add_subcommand("info", "Show P3LIP phoneme timeline");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "P3LIP file path")->required();
    info_cmd->callback([]() { cmd_p3lip_info(info_input); });

    // ── p3lip export ──
    auto* exp_cmd = cmd->add_subcommand("export", "Export P3LIP to JSON");
    static std::string exp_input, exp_output;
    exp_cmd->add_option("input", exp_input, "P3LIP file path")->required();
    exp_cmd->add_option("-o,--output", exp_output, "Output JSON path");
    exp_cmd->callback([]() { cmd_p3lip_export(exp_input, exp_output); });
}

} // namespace iecode::cli
