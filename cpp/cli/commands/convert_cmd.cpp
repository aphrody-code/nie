/// @file convert_cmd.cpp
/// Conversion unifiee multi-format avec auto-detection.
///
/// Usage :
///   iecode convert <input> -o <output> -f png
///   iecode convert <input_dir> -o <output_dir> -r -f webp --lang fr -q 85

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/converters/asset_converter.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

static void cmd_convert(const std::string& input_path,
                         const std::string& output_path,
                         const std::string& format,
                         const std::string& lang,
                         bool recursive,
                         bool no_dup,
                         int quality) {
    if (!fs::exists(input_path)) {
        emit_error("input not found: " + input_path);
        return;
    }

    converters::ConvertOptions opts;
    opts.format = format;
    opts.webp_quality = quality;
    opts.skip_duplicates = !no_dup;
    if (!lang.empty()) {
        opts.languages.insert(lang);
    }

    if (fs::is_directory(input_path)) {
        // Batch directory conversion
        const std::string out = output_path.empty() ? "converted" : output_path;
        spdlog::info("convert: repertoire '{}' -> '{}'", input_path, out);

        auto result = converters::convert_directory(input_path, out, recursive, opts);

        emit(json{
            {"ok", true},
            {"mode", "directory"},
            {"files_processed", result.files_processed},
            {"files_converted", result.files_converted},
            {"files_skipped", result.files_skipped},
            {"errors", result.errors},
            {"elapsed_ms", result.elapsed_ms}
        });
    } else {
        // Single file conversion
        std::string out = output_path;
        if (out.empty()) {
            // Auto-generate output name
            auto p = fs::path(input_path);
            if (format == "webp") out = (p.parent_path() / p.stem()).string() + ".webp";
            else if (format == "json") out = (p.parent_path() / p.stem()).string() + ".json";
            else out = (p.parent_path() / p.stem()).string() + ".png";
        }

        spdlog::info("convert: '{}' -> '{}'", input_path, out);
        bool ok = converters::convert_file(input_path, out, opts);

        emit(json{
            {"ok", ok},
            {"input", input_path},
            {"output", out},
            {"format", format.empty() ? "auto" : format}
        });
    }
}

void register_convert_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("convert", "Convert game files (auto-detect format)");

    static std::string input_path;
    static std::string output_path;
    static std::string format;
    static std::string lang;
    static bool recursive = false;
    static bool no_dup = false;
    static int quality = 90;

    cmd->add_option("input", input_path, "Input file or directory")->required();
    cmd->add_option("-o,--output", output_path, "Output file or directory");
    cmd->add_option("-f,--format", format, "Output format (png, webp, json, auto)")
        ->default_val("");
    cmd->add_option("--lang", lang, "Language filter (fr, en, ja...)")
        ->default_val("");
    cmd->add_flag("-r,--recursive", recursive, "Recurse into subdirectories");
    cmd->add_flag("--no-dup", no_dup, "Disable duplicate skipping");
    cmd->add_option("-q,--quality", quality, "WebP quality (1-100)")
        ->default_val(90);

    cmd->callback([]() {
        cmd_convert(input_path, output_path, format, lang, recursive, no_dup, quality);
    });
}

} // namespace iecode::cli
