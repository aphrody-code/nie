#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/criware/utf_parser.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Nom de type lisible pour une colonne UTF ───────────────────────

static const char* utf_type_name(criware::UtfColumnType type) {
    switch (type) {
        case criware::UtfColumnType::Byte:   return "byte";
        case criware::UtfColumnType::SByte:  return "sbyte";
        case criware::UtfColumnType::UInt16: return "u16";
        case criware::UtfColumnType::Int16:  return "s16";
        case criware::UtfColumnType::UInt32: return "u32";
        case criware::UtfColumnType::Int32:  return "s32";
        case criware::UtfColumnType::UInt64: return "u64";
        case criware::UtfColumnType::Int64:  return "s64";
        case criware::UtfColumnType::Single: return "float";
        case criware::UtfColumnType::Double: return "double";
        case criware::UtfColumnType::String: return "string";
        case criware::UtfColumnType::Data:   return "data";
        case criware::UtfColumnType::Guid:   return "guid";
    }
    return "unknown";
}

// ── Info : resume de la table @UTF ─────────────────────────────────

static void cmd_utf_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = criware::utf_parse(data);
    if (!parsed) { emit_error("@UTF parse failed"); return; }

    auto columns_json = json::array();
    for (const auto& col : parsed->columns) {
        columns_json.push_back({
            {"name", col.name},
            {"type", utf_type_name(col.type)},
            {"flags", col.flags},
        });
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"size", data.size()},
        {"tableName", parsed->name},
        {"columnCount", parsed->columns.size()},
        {"rowCount", parsed->rows.size()},
        {"columns", std::move(columns_json)},
    });
}

// ── Check : validation rapide ──────────────────────────────────────

static void cmd_utf_check(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) {
        emit(json{{"ok", true}, {"valid", false}, {"reason", "file not found or empty"}});
        return;
    }

    auto parsed = criware::utf_parse(data);
    emit(json{{"ok", true}, {"valid", parsed.has_value()}});
}

// ── Batch : scanner un repertoire et verifier chaque fichier UTF ───

static void cmd_utf_batch(const std::string& directory,
                           bool recursive,
                           const std::string& extension) {
    if (!fs::is_directory(directory)) {
        emit_error("directory not found: " + directory);
        return;
    }

    int total = 0;
    int valid = 0;
    int invalid = 0;
    int read_errors = 0;
    auto results_json = json::array();

    auto scan = [&](const fs::path& path) {
        ++total;
        auto data = read_file(path.string());
        if (data.empty()) {
            ++read_errors;
            results_json.push_back({
                {"file", path.filename().string()},
                {"valid", false},
                {"reason", "read error"},
            });
            return;
        }

        auto parsed = criware::utf_parse(data);
        if (parsed) {
            ++valid;
            results_json.push_back({
                {"file", path.filename().string()},
                {"valid", true},
                {"tableName", parsed->name},
                {"rows", parsed->rows.size()},
                {"columns", parsed->columns.size()},
            });
        } else {
            ++invalid;
            results_json.push_back({
                {"file", path.filename().string()},
                {"valid", false},
                {"reason", "parse failed"},
            });
        }
    };

    std::error_code ec;
    if (recursive) {
        for (const auto& entry : fs::recursive_directory_iterator(directory, ec)) {
            if (!entry.is_regular_file()) continue;
            const auto ext = entry.path().extension().string();
            if (ext == extension) scan(entry.path());
        }
    } else {
        for (const auto& entry : fs::directory_iterator(directory, ec)) {
            if (!entry.is_regular_file()) continue;
            const auto ext = entry.path().extension().string();
            if (ext == extension) scan(entry.path());
        }
    }

    emit(json{
        {"ok", true},
        {"total", total},
        {"valid", valid},
        {"invalid", invalid},
        {"readErrors", read_errors},
        {"extension", extension},
        {"recursive", recursive},
        {"files", std::move(results_json)},
    });
}

// ── Registration ────────────────────────────────────────────────────

void register_utf_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("utf", "@UTF table operations (JSON output)");

    // ── utf info ──
    auto* info_cmd = cmd->add_subcommand("info", "Parse and show @UTF table summary");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "UTF/CPK/ACB file path")->required();
    info_cmd->callback([]() { cmd_utf_info(info_input); });

    // ── utf check ──
    auto* check_cmd = cmd->add_subcommand("check", "Validate a @UTF file");
    static std::string check_input;
    check_cmd->add_option("input", check_input, "UTF/CPK/ACB file path")->required();
    check_cmd->callback([]() { cmd_utf_check(check_input); });

    // ── utf batch ──
    auto* batch_cmd = cmd->add_subcommand("batch", "Scan directory and validate @UTF files");
    static std::string batch_dir;
    static bool batch_recursive = false;
    static std::string batch_extension = ".cpk";
    batch_cmd->add_option("directory", batch_dir, "Directory to scan")->required();
    batch_cmd->add_flag("-r,--recursive", batch_recursive, "Recursive scan");
    batch_cmd->add_option("-e,--extension", batch_extension, "File extension filter")->default_val(".cpk");
    batch_cmd->callback([]() { cmd_utf_batch(batch_dir, batch_recursive, batch_extension); });
}

} // namespace iecode::cli
