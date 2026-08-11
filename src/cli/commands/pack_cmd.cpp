/// @file pack_cmd.cpp
/// Packaging de mods pour CPK — met a jour cpk_list.cfg.bin, copie les fichiers.
///
/// Usage :
///   iecode pack --input mod_dir --cpklist cpk_list.cfg.bin --output out_dir
///   iecode pack --input mod_dir --cpklist cpk_list.cfg.bin --output out_dir --platform switch

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/viola/pack.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

static void cmd_pack(const std::string& input_dir,
                      const std::string& cpklist_path,
                      const std::string& output_dir,
                      const std::string& platform) {
    if (!fs::is_directory(input_dir)) {
        emit_error("input directory not found: " + input_dir);
        return;
    }
    if (!fs::exists(cpklist_path)) {
        emit_error("cpk_list not found: " + cpklist_path);
        return;
    }

    auto t0 = std::chrono::steady_clock::now();

    // Determiner la plateforme cible
    const bool is_switch = (platform == "switch" || platform == "SWITCH");
    const auto target_platform = is_switch
        ? viola::Platform::Switch
        : viola::Platform::PC;

    // Appeler le pack Viola complet
    auto result = viola::cpk_update_file_list(
        fs::path(cpklist_path),
        fs::path(input_dir),
        fs::path(output_dir),
        target_platform);

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    if (!result.success) {
        emit(json{
            {"ok", false},
            {"error", result.error},
            {"elapsed_ms", elapsed_ms}
        });
        return;
    }

    emit(json{
        {"ok", true},
        {"platform", is_switch ? "switch" : "pc"},
        {"files_updated", result.files_updated},
        {"files_added", result.files_added},
        {"total_entries", result.total_entries},
        {"output", output_dir},
        {"elapsed_ms", elapsed_ms}
    });
}

void register_pack_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("pack", "Package mod files for CPK injection");

    static std::string input_dir;
    static std::string cpklist_path;
    static std::string output_dir = "mod_output";
    static std::string platform = "pc";

    cmd->add_option("--input,-i", input_dir, "Mod directory with game files")->required();
    cmd->add_option("--cpklist", cpklist_path, "Path to cpk_list.cfg.bin")->required();
    cmd->add_option("-o,--output", output_dir, "Output directory")->default_val("mod_output");
    cmd->add_option("--platform", platform, "Target platform (pc or switch)")
        ->default_val("pc");

    cmd->callback([]() {
        cmd_pack(input_dir, cpklist_path, output_dir, platform);
    });
}

} // namespace iecode::cli
