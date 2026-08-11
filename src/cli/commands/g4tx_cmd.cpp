/// @file g4tx_cmd.cpp
/// Commande CLI 'g4tx' — operations sur les textures G4TX.
///
/// Sous-commandes :
///   iecode g4tx info <file>                    lister les textures
///   iecode g4tx export <file> -o <dir> [-f fmt] exporter en PNG/WebP/DDS
///
/// Le parsing utilise g4tx_parse() pour lire les donnees BCn/RGBA8,
/// puis texture_export pour decoder et ecrire les fichiers de sortie.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/g4tx.h"
#include "iecode/converters/texture_export.h"
#include "iecode/converters/texture_import.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Nom lisible du format de pixels ───────────────────────────────

static const char* g4tx_format_str(level5::G4txFormat fmt) {
    switch (fmt) {
        case level5::G4txFormat::BC1:     return "BC1";
        case level5::G4txFormat::BC2:     return "BC2";
        case level5::G4txFormat::BC3:     return "BC3";
        case level5::G4txFormat::BC4:     return "BC4";
        case level5::G4txFormat::BC5:     return "BC5";
        case level5::G4txFormat::BC6H:    return "BC6H";
        case level5::G4txFormat::BC7:     return "BC7";
        case level5::G4txFormat::RGBA8:   return "RGBA8";
        case level5::G4txFormat::Unknown: return "Unknown";
    }
    return "Unknown";
}

// ── g4tx info — lister les textures ───────────────────────────────

