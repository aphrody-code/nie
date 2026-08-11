/// @file dump_cmd.cpp
/// Commande CLI 'dump' — extraction massive de toutes les archives CPK
/// d'un dossier de jeu via DumpService.
///
/// Usage :
///   iecode dump <game_dir> -o <output> [--smart] [--filter pattern] [-t N]
///
/// Utilise DumpService pour la reprise intelligente (manifest JSON),
/// le tri par taille et l'extraction parallele.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/services/dump_service.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>

#include <atomic>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Commande principale ────────────────────────────────────────────

static void cmd_dump(const std::string& game_dir,
                     const std::string& output_dir,
                     const std::string& filter,
                     bool smart,
                     int threads,
                     bool priority_mode = false,
                     int64_t large_threshold_kb = 1024) {
    const fs::path root(game_dir);
    if (!fs::exists(root) || !fs::is_directory(root)) {
        emit_error(fmt::format("dossier introuvable : '{}'", game_dir));
        return;
    }

    services::DumpService service(root);

    services::DumpOptions opts;
    opts.output_path = output_dir;
    opts.smart_dump = smart;
    opts.file_filter = filter;
    opts.max_parallelism = threads;  // 0 = auto-detect dans DumpService
    opts.include_loose_files = true;
    opts.priority_mode = priority_mode;
    opts.large_file_threshold = large_threshold_kb * 1024;

    auto result = service.dump(opts);

    emit(json{
        {"ok", result.success},
        {"is_resume", result.is_resume},
        {"cpk_count", result.total_cpks},
        {"files_extracted", result.extracted_files},
        {"files_skipped", result.skipped_files},
        {"loose_files_copied", result.loose_files_copied},
        {"extracted_bytes", result.extracted_bytes},
        {"errors", result.errors.size()},
        {"threads", opts.max_parallelism},
        {"elapsed_s", result.duration_seconds},
    });
}

// ── Registration ───────────────────────────────────────────────────

void register_dump_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("dump", "Extraction massive de toutes les archives CPK");

    static std::string game_dir;
    static std::string output_dir;
    static std::string filter;
    static bool smart = false;
    static int threads = 0;
    static bool priority = false;
    static int64_t large_threshold_kb = 1024;  // defaut 1 MB

    cmd->add_option("game_dir", game_dir, "Dossier du jeu contenant les CPK")->required();
    cmd->add_option("-o,--output", output_dir, "Repertoire de sortie")->default_val(".");
    cmd->add_flag("--smart", smart, "Reprise intelligente via manifest JSON");
    cmd->add_option("--filter", filter, "Pattern glob pour filtrer les entries (ex: *.g4tx)");
    cmd->add_option("-t,--threads", threads, "Nombre de threads (0 = auto-detect CPU)");
    cmd->add_flag("--priority", priority,
                  "Extrait gamedata/scripts avant textures (gamedata=prio 0, textures=prio 2)");
    cmd->add_option("--large-threshold", large_threshold_kb,
                    "Seuil gros fichier en KB pour le pool dedie (defaut: 1024 = 1 MB)");

    cmd->callback([]() { cmd_dump(game_dir, output_dir, filter, smart, threads, priority, large_threshold_kb); });
}

} // namespace iecode::cli
