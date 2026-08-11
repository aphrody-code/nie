/// @file pipeline_cmd.cpp
/// Commande CLI 'pipeline' — batch extract -> convert -> export.
///
/// Usage :
///   iecode pipeline <input_dir> -o <output_dir> [-r] [--format png] [-t N]
///
/// Scanne un repertoire pour les fichiers supportes (G4TX, cfg.bin),
/// et convertit chacun vers le format de sortie correspondant :
///   - G4TX -> PNG/WebP/DDS
///   - cfg.bin -> JSON

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/format_detector.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/formats/level5/g4tx.h"
#include "iecode/converters/texture_export.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <span>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Detection cfg.bin par extension ───────────────────────────────

static bool pipeline_is_cfgbin(const fs::path& path) {
    const auto ext = path.extension().string();
    const auto stem = path.stem().string();
    return ext == ".bin" && stem.find(".cfg") != std::string::npos;
}

// ── Conversion d'un fichier G4TX ──────────────────────────────────

static bool pipeline_convert_g4tx(const fs::path& input,
                                  std::span<const uint8_t> data,
                                  const fs::path& output_dir,
                                  const std::string& format_str,
                                  bool flat) {
    auto file = level5::g4tx_parse(data);
    if (!file || file->textures.empty()) return false;

    // Determiner le format
    converters::ExportFormat fmt = converters::ExportFormat::PNG;
    if (format_str == "webp") fmt = converters::ExportFormat::WebP;
    else if (format_str == "dds") fmt = converters::ExportFormat::DDS;
    const auto ext = converters::format_ext(fmt);

    bool any_ok = false;
    for (size_t i = 0; i < file->textures.size(); ++i) {
        const auto& tex = file->textures[i];
        std::string base_name = tex.name.empty()
            ? fmt::format("{}_{}", input.stem().string(), i)
            : tex.name;

        fs::path out_path;
        if (flat) {
            out_path = output_dir / (base_name + ext);
        } else {
            // Conserver le nom du G4TX comme sous-dossier
            out_path = output_dir / input.stem() / (base_name + ext);
        }
        fs::create_directories(out_path.parent_path());

        bool ok = false;
        switch (fmt) {
            case converters::ExportFormat::PNG:  ok = converters::export_png(tex, out_path); break;
            case converters::ExportFormat::DDS:  ok = converters::export_dds(tex, out_path); break;
            case converters::ExportFormat::WebP: ok = converters::export_webp(tex, out_path); break;
        }
        if (ok) any_ok = true;
    }
    return any_ok;
}

// ── Conversion d'un fichier cfg.bin ───────────────────────────────

static bool pipeline_convert_cfgbin(const fs::path& input,
                                    std::span<const uint8_t> data,
                                    const fs::path& output_dir,
                                    bool flat) {
    auto cfg = level5::cfgbin_parse(data);
    if (!cfg) return false;

    auto json_str = level5::cfgbin_to_json(*cfg);

    fs::path out_path;
    if (flat) {
        out_path = output_dir / (input.stem().string() + ".json");
    } else {
        // Garder la hierarchie relative
        out_path = output_dir / input.stem() / (input.stem().string() + ".json");
    }
    fs::create_directories(out_path.parent_path());

    std::ofstream f(out_path);
    if (!f) return false;
    f << json_str;
    return f.good();
}

// ── Pipeline principal ────────────────────────────────────────────