static void cmd_g4tx_info(const std::string& input_path) {
    const fs::path path(input_path);
    if (!fs::exists(path) || !fs::is_regular_file(path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", input_path));
        return;
    }

    auto data = read_file(path);
    if (data.empty()) {
        emit_error(fmt::format("impossible de lire '{}'", input_path));
        return;
    }

    auto file = level5::g4tx_parse(data);
    if (!file) {
        emit_error(fmt::format("echec du parsing G4TX : '{}'", input_path));
        return;
    }

    auto textures = json::array();
    for (const auto& tex : file->textures) {
        json t{
            {"id", tex.id},
            {"name", tex.name},
            {"width", tex.width},
            {"height", tex.height},
            {"format", g4tx_format_str(tex.format)},
            {"mipCount", tex.mip_count},
            {"isDds", tex.is_dds},
            {"dataSize", tex.data.size()},
        };

        if (!tex.sub_textures.empty()) {
            auto subs = json::array();
            for (const auto& sub : tex.sub_textures) {
                subs.push_back(json{
                    {"entryId", sub.entry_id},
                    {"x", sub.x},
                    {"y", sub.y},
                    {"width", sub.width},
                    {"height", sub.height},
                });
            }
            t["subTextures"] = std::move(subs);
        }

        textures.push_back(std::move(t));
    }

    emit(json{
        {"ok", true},
        {"name", path.filename().string()},
        {"version", file->version},
        {"textureCount", file->textures.size()},
        {"textures", std::move(textures)},
    });
}

// ── g4tx export — decoder et exporter les textures ────────────────

static void cmd_g4tx_export(const std::string& input_path,
                            const std::string& output_dir,
                            const std::string& format_str,
                            int texture_index) {
    const fs::path path(input_path);
    if (!fs::exists(path) || !fs::is_regular_file(path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", input_path));
        return;
    }

    auto data = read_file(path);
    if (data.empty()) {
        emit_error(fmt::format("impossible de lire '{}'", input_path));
        return;
    }

    auto file = level5::g4tx_parse(data);
    if (!file) {
        emit_error(fmt::format("echec du parsing G4TX : '{}'", input_path));
        return;
    }

    if (file->textures.empty()) {
        emit(json{
            {"ok", true},
            {"name", path.filename().string()},
            {"exported", 0},
            {"message", "aucune texture dans le fichier"},
        });
        return;
    }

    // Determiner le format d'export
    converters::ExportFormat export_fmt = converters::ExportFormat::PNG;
    if (format_str == "dds") {
        export_fmt = converters::ExportFormat::DDS;
    } else if (format_str == "webp") {
        export_fmt = converters::ExportFormat::WebP;
    }

    const fs::path out_root(output_dir);
    fs::create_directories(out_root);

    auto t0 = std::chrono::steady_clock::now();

    int exported = 0;
    int errors = 0;
    auto results = json::array();

    // Determiner l'ensemble de textures a exporter
    size_t start = 0;
    size_t end = file->textures.size();
    if (texture_index >= 0) {
        if (static_cast<size_t>(texture_index) >= file->textures.size()) {
            emit_error(fmt::format("index {} hors limites (0-{})",
                                   texture_index, file->textures.size() - 1));
            return;
        }
        start = static_cast<size_t>(texture_index);
        end = start + 1;
    }

    for (size_t i = start; i < end; ++i) {
        const auto& tex = file->textures[i];

        // Construire le nom de sortie
        std::string base_name = tex.name.empty()
            ? fmt::format("{}_{}", path.stem().string(), i)
            : tex.name;
        const auto ext = converters::format_ext(export_fmt);
        const fs::path out_path = out_root / (base_name + ext);

        bool ok = false;
        switch (export_fmt) {
            case converters::ExportFormat::PNG:
                ok = converters::export_png(tex, out_path);
                break;
            case converters::ExportFormat::DDS:
                ok = converters::export_dds(tex, out_path);
                break;
            case converters::ExportFormat::WebP:
                ok = converters::export_webp(tex, out_path);
                break;
        }

        if (ok) {
            ++exported;
            spdlog::debug("g4tx export: {} -> {}", base_name, out_path.string());
        } else {
            ++errors;
            spdlog::warn("g4tx export: echec '{}' ({}x{}, {})",
                         base_name, tex.width, tex.height, g4tx_format_str(tex.format));
        }

        results.push_back(json{
            {"index", i},
            {"name", base_name},
            {"width", tex.width},
            {"height", tex.height},
            {"format", g4tx_format_str(tex.format)},
            {"output", out_path.string()},
            {"ok", ok},
        });
    }

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    emit(json{
        {"ok", errors == 0},
        {"name", path.filename().string()},
        {"exported", exported},
        {"errors", errors},
        {"outputFormat", format_str.empty() ? "png" : format_str},
        {"elapsed_ms", elapsed_ms},
        {"textures", std::move(results)},
    });
}

// ── Registration ───────────────────────────────────────────────────

void register_g4tx_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("g4tx", "Operations sur les textures G4TX");

    // Sous-commande : info
    auto* info_cmd = cmd->add_subcommand("info", "Lister les textures d'un G4TX");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "Fichier G4TX")->required();
    info_cmd->callback([]() {
        cmd_g4tx_info(info_input);
    });

    // Sous-commande : export
    auto* export_cmd = cmd->add_subcommand("export", "Exporter les textures en PNG/WebP/DDS");
    static std::string export_input;
    static std::string export_output;
    static std::string export_format;
    static int export_index = -1;
    export_cmd->add_option("input", export_input, "Fichier G4TX")->required();
    export_cmd->add_option("-o,--output", export_output, "Repertoire de sortie")->default_val(".");
    export_cmd->add_option("-f,--format", export_format, "Format de sortie : png|dds|webp")
        ->default_val("png");
    export_cmd->add_option("-i,--index", export_index, "Index de texture (defaut: toutes)")
        ->default_val(-1);
    export_cmd->callback([]() {
        cmd_g4tx_export(export_input, export_output, export_format, export_index);
    });

    // Sous-commande : from-png
    auto* from_png_cmd = cmd->add_subcommand("from-png", "Importer un PNG en fichier G4TX");
    static std::string from_png_input;
    static std::string from_png_output;
    static std::string from_png_format;
    static std::string from_png_name;
    from_png_cmd->add_option("input", from_png_input, "Fichier PNG d'entree")->required();
    from_png_cmd->add_option("-o,--output", from_png_output, "Fichier G4TX de sortie");
    from_png_cmd->add_option("-f,--format", from_png_format, "Format BCn : bc1|bc3|bc7|rgba8")
        ->default_val("bc7");
    from_png_cmd->add_option("-n,--name", from_png_name, "Nom de la texture dans le G4TX");
    from_png_cmd->callback([]() {
        const fs::path in_path(from_png_input);
        if (!fs::exists(in_path) || !fs::is_regular_file(in_path)) {
            emit_error(fmt::format("fichier introuvable : '{}'", from_png_input));
            return;
        }

        // Determiner le format cible
        converters::TextureImportOptions opts;
        if (from_png_format == "bc1") {
            opts.format = level5::G4txFormat::BC1;
        } else if (from_png_format == "bc3") {
            opts.format = level5::G4txFormat::BC3;
        } else if (from_png_format == "bc7") {
            opts.format = level5::G4txFormat::BC7;
        } else if (from_png_format == "rgba8") {
            opts.format = level5::G4txFormat::RGBA8;
        } else {
            emit_error(fmt::format("format invalide '{}' (attendu: bc1|bc3|bc7|rgba8)",
                                   from_png_format));
            return;
        }

        if (!from_png_name.empty()) {
            opts.name = from_png_name;
        }

        // Chemin de sortie par defaut : meme stem + .g4tx
        fs::path out_path;
        if (from_png_output.empty()) {
            out_path = in_path;
            out_path.replace_extension(".g4tx");
        } else {
            out_path = fs::path(from_png_output);
        }

        auto t0 = std::chrono::steady_clock::now();

        if (!converters::import_png_to_g4tx(in_path, out_path, opts)) {
            emit_error(fmt::format("echec de l'import PNG -> G4TX"));
            return;
        }

        auto t1 = std::chrono::steady_clock::now();
        const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

        std::error_code ec;
        const auto out_size = fs::file_size(out_path, ec);

        emit(json{
            {"ok", true},
            {"input", in_path.filename().string()},
            {"output", out_path.string()},
            {"format", from_png_format},
            {"outputSize", ec ? 0 : out_size},
            {"elapsed_ms", elapsed_ms},
        });
    });

    cmd->require_subcommand(1);
}

} // namespace iecode::cli
