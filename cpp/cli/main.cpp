/**
 * @file main.cpp
 * Point d'entree de la CLI iecode.
 *
 * Utilise CLI11 pour parser les arguments et dispatcher vers les
 * sous-commandes enregistrees dans cli/commands/.
 */

#include "commands/commands.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>

#include <string>

#ifdef _WIN32
#include <windows.h>
#endif

int main(int argc, char* argv[]) {
#ifdef _WIN32
    // Nommer le thread principal pour le profiling (ETW, WPA, VTune)
    // Requiert Windows 10 1607+ (API SetThreadDescription)
    SetThreadDescription(GetCurrentThread(), L"iecode-main");

    // Activer le mode UTF-8 pour la console Windows
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
#endif

    // ── Init logging ────────────────────────────────────────────
    auto console_sink = std::make_shared<spdlog::sinks::stdout_color_sink_mt>();
    auto logger = std::make_shared<spdlog::logger>("iecode", console_sink);
    spdlog::set_default_logger(logger);
    spdlog::set_level(spdlog::level::info);
    spdlog::set_pattern("[%H:%M:%S.%e] [%^%l%$] %v");

    // ── CLI11 app ───────────────────────────────────────────────
    CLI::App app{"iecode — toolkit RE & modding pour Inazuma Eleven: Victory Road"};
    app.require_subcommand(1);

    // Options globales
    std::string game_path;
    bool verbose = false;

    app.add_option("-g,--game", game_path,
                   "Chemin vers le dossier du jeu (INAZUMA ELEVEN Victory Road)");
    app.add_flag("-v,--verbose", verbose,
                 "Active le mode verbeux (debug logging)");

    // Callback pour activer le debug si --verbose
    app.parse_complete_callback([&]() {
        if (verbose) {
            spdlog::set_level(spdlog::level::debug);
            spdlog::debug("mode verbeux active");
        }
    });

    // ── Enregistrement des sous-commandes ───────────────────────
    iecode::cli::register_extract_command(app);
    iecode::cli::register_dump_command(app);
    iecode::cli::register_config_command(app);
    iecode::cli::register_crypto_command(app);
    iecode::cli::register_pipeline_command(app);
    iecode::cli::register_g4tx_command(app);
    iecode::cli::register_g4mg_command(app);
    iecode::cli::register_info_command(app);
    iecode::cli::register_analyze_command(app);
    iecode::cli::register_format_command(app);
#ifdef IECODE_HAS_GAME
    iecode::cli::register_passive_command(app);
#endif
    iecode::cli::register_dump_gamedata_command(app);
    iecode::cli::register_search_command(app);
    iecode::cli::register_benchmark_command(app);
    iecode::cli::register_g4md_command(app);
    iecode::cli::register_g4cm_command(app);
    iecode::cli::register_g4ra_command(app);
    iecode::cli::register_g4pk_command(app);
    iecode::cli::register_g4sk_command(app);
    iecode::cli::register_utf_command(app);
    iecode::cli::register_convert_command(app);
    iecode::cli::register_pack_command(app);
    iecode::cli::register_merge_command(app);
    iecode::cli::register_prepare_menu_command(app);
    iecode::cli::register_push_command(app);
    iecode::cli::register_nie_command(app);
    iecode::cli::register_lua_command(app);
    iecode::cli::register_dump_playstyle_command(app);
    iecode::cli::register_mod_command(app);
    iecode::cli::register_audio_command(app);
    iecode::cli::register_usm_command(app);
    iecode::cli::register_bin_command(app);
    iecode::cli::register_scene_command(app);
    iecode::cli::register_vfx_command(app);
    iecode::cli::register_mevbin_command(app);
    iecode::cli::register_p3lip_command(app);
    iecode::cli::register_serve_command(app);
    iecode::cli::register_vfs_command(app);
    iecode::cli::register_archive_command(app);
#ifdef IECODE_HAS_ENGINE
    iecode::cli::register_render_command(app);
#endif

    // ── Parse et execution ──────────────────────────────────────
    CLI11_PARSE(app, argc, argv);

    return 0;
}
