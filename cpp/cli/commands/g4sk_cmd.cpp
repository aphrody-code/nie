#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/g4sk.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Info : resume du squelette ─────────────────────────────────────

static void cmd_g4sk_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4sk_parse(data);
    if (!parsed) { emit_error("G4SK parse failed"); return; }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"size", data.size()},
        {"version", parsed->version},
        {"boneCount", parsed->bones.size()},
    });
}

// ── Dump : squelette complet avec tous les os ──────────────────────

static void cmd_g4sk_dump(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4sk_parse(data);
    if (!parsed) { emit_error("G4SK parse failed"); return; }

    auto bones_json = json::array();
    for (size_t i = 0; i < parsed->bones.size(); ++i) {
        const auto& bone = parsed->bones[i];
        json bone_j;
        bone_j["index"] = i;
        bone_j["name"] = bone.name;
        bone_j["parentIndex"] = bone.parent_index;
        bone_j["position"] = {bone.position[0], bone.position[1], bone.position[2]};
        bone_j["rotation"] = {bone.rotation[0], bone.rotation[1], bone.rotation[2], bone.rotation[3]};
        bone_j["scale"] = {bone.scale[0], bone.scale[1], bone.scale[2]};
        bones_json.push_back(std::move(bone_j));
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"version", parsed->version},
        {"boneCount", parsed->bones.size()},
        {"bones", std::move(bones_json)},
    });
}

// ── Registration ────────────────────────────────────────────────────

void register_g4sk_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("g4sk", "G4SK skeleton operations (JSON output)");

    // ── g4sk info ──
    auto* info_cmd = cmd->add_subcommand("info", "Parse and show skeleton summary");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "G4SK file path")->required();
    info_cmd->callback([]() { cmd_g4sk_info(info_input); });

    // ── g4sk dump ──
    auto* dump_cmd = cmd->add_subcommand("dump", "Dump full skeleton with all bones");
    static std::string dump_input;
    dump_cmd->add_option("input", dump_input, "G4SK file path")->required();
    dump_cmd->callback([]() { cmd_g4sk_dump(dump_input); });
}

} // namespace iecode::cli
