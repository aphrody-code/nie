#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/g4ra.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Info : resume du fichier G4RA (parser minimal) ─────────────────

static void cmd_g4ra_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4ra_parse(data);
    if (!parsed) { emit_error("G4RA parse failed"); return; }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"size", data.size()},
        {"version", parsed->version},
        {"entryCount", parsed->entry_count},
    });
}

// ── Registration ────────────────────────────────────────────────────

void register_g4ra_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("g4ra", "G4RA resource archive operations (JSON output)");

    // ── g4ra info ──
    auto* info_cmd = cmd->add_subcommand("info", "Parse and show G4RA header info");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "G4RA file path")->required();
    info_cmd->callback([]() { cmd_g4ra_info(info_input); });
}

} // namespace iecode::cli
