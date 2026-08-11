/// @file bin_cmd.cpp
/// Commande CLI 'bin' — inspection et dispatch intelligent de fichiers .bin.
///
/// Usage :
///   iecode bin inspect <file>      -> JSON {format, was_encrypted, was_compressed, ...}
///   iecode bin dispatch <file> [-o dir]  -> parse complet + resume JSON

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/bin_dispatcher.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;

namespace iecode::cli {

// ── Sous-commande inspect ──────────────────────────────────────────

static void cmd_bin_inspect(const std::string& input_path) {
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

    const auto filename = path.filename().string();
    auto result = iecode::bin_inspect(data, filename);

    nlohmann::json j;
    j["ok"] = true;
    j["name"] = filename;
    j["size"] = data.size();
    j["format"] = result.format_name;
    j["formatId"] = static_cast<int>(result.format);
    j["wasEncrypted"] = result.was_encrypted;
    j["wasCompressed"] = result.was_compressed;

    if (!result.compression_type.empty()) {
        j["compressionType"] = result.compression_type;
    }

    if (!result.error.empty()) {
        j["error"] = result.error;
    }

    if (result.format == BinFormat::Unknown) {
        // Hex dump des premiers 32 octets pour diagnostic
        std::string hex;
        const size_t n = std::min(data.size(), size_t{32});
        for (size_t i = 0; i < n; ++i) {
            if (i > 0) hex += ' ';
            hex += fmt::format("{:02X}", data[i]);
        }
        j["hexDump"] = hex;
    }

    if (result.was_compressed || result.was_encrypted) {
        j["payloadSize"] = result.payload.size();
    }

    emit(j);
}

// ── Sous-commande dispatch ─────────────────────────────────────────

static void cmd_bin_dispatch(const std::string& input_path,
                              const std::string& output_dir) {
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

    const auto filename = path.filename().string();
    auto json_str = iecode::bin_dispatch_json(data, filename);

    // Si un repertoire de sortie est specifie, ecrire le JSON dedans
    if (!output_dir.empty()) {
        const fs::path out_path = fs::path(output_dir) /
                                  (path.stem().string() + ".inspect.json");
        if (write_file(out_path, std::span<const uint8_t>(
                reinterpret_cast<const uint8_t*>(json_str.data()),
                json_str.size()))) {
            spdlog::info("resultat ecrit dans '{}'", out_path.string());
        } else {
            spdlog::error("impossible d'ecrire '{}'", out_path.string());
        }
    }

    // Toujours emettre sur stdout
    fmt::print("{}\n", json_str);
}

// ── Registration ───────────────────────────────────────────────────

void register_bin_command(CLI::App& app) {
    auto* bin = app.add_subcommand("bin",
        "Dispatcher intelligent de fichiers .bin (detection, dechiffrement, decompression)");
    bin->require_subcommand(1);

    // bin inspect
    {
        auto* cmd = bin->add_subcommand("inspect",
            "Inspecter un fichier .bin (detection format, crypto, compression)");

        static std::string input_path;
        cmd->add_option("input", input_path, "Fichier .bin a inspecter")->required();
        cmd->callback([]() { cmd_bin_inspect(input_path); });
    }

    // bin dispatch
    {
        auto* cmd = bin->add_subcommand("dispatch",
            "Parse complet d'un fichier .bin avec dispatch vers le parser adapte");

        static std::string input_path;
        static std::string output_dir;

        cmd->add_option("input", input_path, "Fichier .bin a analyser")->required();
        cmd->add_option("-o,--output", output_dir,
            "Repertoire de sortie pour le resultat JSON");

        cmd->callback([]() { cmd_bin_dispatch(input_path, output_dir); });
    }
}

} // namespace iecode::cli
