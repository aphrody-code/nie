#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/format_detector.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Detection d'un fichier unique ──────────────────────────────────

static json detect_file(const fs::path& path) {
    auto data = read_file(path);
    if (data.empty()) {
        return {
            {"name", path.filename().string()},
            {"format", "Error"},
            {"error", "cannot read file"},
        };
    }

    const auto format = formats::detect(data);
    json j;
    j["name"] = path.filename().string();
    j["format"] = std::string(formats::format_name(format));
    j["size"] = data.size();

    // Si inconnu, essayer de detecter cfg.bin (pas de magic, footer T2B ou chiffre)
    if (format == formats::FileFormat::Unknown) {
        // Verifier si c'est un cfg.bin par l'extension
        const auto ext = path.extension().string();
        const auto stem = path.stem().string();
        if (ext == ".bin" && stem.find(".cfg") != std::string::npos) {
            j["format"] = "CfgBin";
            j["hint"] = "detected by extension";
        }
    }

    return j;
}

// ── Commande format (fichier unique) ───────────────────────────────

static void cmd_format_file(const std::string& input_path) {
    const fs::path path(input_path);

    if (!fs::exists(path)) {
        emit_error("file not found: " + input_path);
        return;
    }

    if (fs::is_regular_file(path)) {
        auto result = detect_file(path);
        result["ok"] = true;
        emit(result);
        return;
    }

    emit_error("not a regular file: " + input_path);
}

// ── Commande format (dossier) ──────────────────────────────────────

static void cmd_format_dir(const std::string& input_path, bool recursive) {
    const fs::path dir(input_path);

    if (!fs::is_directory(dir)) {
        emit_error("not a directory: " + input_path);
        return;
    }

    auto files_arr = json::array();
    std::error_code ec;

    // Compteurs par format
    std::unordered_map<std::string, int> format_counts;

    auto process_entry = [&](const fs::directory_entry& entry) {
        if (!entry.is_regular_file()) return;
        auto result = detect_file(entry.path());
        const auto fmt_str = result["format"].get<std::string>();
        ++format_counts[fmt_str];
        files_arr.push_back(std::move(result));
    };

    if (recursive) {
        for (const auto& entry : fs::recursive_directory_iterator(dir, ec)) {
            process_entry(entry);
        }
    } else {
        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            process_entry(entry);
        }
    }

    // Construire le resume
    json summary = json::object();
    for (const auto& [fmt, count] : format_counts) {
        summary[fmt] = count;
    }

    emit(json{
        {"ok", true},
        {"totalFiles", files_arr.size()},
        {"summary", std::move(summary)},
        {"files", std::move(files_arr)},
    });
}

// ── Dispatch ───────────────────────────────────────────────────────

static void cmd_format(const std::string& input_path, bool recursive) {
    const fs::path path(input_path);

    if (!fs::exists(path)) {
        emit_error("path not found: " + input_path);
        return;
    }

    if (fs::is_directory(path)) {
        cmd_format_dir(input_path, recursive);
    } else {
        cmd_format_file(input_path);
    }
}

// ── Registration ───────────────────────────────────────────────────

void register_format_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("format", "Detecter le format d'un fichier ou dossier");

    static std::string input_path;
    static bool recursive = false;

    cmd->add_option("input", input_path, "Fichier ou dossier a identifier")->required();
    cmd->add_flag("-r,--recursive", recursive, "Scanner recursivement (dossier)");

    cmd->callback([]() { cmd_format(input_path, recursive); });
}

} // namespace iecode::cli
