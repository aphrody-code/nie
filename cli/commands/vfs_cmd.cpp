/// @file vfs_cmd.cpp
/// Commande CLI 'vfs' — systeme de fichiers virtuel (VFS).
///
/// Sous-commandes :
///   iecode vfs init <game_dir>           — charge le VFS, affiche les stats
///   iecode vfs find <path>               — trouve quel CPK contient l'asset
///   iecode vfs read <path> -o <output>   — lit un asset directement depuis le CPK
///   iecode vfs list [pattern]            — liste les assets correspondant au pattern

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/vfs/vfs.h"

#include <CLI/CLI.hpp>
#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

void register_vfs_command(CLI::App& app) {
    auto* vfs_cmd = app.add_subcommand("vfs", "Systeme de fichiers virtuel (VFS)");
    vfs_cmd->require_subcommand(1);

    // ── vfs init ────────────────────────────────────────────────────
    {
        auto* sub = vfs_cmd->add_subcommand("init",
            "Charge le VFS depuis le dossier data/ du jeu et affiche les stats");

        static std::string game_dir;
        sub->add_option("game_dir", game_dir,
                         "Chemin vers le dossier 'data/' du jeu")
            ->required();

        sub->callback([]() {
            vfs::Vfs vfs;
            if (!vfs.init(fs::path(game_dir))) {
                emit_error("echec de l'initialisation du VFS");
                return;
            }

            json result;
            result["ok"] = true;
            result["asset_count"] = vfs.asset_count();
            result["cpk_count"] = vfs.cpk_count();

            auto cpk_names = vfs.cpk_list();
            result["cpk_files"] = json::array();
            for (const auto& name : cpk_names) {
                result["cpk_files"].push_back(name);
            }

            emit(result);
            vfs.shutdown();
        });
    }

    // ── vfs find ────────────────────────────────────────────────────
    {
        auto* sub = vfs_cmd->add_subcommand("find",
            "Trouve quel CPK contient un asset");

        static std::string game_dir;
        static std::string asset_path;
        sub->add_option("-d,--data-dir", game_dir,
                         "Chemin vers le dossier 'data/' du jeu")
            ->default_val("data");
        sub->add_option("path", asset_path,
                         "Chemin interne de l'asset")
            ->required();

        sub->callback([]() {
            vfs::Vfs vfs;
            if (!vfs.init(fs::path(game_dir))) {
                emit_error("echec de l'initialisation du VFS");
                return;
            }

            auto entry = vfs.find(asset_path);
            if (!entry) {
                emit_error(fmt::format("asset non trouve: {}", asset_path));
                vfs.shutdown();
                return;
            }

            json result;
            result["ok"] = true;
            result["internal_path"] = entry->internal_path;
            result["cpk_filename"] = entry->cpk_filename;
            result["file_size"] = entry->file_size;
            emit(result);
            vfs.shutdown();
        });
    }

    // ── vfs read ────────────────────────────────────────────────────
    {
        auto* sub = vfs_cmd->add_subcommand("read",
            "Lit un asset directement depuis le CPK");

        static std::string game_dir;
        static std::string asset_path;
        static std::string output_path;
        sub->add_option("-d,--data-dir", game_dir,
                         "Chemin vers le dossier 'data/' du jeu")
            ->default_val("data");
        sub->add_option("path", asset_path,
                         "Chemin interne de l'asset")
            ->required();
        sub->add_option("-o,--output", output_path,
                         "Fichier de sortie")
            ->required();

        sub->callback([]() {
            vfs::Vfs vfs;
            if (!vfs.init(fs::path(game_dir))) {
                emit_error("echec de l'initialisation du VFS");
                return;
            }

            auto data = vfs.read(asset_path);
            if (data.empty()) {
                emit_error(fmt::format("impossible de lire: {}", asset_path));
                vfs.shutdown();
                return;
            }

            if (!write_file(fs::path(output_path),
                            std::span<const uint8_t>(data))) {
                emit_error(fmt::format("impossible d'ecrire: {}", output_path));
                vfs.shutdown();
                return;
            }

            json result;
            result["ok"] = true;
            result["path"] = asset_path;
            result["output"] = output_path;
            result["size"] = data.size();
            emit(result);
            vfs.shutdown();
        });
    }

    // ── vfs list ────────────────────────────────────────────────────
    {
        auto* sub = vfs_cmd->add_subcommand("list",
            "Liste les assets correspondant a un pattern glob");

        static std::string game_dir;
        static std::string pattern = "*";
        static uint32_t limit = 100;
        sub->add_option("-d,--data-dir", game_dir,
                         "Chemin vers le dossier 'data/' du jeu")
            ->default_val("data");
        sub->add_option("pattern", pattern,
                         "Pattern glob (defaut: *)");
        sub->add_option("-l,--limit", limit,
                         "Nombre maximum de resultats (defaut: 100)");

        sub->callback([]() {
            vfs::Vfs vfs;
            if (!vfs.init(fs::path(game_dir))) {
                emit_error("echec de l'initialisation du VFS");
                return;
            }

            auto entries = vfs.list(pattern);

            json result;
            result["ok"] = true;
            result["total"] = entries.size();

            auto items = json::array();
            const auto max = std::min(static_cast<size_t>(limit), entries.size());
            for (size_t i = 0; i < max; ++i) {
                items.push_back(json{
                    {"path", entries[i].internal_path},
                    {"cpk", entries[i].cpk_filename},
                    {"size", entries[i].file_size},
                });
            }
            result["entries"] = items;
            result["shown"] = max;

            emit(result);
            vfs.shutdown();
        });
        }

    // ── vfs export-index ────────────────────────────────────────────
    {
        auto* sub = vfs_cmd->add_subcommand("export-index",
            "Exporte l'index VFS complet en JSON (cpk -> [{p, s}])");

        static std::string game_dir;
        static std::string output_path;
        sub->add_option("-d,--data-dir", game_dir,
                         "Chemin vers le dossier 'data/' du jeu")->default_val("data");
        sub->add_option("-o,--output", output_path,
                         "Fichier de sortie JSON")->default_val("cpk_index.json");

        sub->callback([]() {
            vfs::Vfs vfs;
            if (!vfs.init(fs::path(game_dir))) {
                emit_error("echec VFS");
                return;
            }

            auto entries = vfs.list("*");

            // Grouper par CPK : {cpk_name: [{p: path, s: size}]}
            json cpks = json::object();
            for (const auto& e : entries) {
                auto& arr = cpks[e.cpk_filename];
                if (arr.is_null()) arr = json::array();
                arr.push_back(json{{"p", e.internal_path}, {"s", e.file_size}});
            }

            json index = json{{"v", 1}, {"cpks", cpks}};

            {
                std::ofstream f(output_path, std::ios::trunc);
                if (!f) {
                    emit_error(fmt::format("impossible d'ecrire : {}", output_path));
                    vfs.shutdown();
                    return;
                }
                f << index.dump();
            }

            emit(json{
                {"ok", true},
                {"cpks", static_cast<int>(cpks.size())},
                {"entries", static_cast<int>(entries.size())},
                {"output", output_path},
            });
            vfs.shutdown();
        });
    }
}

} // namespace iecode::cli
