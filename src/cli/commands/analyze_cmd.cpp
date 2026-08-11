/// @file analyze_cmd.cpp
/// Commande CLI 'analyze' — analyse RE d'un fichier binaire.
///
/// Usage :
///   iecode analyze <file> [--rtti] [--strings]
///
/// Effectue une analyse structurelle basique :
///   - Detection du format via magic bytes
///   - Taille, entropie basique, sections
///   - Detection RTTI / chaines si demande
///
/// Pour une analyse avancee, utiliser les outils Rizin/Ghidra.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/format_detector.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Calcul d'entropie Shannon (8-bit) ─────────────────────────────

static double compute_entropy(std::span<const uint8_t> data) {
    if (data.empty()) return 0.0;

    std::array<uint64_t, 256> freq{};
    for (auto b : data) ++freq[b];

    double entropy = 0.0;
    const double n = static_cast<double>(data.size());
    for (auto count : freq) {
        if (count == 0) continue;
        const double p = static_cast<double>(count) / n;
        entropy -= p * std::log2(p);
    }
    return entropy;
}

// ── Extraction des magic bytes ────────────────────────────────────

static std::string hex_bytes(std::span<const uint8_t> data, size_t count) {
    std::string result;
    const size_t n = std::min(count, data.size());
    for (size_t i = 0; i < n; ++i) {
        if (i > 0) result += ' ';
        result += fmt::format("{:02X}", data[i]);
    }
    return result;
}

// ── Extraction des chaines ASCII ──────────────────────────────────

static json extract_strings(std::span<const uint8_t> data, size_t min_len = 4) {
    auto strings = json::array();
    std::string current;
    size_t start_offset = 0;

    for (size_t i = 0; i < data.size(); ++i) {
        const auto c = static_cast<char>(data[i]);
        if (c >= 0x20 && c < 0x7F) {
            if (current.empty()) start_offset = i;
            current += c;
        } else {
            if (current.size() >= min_len) {
                strings.push_back(json{
                    {"offset", fmt::format("0x{:X}", start_offset)},
                    {"value", current},
                });
            }
            current.clear();
        }
    }
    // Derniere chaine si en cours
    if (current.size() >= min_len) {
        strings.push_back(json{
            {"offset", fmt::format("0x{:X}", start_offset)},
            {"value", current},
        });
    }

    return strings;
}

// ── Detection RTTI (heuristique simple) ───────────────────────────
/// Recherche des patterns ".?AV" (MSVC RTTI class descriptor prefix)
/// dans les donnees brutes.

static json extract_rtti(std::span<const uint8_t> data) {
    auto classes = json::array();
    const std::array<uint8_t, 4> pattern = {'.', '?', 'A', 'V'};

    for (size_t i = 0; i + 4 < data.size(); ++i) {
        if (std::memcmp(&data[i], pattern.data(), 4) != 0) continue;

        // Extraire le nom de classe jusqu'au '@@' ou fin de chaine
        std::string name;
        size_t j = i + 4;
        while (j < data.size() && data[j] >= 0x20 && data[j] < 0x7F) {
            name += static_cast<char>(data[j]);
            ++j;
        }

        if (name.size() >= 3) {
            // Retirer le suffixe '@@' si present
            if (name.size() >= 2 && name.substr(name.size() - 2) == "@@") {
                name = name.substr(0, name.size() - 2);
            }
            classes.push_back(json{
                {"offset", fmt::format("0x{:X}", i)},
                {"name", name},
            });
        }
    }

    return classes;
}

// ── Helper pour detection cfg.bin par extension ───────────────────

static bool analyze_is_cfgbin(const fs::path& path) {
    const auto ext = path.extension().string();
    const auto stem = path.stem().string();
    return ext == ".bin" && stem.find(".cfg") != std::string::npos;
}

// ── Analyse principale ────────────────────────────────────────────

static void cmd_analyze(const std::string& input_path,
                        bool show_rtti,
                        bool show_strings) {
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

    spdlog::info("analyze: '{}' ({} octets)", path.filename().string(), data.size());

    // Detection de format
    const auto format = formats::detect(data);
    const auto format_str = std::string(formats::format_name(format));

    // Calcul d'entropie
    const double entropy = compute_entropy(data);

    // Comptage des octets nuls
    const size_t null_count = std::count(data.begin(), data.end(), uint8_t{0});
    const double null_ratio = static_cast<double>(null_count) / static_cast<double>(data.size());

    // Resultat de base
    json result{
        {"ok", true},
        {"name", path.filename().string()},
        {"size", data.size()},
        {"format", format_str},
        {"magic", hex_bytes(data, 16)},
        {"entropy", std::round(entropy * 1000.0) / 1000.0},
        {"nullRatio", std::round(null_ratio * 10000.0) / 10000.0},
    };

    // Heuristique : fichier probablement compresse/chiffre si entropie > 7.5
    if (entropy > 7.5) {
        result["hint"] = "haute entropie — probablement compresse ou chiffre";
    } else if (entropy < 1.0) {
        result["hint"] = "tres basse entropie — donnees repetitives ou padding";
    }

    // Detection cfg.bin par extension
    if (format == formats::FileFormat::Unknown) {
        if (analyze_is_cfgbin(path)) {
            result["detectedByExtension"] = "CfgBin";
        }
    }

    // RTTI si demande
    if (show_rtti) {
        auto classes = extract_rtti(data);
        result["rtti"] = json{
            {"count", classes.size()},
            {"classes", std::move(classes)},
        };
    }

    // Chaines ASCII si demandees
    if (show_strings) {
        auto strings = extract_strings(data);
        result["strings"] = json{
            {"count", strings.size()},
            {"values", std::move(strings)},
        };
    }

    emit(result);
}

// ── Registration ───────────────────────────────────────────────────

void register_analyze_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("analyze", "Analyse RE d'un fichier binaire");

    static std::string input_path;
    static bool show_rtti = false;
    static bool show_strings = false;

    cmd->add_option("input", input_path, "Fichier a analyser")->required();
    cmd->add_flag("--rtti", show_rtti, "Extraire les classes RTTI (pattern .?AV)");
    cmd->add_flag("--strings", show_strings, "Extraire les chaines ASCII (min 4 chars)");

    cmd->callback([]() {
        cmd_analyze(input_path, show_rtti, show_strings);
    });
}

} // namespace iecode::cli
