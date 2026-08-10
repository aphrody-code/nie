/// @file extract_cmd.cpp
/// Commande CLI 'extract' — extraction d'une archive CPK unique.
///
/// Usage :
///   iecode extract <cpk_file> -o <output> [--filter pattern] [--decrypt]
///
/// Ouvre un CPK, liste les entries, extrait chacune dans le repertoire
/// de sortie en respectant l'arborescence interne. Le mode --decrypt
/// applique le dechiffrement CRI XOR sur les entries chiffrees.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/crypto/cri_crypto.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Extraction ─────────────────────────────────────────────────────

static void cmd_extract(const std::string& input_path,
                        const std::string& output_dir,
                        const std::string& filter,
                        bool decrypt) {
    const fs::path cpk_path(input_path);
    if (!fs::exists(cpk_path) || !fs::is_regular_file(cpk_path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", input_path));
        return;
    }

    auto t0 = std::chrono::steady_clock::now();

    criware::CpkReader reader;
    if (!reader.open(cpk_path)) {
        emit_error(fmt::format("impossible d'ouvrir le CPK : '{}'", input_path));
        return;
    }

    const auto& entries = reader.list();
    spdlog::info("extract: {} entries dans '{}'", entries.size(), cpk_path.filename().string());

    const fs::path out_root(output_dir);
    fs::create_directories(out_root);

    int extracted = 0;
    int skipped = 0;
    int errors = 0;
    uint64_t total_bytes = 0;

    for (const auto& entry : entries) {
        // Filtrage par pattern glob
        if (!filter.empty()) {
            if (!glob_match(filter, entry.filename)) {
                ++skipped;
                continue;
            }
        }

        // Construire le chemin de sortie
        fs::path out_path = out_root;
        if (!entry.directory.empty()) {
            out_path /= entry.directory;
        }
        out_path /= entry.filename;

        auto data = reader.extract(entry);
        if (data.empty() && entry.size > 0) {
            spdlog::warn("extract: echec extraction '{}'", entry.filename);
            ++errors;
            continue;
        }

        // Dechiffrement CRI si demande et si l'entry est chiffree
        if (decrypt && entry.is_encrypted && !data.empty()) {
            const uint32_t key = crypto::cri_derive_key(entry.filename);
            crypto::cri_decrypt(std::span<uint8_t>(data), key);
            spdlog::debug("extract: dechiffre '{}' (cle 0x{:08X})", entry.filename, key);
        }

        if (write_file(out_path, data)) {
            ++extracted;
            total_bytes += data.size();
        } else {
            spdlog::warn("extract: echec ecriture '{}'", out_path.string());
            ++errors;
        }
    }

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    emit(json{
        {"ok", true},
        {"entries", entries.size()},
        {"extracted", extracted},
        {"skipped", skipped},
        {"errors", errors},
        {"bytes", total_bytes},
        {"elapsed_ms", elapsed_ms},
    });
}

// ── Registration ───────────────────────────────────────────────────

void register_extract_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("extract", "Extraire les fichiers d'une archive CPK");

    static std::string input_path;
    static std::string output_dir;
    static std::string filter;
    static bool decrypt = false;

    cmd->add_option("input", input_path, "Chemin vers l'archive CPK")->required();
    cmd->add_option("-o,--output", output_dir, "Repertoire de sortie")->default_val(".");
    cmd->add_option("--filter", filter, "Pattern glob pour filtrer (ex: *.g4tx)");
    cmd->add_flag("--decrypt", decrypt, "Dechiffrer les entries chiffrees (cle CRI auto-derivee)");

    cmd->callback([]() { cmd_extract(input_path, output_dir, filter, decrypt); });
}

} // namespace iecode::cli
