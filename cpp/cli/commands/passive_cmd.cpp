/// @file passive_cmd.cpp
/// Commande CLI 'passive' — extraction des competences passives depuis cfg.bin.
///
/// Usage :
///   iecode passive <file.cfg.bin> [-o output.json]
///
/// Charge un fichier cfg.bin contenant des GDSPassiveSkillConfig,
/// extrait la liste des competences passives, et sort le JSON.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/game/passive_skills.h"
#include "iecode/formats/level5/cfgbin.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Extraction des passives ───────────────────────────────────────

static void cmd_passive(const std::string& input_path,
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

    spdlog::info("passive: parsing cfg.bin '{}' ({} octets)",
                 path.filename().string(), data.size());

    auto t0 = std::chrono::steady_clock::now();

    // Parser le cfg.bin
    auto cfg = level5::cfgbin_parse(data);
    if (!cfg) {
        emit_error(fmt::format("echec du parsing cfg.bin : '{}'", input_path));
        return;
    }

    // Extraire les competences passives
    auto skills = game::load_passive_skills(*cfg);

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    spdlog::info("passive: {} competences passives extraites en {}ms",
                 skills.size(), elapsed_ms);

    // Construire le JSON de sortie
    auto skills_arr = json::array();
    for (const auto& skill : skills) {
        skills_arr.push_back(json{
            {"skillHash", fmt::format("0x{:08X}", skill.skill_hash)},
            {"nameHash", fmt::format("0x{:08X}", skill.name_hash)},
            {"buildType", skill.build_type},
        });
    }

    json result{
        {"ok", true},
        {"input", path.filename().string()},
        {"format", cfg->format == level5::CfgBinFile::Format::RDBN ? "RDBN" : "T2B"},
        {"skillCount", skills.size()},
        {"elapsed_ms", elapsed_ms},
        {"skills", std::move(skills_arr)},
    };

    if (!output_path.empty()) {
        // Ecrire dans un fichier
        const fs::path out(output_path);
        fs::create_directories(out.parent_path());
        std::ofstream f(out);
        if (!f) {
            emit_error(fmt::format("impossible d'ecrire '{}'", output_path));
            return;
        }
        f << result.dump(2);
        f.close();

        // Emettre un resume sur stdout
        emit(json{
            {"ok", true},
            {"input", path.filename().string()},
            {"output", out.string()},
            {"skillCount", skills.size()},
            {"elapsed_ms", elapsed_ms},
        });
    } else {
        emit(result);
    }
}

// ── Registration ───────────────────────────────────────────────────

void register_passive_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("passive", "Lister les competences passives depuis cfg.bin");

    static std::string input_path;
    static std::string output_path;

    cmd->add_option("input", input_path, "Fichier cfg.bin contenant les skills")->required();
    cmd->add_option("-o,--output", output_path, "Fichier JSON de sortie (defaut: stdout)");

    cmd->callback([]() {
        cmd_passive(input_path, output_path);
    });
}

} // namespace iecode::cli
