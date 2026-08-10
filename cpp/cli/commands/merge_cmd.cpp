/// @file merge_cmd.cpp
/// Commande CLI 'merge' — fusion recursive de dossiers de mods.
///
/// Usage :
///   iecode merge <source> <target> [--no-overwrite]
///   iecode merge mod1/ mod2/ mod3/ -o merged/ [--pack --cpklist cpk_list.cfg.bin]
///
/// Fusionne un ou plusieurs dossiers source dans un dossier cible.
/// Par defaut, les fichiers existants dans la cible sont ecrases (dernier gagne).
/// Avec --pack, lance automatiquement le pack apres la fusion.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/viola/merge.h"
#include "iecode/viola/pack.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <filesystem>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

static void cmd_merge(const std::vector<std::string>& sources,
                       const std::string& output_dir,
                       bool overwrite,
                       bool do_pack,
                       const std::string& cpklist_path,
                       const std::string& platform) {
    if (sources.empty()) {
        emit_error("au moins un dossier source est requis");
        return;
    }

    auto t0 = std::chrono::steady_clock::now();

    const fs::path target(output_dir);

    // Statistiques agregees
    size_t total_copied = 0;
    size_t total_skipped = 0;
    size_t total_dirs = 0;
    uint64_t total_bytes = 0;
    std::vector<json> per_source;

    // Merger chaque source dans la cible (le dernier gagne en cas de conflit)
    for (const auto& src : sources) {
        if (!fs::is_directory(src)) {
            spdlog::warn("merge: dossier source ignore (inexistant) : '{}'", src);
            per_source.push_back(json{
                {"source", src},
                {"error", "dossier inexistant"}
            });
            continue;
        }

        auto result = viola::merge_directories(fs::path(src), target, overwrite);

        per_source.push_back(json{
            {"source", src},
            {"ok", result.success},
            {"files_copied", result.files_copied},
            {"files_skipped", result.files_skipped},
            {"dirs_created", result.dirs_created},
            {"bytes_copied", result.bytes_copied}
        });

        if (result.success) {
            total_copied += result.files_copied;
            total_skipped += result.files_skipped;
            total_dirs += result.dirs_created;
            total_bytes += result.bytes_copied;
        } else {
            spdlog::error("merge: erreur pour '{}': {}", src, result.error);
        }
    }

    auto t1 = std::chrono::steady_clock::now();
    const auto merge_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    // Pack automatique apres fusion si demande
    json pack_result_json;
    if (do_pack && !cpklist_path.empty()) {
        spdlog::info("merge: lancement du pack automatique...");
        auto pack_t0 = std::chrono::steady_clock::now();

        const bool is_switch = (platform == "switch" || platform == "SWITCH");
        auto pack_result = viola::cpk_update_file_list(
            fs::path(cpklist_path),
            target,
            target,
            is_switch ? viola::Platform::Switch : viola::Platform::PC);

        auto pack_t1 = std::chrono::steady_clock::now();
        const auto pack_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            pack_t1 - pack_t0).count();

        pack_result_json = json{
            {"ok", pack_result.success},
            {"files_updated", pack_result.files_updated},
            {"files_added", pack_result.files_added},
            {"total_entries", pack_result.total_entries},
            {"elapsed_ms", pack_ms}
        };
        if (!pack_result.success) {
            pack_result_json["error"] = pack_result.error;
        }
    }

    // Emettre le resultat JSON
    json output = {
        {"ok", true},
        {"sources_count", sources.size()},
        {"files_copied", total_copied},
        {"files_skipped", total_skipped},
        {"dirs_created", total_dirs},
        {"bytes_copied", total_bytes},
        {"overwrite", overwrite},
        {"output", output_dir},
        {"elapsed_ms", merge_ms},
        {"details", per_source}
    };

    if (!pack_result_json.is_null()) {
        output["pack"] = pack_result_json;
    }

    emit(output);
}

// ── Registration ───────────────────────────────────────────────────

void register_merge_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("merge", "Fusionner des dossiers de mods");

    static std::vector<std::string> sources;
    static std::string output_dir = "merged";
    static bool no_overwrite = false;
    static bool do_pack = false;
    static std::string cpklist_path;
    static std::string platform = "pc";

    cmd->add_option("sources", sources, "Dossiers source a fusionner")->required();
    cmd->add_option("-o,--output", output_dir, "Dossier de sortie")->default_val("merged");
    cmd->add_flag("--no-overwrite", no_overwrite,
                  "Ne pas ecraser les fichiers existants (premier gagne)");
    cmd->add_flag("--pack", do_pack,
                  "Lancer le pack automatiquement apres la fusion");
    cmd->add_option("--cpklist", cpklist_path,
                    "Chemin vers cpk_list.cfg.bin (requis si --pack)");
    cmd->add_option("--platform", platform,
                    "Plateforme cible pour le pack (pc ou switch)")->default_val("pc");

    cmd->callback([]() {
        cmd_merge(sources, output_dir, !no_overwrite, do_pack, cpklist_path, platform);
    });
}

} // namespace iecode::cli
