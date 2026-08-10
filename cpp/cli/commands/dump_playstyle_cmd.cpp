/// @file dump_playstyle_cmd.cpp
/// Commande CLI 'dump-playstyle' — export du systeme PlayStyle en JSON.
///
/// Lit les fichiers .cfg.bin.json pre-parses depuis le repertoire data,
/// agrege les 5 sources (chara_param, menu_text, chara_param_table,
/// growth_table, team_build_config) et produit un JSON complet sur stdout.
///
/// Usage :
///   iecode dump-playstyle --data <path> [--output <file>]

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/gamedata/playstyle_parser.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Commande principale ────────────────────────────────────────────────

static void cmd_dump_playstyle(const std::string& data_root,
                                const std::string& output_path) {
    const fs::path root(data_root);
    if (!fs::exists(root)) {
        emit_error(fmt::format("data root introuvable : '{}'", data_root));
        return;
    }

    auto db = gamedata::parse_playstyle_system(root);
    if (!db) {
        emit_error("echec du parsing du systeme playstyle");
        return;
    }

    auto data = gamedata::playstyle_to_json(*db);

    if (output_path.empty()) {
        emit(data);
        return;
    }

    // Ecriture dans un fichier
    fs::create_directories(fs::path(output_path).parent_path());
    std::ofstream out(output_path);
    if (!out) {
        emit_error(fmt::format("impossible d'ecrire '{}'", output_path));
        return;
    }
    out << data.dump(2) << "\n";
    out.close();

    emit(json{
        {"ok", true},
        {"output", output_path},
        {"size", fs::file_size(output_path)},
        {"labels", db->labels.size()},
        {"total_characters", db->total_characters},
        {"growth_entries", db->growth_table_lv1.size()},
        {"team_build_info", db->team_build.info.size()},
    });
}

// ── Registration ───────────────────────────────────────────────────────

void register_dump_playstyle_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("dump-playstyle",
        "Export PlayStyle system data as JSON (labels, distribution, tables, team build)");

    static std::string data_root;
    static std::string output_path;

    cmd->add_option("--data", data_root,
                    "Game data root directory (contains common/gamedata/)")
        ->default_val("data");
    cmd->add_option("-o,--output", output_path,
                    "Output file path (default: stdout)");

    cmd->callback([]() { cmd_dump_playstyle(data_root, output_path); });
}

} // namespace iecode::cli
