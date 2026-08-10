/// @file vfx_cmd.cpp
/// Commande CLI 'vfx' — inspection des formats VFX Level-5.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/vfx_inspector.h"

#include <CLI/CLI.hpp>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

static void cmd_vfx_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    const auto result = level5::vfx_inspect(data, fs::path(input_path).filename().string());
    emit(json::parse(level5::vfx_inspect_json(result)));
}

static void cmd_vfx_batch(const std::string& dir_path) {
    namespace fs = std::filesystem;
    const fs::path dir(dir_path);
    if (!fs::is_directory(dir)) { emit_error("not a directory"); return; }

    json summary;
    summary["ok"] = true;
    summary["directory"] = dir_path;

    auto files = json::array();
    size_t total = 0;
    std::map<std::string, size_t> by_format;

    for (const auto& entry : fs::recursive_directory_iterator(dir)) {
        if (!entry.is_regular_file()) continue;
        const auto ext = entry.path().extension().string();
        if (ext != ".vfxo" && ext != ".pfxo" && ext != ".fxbin" && ext != ".ptlb") continue;

        auto data = read_file(entry.path().string());
        if (data.empty()) continue;

        const auto r = level5::vfx_inspect(data, entry.path().filename().string());
        by_format[r.format_name]++;
        ++total;
    }

    summary["total_files"] = total;
    summary["by_format"] = by_format;
    emit(summary);
}

void register_vfx_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("vfx", "Inspect VFX format files (VFXO/PFXO/FXBIN/PTLB)");

    // ── vfx info ──
    auto* info_cmd = cmd->add_subcommand("info", "Inspect a VFX file");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "VFX file path")->required();
    info_cmd->callback([]() { cmd_vfx_info(info_input); });

    // ── vfx batch ──
    auto* batch_cmd = cmd->add_subcommand("batch", "Inspect all VFX files in a directory");
    static std::string batch_dir;
    batch_cmd->add_option("dir", batch_dir, "Directory to scan")->required();
    batch_cmd->callback([]() { cmd_vfx_batch(batch_dir); });
}

} // namespace iecode::cli