static void cmd_pipeline(const std::string& input_dir,
                         const std::string& output_dir,
                         const std::string& format_str,
                         bool recursive,
                         bool flat,
                         int threads) {
    const fs::path in_root(input_dir);
    if (!fs::exists(in_root) || !fs::is_directory(in_root)) {
        emit_error(fmt::format("dossier introuvable : '{}'", input_dir));
        return;
    }

    const fs::path out_root(output_dir);
    fs::create_directories(out_root);

    auto t0 = std::chrono::steady_clock::now();

    // ── Pass 1 : enumeration sequentielle ───────────────────────────
    std::vector<fs::path> files;
    files.reserve(4096);
    std::error_code ec;

    auto collect = [&](const fs::directory_entry& entry) {
        if (entry.is_regular_file(ec)) {
            files.push_back(entry.path());
        }
    };

    if (recursive) {
        for (const auto& entry : fs::recursive_directory_iterator(in_root, ec)) {
            collect(entry);
        }
    } else {
        for (const auto& entry : fs::directory_iterator(in_root, ec)) {
            collect(entry);
        }
    }

    const size_t total_files = files.size();

    // ── Pass 2 : work-stealing parallele ────────────────────────────
    std::atomic<size_t> next_idx{0};
    std::atomic<int> converted{0};
    std::atomic<int> skipped{0};
    std::atomic<int> errors{0};
    std::atomic<int> g4tx_count{0};
    std::atomic<int> cfgbin_count{0};
    std::atomic<int> other_count{0};

    int num_threads = threads > 0
        ? threads
        : static_cast<int>(std::thread::hardware_concurrency());
    num_threads = std::max(1, std::min(num_threads, static_cast<int>(total_files)));
    if (total_files == 0) num_threads = 1;

    auto worker = [&]() {
        while (true) {
            const size_t idx = next_idx.fetch_add(1, std::memory_order_relaxed);
            if (idx >= total_files) break;

            const auto& path = files[idx];

            // Lire le fichier une seule fois, detecter et convertir
            auto file_data = read_file(path);
            if (file_data.empty()) {
                errors.fetch_add(1, std::memory_order_relaxed);
                continue;
            }

            const auto format = formats::detect(file_data);

            if (format == formats::FileFormat::G4TX) {
                g4tx_count.fetch_add(1, std::memory_order_relaxed);
                if (pipeline_convert_g4tx(path, file_data, out_root, format_str, flat)) {
                    converted.fetch_add(1, std::memory_order_relaxed);
                } else {
                    errors.fetch_add(1, std::memory_order_relaxed);
                    spdlog::warn("pipeline: echec G4TX '{}'", path.filename().string());
                }
            } else if (format == formats::FileFormat::RDBN || pipeline_is_cfgbin(path)) {
                cfgbin_count.fetch_add(1, std::memory_order_relaxed);
                if (pipeline_convert_cfgbin(path, file_data, out_root, flat)) {
                    converted.fetch_add(1, std::memory_order_relaxed);
                } else {
                    errors.fetch_add(1, std::memory_order_relaxed);
                    spdlog::warn("pipeline: echec cfg.bin '{}'", path.filename().string());
                }
            } else {
                other_count.fetch_add(1, std::memory_order_relaxed);
                skipped.fetch_add(1, std::memory_order_relaxed);
            }
        }
    };

    {
        std::vector<std::jthread> pool;
        pool.reserve(static_cast<size_t>(num_threads));
        for (int i = 0; i < num_threads; ++i) {
            pool.emplace_back(worker);
        }
    } // join automatique sur destruction des jthread

    auto t1 = std::chrono::steady_clock::now();
    const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    emit(json{
        {"ok", errors.load() == 0},
        {"totalFiles", static_cast<int>(total_files)},
        {"converted", converted.load()},
        {"skipped", skipped.load()},
        {"errors", errors.load()},
        {"byType", json{
            {"g4tx", g4tx_count.load()},
            {"cfgbin", cfgbin_count.load()},
            {"other", other_count.load()},
        }},
        {"outputDir", out_root.string()},
        {"elapsed_ms", elapsed_ms},
        {"threads", num_threads},
    });
}

// ── Registration ───────────────────────────────────────────────────

void register_pipeline_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("pipeline", "Pipeline batch : extract -> convert -> export");

    static std::string input_dir;
    static std::string output_dir;
    static std::string format_str;
    static bool recursive = false;
    static bool flat = false;
    static int threads = 0;

    cmd->add_option("input", input_dir, "Dossier d'entree contenant les fichiers binaires")->required();
    cmd->add_option("-o,--output", output_dir, "Dossier de sortie")->default_val("output");
    cmd->add_option("-f,--format", format_str, "Format texture de sortie : png|webp|dds")
        ->default_val("png");
    cmd->add_flag("-r,--recursive", recursive, "Scanner recursivement");
    cmd->add_flag("--flat", flat, "Sortie a plat (pas de sous-dossiers)");
    cmd->add_option("-t,--threads", threads, "Nombre de threads (0=auto)")->default_val(0);

    cmd->callback([]() {
        cmd_pipeline(input_dir, output_dir, format_str, recursive, flat, threads);
    });
}

} // namespace iecode::cli
