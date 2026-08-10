/// @file config_cmd.cpp
/// Commande CLI 'config' — conversion cfg.bin <-> JSON.
///
/// Sous-commandes :
///   iecode config read <file>      cfg.bin -> JSON sur stdout
///   iecode config info <file>      metadata (format, nombre d'entrees)
///
/// Le parsing dechiffre automatiquement via XorShift si necessaire,
/// et auto-detecte le format T2B vs RDBN.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/cfgbin.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── config read — cfg.bin -> JSON ─────────────────────────────────

static void cmd_config_read(const std::string& input_path,
                            const std::string& output_path) {
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

    spdlog::info("config read: parsing '{}' ({} octets)", path.filename().string(), data.size());

    auto t0 = std::chrono::steady_clock::now();
    auto cfg = level5::cfgbin_parse(data);
    auto t1 = std::chrono::steady_clock::now();
    const auto parse_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    if (!cfg) {
        emit_error(fmt::format("echec du parsing cfg.bin : '{}'", input_path));
        return;
    }

    spdlog::info("config read: parse OK en {}ms, {} noeuds",
                 parse_ms, cfg->node_count());

    // Serialiser en JSON
    auto json_str = level5::cfgbin_to_json(*cfg);

    if (!output_path.empty()) {
        // Ecrire dans un fichier
        const fs::path out(output_path);
        fs::create_directories(out.parent_path());
        std::ofstream f(out);
        if (!f) {
            emit_error(fmt::format("impossible d'ecrire '{}'", output_path));
            return;
        }
        f << json_str;
        f.close();

        emit(json{
            {"ok", true},
            {"input", path.filename().string()},
            {"output", out.string()},
            {"format", cfg->format == level5::CfgBinFile::Format::RDBN ? "RDBN" : "T2B"},
            {"nodeCount", cfg->node_count()},
            {"elapsed_ms", parse_ms},
        });
    } else {
        // Sortie directe sur stdout — le JSON brut du cfg.bin
        // On emballe dans un resultat JSON pour la coherence CLI
        auto parsed = json::parse(json_str, nullptr, false);
        if (parsed.is_discarded()) {
            // Fallback : sortie brute
            fmt::print("{}\n", json_str);
            return;
        }

        emit(json{
            {"ok", true},
            {"input", path.filename().string()},
            {"format", cfg->format == level5::CfgBinFile::Format::RDBN ? "RDBN" : "T2B"},
            {"nodeCount", cfg->node_count()},
            {"elapsed_ms", parse_ms},
            {"data", std::move(parsed)},
        });
    }
}

// ── config info — metadata cfg.bin ────────────────────────────────

static void cmd_config_info(const std::string& input_path) {
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

    auto cfg = level5::cfgbin_parse(data);
    if (!cfg) {
        emit_error(fmt::format("echec du parsing cfg.bin : '{}'", input_path));
        return;
    }

    json result;
    result["ok"] = true;
    result["name"] = path.filename().string();
    result["size"] = data.size();
    result["format"] = cfg->format == level5::CfgBinFile::Format::RDBN ? "RDBN" : "T2B";
    result["nodeCount"] = cfg->node_count();

    if (cfg->format == level5::CfgBinFile::Format::RDBN) {
        result["listCount"] = cfg->lists.size();
        auto lists_arr = json::array();
        for (const auto& list : cfg->lists) {
            lists_arr.push_back(json{
                {"name", list.name},
                {"nameHash", fmt::format("0x{:08X}", list.name_hash)},
                {"entryCount", list.entries.size()},
                {"fieldCount", list.entries.empty() ? 0 : list.entries[0].fields.size()},
            });
        }
        result["lists"] = std::move(lists_arr);
    } else {
        result["rootEntryCount"] = cfg->entries.size();
        result["keyTableSize"] = cfg->key_table.size();
        auto entries_arr = json::array();
        for (const auto& entry : cfg->entries) {
            entries_arr.push_back(json{
                {"name", entry.name},
                {"crc32", fmt::format("0x{:08X}", entry.crc32)},
                {"variableCount", entry.variables.size()},
                {"childCount", entry.children.size()},
            });
        }
        result["entries"] = std::move(entries_arr);
    }

    emit(result);
}

// ── Registration ───────────────────────────────────────────────────

void register_config_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("config", "Convertir cfg.bin <-> JSON");

    // Sous-commande : read (cfg.bin -> JSON)
    auto* read_cmd = cmd->add_subcommand("read", "Lire un cfg.bin et sortir le JSON");
    static std::string read_input;
    static std::string read_output;
    read_cmd->add_option("input", read_input, "Chemin vers le cfg.bin")->required();
    read_cmd->add_option("-o,--output", read_output, "Fichier JSON de sortie (defaut: stdout)");
    read_cmd->callback([]() {
        cmd_config_read(read_input, read_output);
    });

    // Sous-commande : info (metadata)
    auto* info_cmd = cmd->add_subcommand("info", "Afficher les metadonnees du cfg.bin");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "Chemin vers le cfg.bin")->required();
    info_cmd->callback([]() {
        cmd_config_info(info_input);
    });

    cmd->require_subcommand(1);
}

} // namespace iecode::cli
