/// @file push_cmd.cpp
/// Push donnees de jeu vers Supabase/PostgreSQL.
///
/// Usage :
///   iecode push --db-url "postgresql://postgres:pw@host:5432/postgres" --data <data-dir>
///   iecode push --db-url "$DATABASE_URL" --data packages/inagle/data --batch 200

#include "commands.h"

#include "iecode/db/pg_push.h"
#include "iecode/gamedata/loader.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <string>

using json = nlohmann::json;

namespace iecode::cli {

static void cmd_push(const std::string& db_url,
                       const std::string& data_root,
                       int batch_size,
                       bool bg) {
    if (db_url.empty()) {
        fmt::print("{}\n", json{{"ok", false}, {"error", "missing --db-url"}}.dump());
        return;
    }

    // 1. Charger les donnees
    spdlog::info("push: chargement depuis '{}'...", data_root);
    auto db = gamedata::load_game_database(data_root, true);
    if (!db) {
        fmt::print("{}\n", json{{"ok", false}, {"error", "failed to load game data"}}.dump());
        return;
    }

    spdlog::info("push: {} chars, {} skills, {} teams",
                 db->characters.size(), db->skills.size(), db->teams.size());

    // 2. Push
    db::PushOptions opts;
    opts.connection_string = db_url;
    opts.batch_size = batch_size;

    if (bg) {
        // Background : lancer et retourner immediatement
        static db::PushStats stats; // static pour survivre au scope
        db::push_async(*db, opts, stats);
        fmt::print("{}\n", json{
            {"ok", true},
            {"mode", "async"},
            {"characters", db->characters.size()},
            {"skills", db->skills.size()},
        }.dump());
    } else {
        // Synchrone : bloquer et retourner le resultat
        auto result = db::push_sync(*db, opts);
        fmt::print("{}\n", result);
    }
}

// Registration (ajouter dans commands.h)
void register_push_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("push", "Push game data to PostgreSQL/Supabase");

    static std::string db_url;
    static std::string data_root = ".";
    static int batch_size = 200;
    static bool background = false;

    cmd->add_option("--db-url", db_url, "PostgreSQL connection string")->required()->envname("DATABASE_URL");
    cmd->add_option("--data", data_root, "Game data root directory")->default_val("data");
    cmd->add_option("--batch", batch_size, "Rows per INSERT batch")->default_val(200);
    cmd->add_flag("--bg", background, "Run in background (return immediately)");

    cmd->callback([]() { cmd_push(db_url, data_root, batch_size, background); });
}

} // namespace iecode::cli
