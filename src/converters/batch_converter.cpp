#include "iecode/converters/batch_converter.h"

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <chrono>
#include <cstring>
#include <fstream>
#include <thread>

namespace fs = std::filesystem;

namespace iecode::converters {

// ── Helpers ─────────────────────────────────────────────────────────

/// Lecture rapide d'un fichier en memoire (pre-alloue au bon size).
static std::vector<uint8_t> fast_read(const fs::path& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return {};
    const auto size = f.tellg();
    if (size <= 0) return {};
    std::vector<uint8_t> buf(static_cast<size_t>(size));
    f.seekg(0);
    f.read(reinterpret_cast<char*>(buf.data()), size);
    return buf;
}

// format_ext() is now inline in texture_export.h

/// Traitement d'un fichier G4TX unique.
/// Retourne le nombre de textures exportees (0 si erreur).
static size_t process_single(
    const fs::path& input_path,
    const fs::path& output_dir,
    const BatchOptions& opts,
    BatchStats& stats)
{
    // 1. Lire le fichier
    auto data = fast_read(input_path);
    if (data.empty()) return 0;
    stats.total_bytes_in.fetch_add(data.size(), std::memory_order_relaxed);

    // 2. Parser le G4TX
    auto g4tx = level5::g4tx_parse(data);
    if (!g4tx || g4tx->textures.empty()) return 0;

    // Liberer les donnees brutes immediatement (le parser a copie ce qu'il faut)
    data.clear();
    data.shrink_to_fit();

    const auto ext = format_ext(opts.format);
    size_t exported = 0;

    // 3. Pour chaque texture dans le G4TX
    for (const auto& tex : g4tx->textures) {
        // Nom de sortie
        std::string out_name;
        if (g4tx->textures.size() == 1) {
            // Mono-texture : utiliser le nom du fichier G4TX
            out_name = input_path.stem().string();
        } else {
            // Multi-texture : fichier_texname
            out_name = input_path.stem().string() + "_" + tex.name;
        }

        const auto out_path = output_dir / (out_name + ext);

        // Skip si existe deja
        if (opts.skip_existing && fs::exists(out_path)) {
            stats.skipped.fetch_add(1, std::memory_order_relaxed);
            continue;
        }

        bool ok = false;
        uint64_t pixels = static_cast<uint64_t>(tex.width) * tex.height;

        switch (opts.format) {
            case ExportFormat::DDS:
                ok = export_dds(tex, out_path);
                break;
            case ExportFormat::WebP:
                ok = export_webp(tex, out_path, opts.webp_quality, opts.webp_lossless);
                break;
            case ExportFormat::PNG:
            default:
                ok = export_png(tex, out_path);
                break;
        }

        if (ok) {
            ++exported;
            stats.total_pixels.fetch_add(pixels, std::memory_order_relaxed);
            if (fs::exists(out_path)) {
                stats.total_bytes_out.fetch_add(
                    fs::file_size(out_path),
                    std::memory_order_relaxed);
            }
        }
    }

    return exported;
}

// ── Pipeline principal ──────────────────────────────────────────────

size_t batch_convert(const fs::path& input_dir,
                      const fs::path& output_dir,
                      const BatchOptions& options,
                      BatchStats& stats)
{
    const auto t0 = std::chrono::high_resolution_clock::now();

    // 1. Enumeration rapide
    spdlog::info("batch: scan de '{}' ...", input_dir.string());
    std::vector<fs::path> files;
    files.reserve(20000); // Pre-alloc pour 20K fichiers

    auto scan = [&](auto&& iter) {
        for (const auto& entry : iter) {
            if (entry.is_regular_file()) {
                const auto& ext = entry.path().extension();
                if (ext == ".g4tx" || ext == ".G4TX") {
                    files.push_back(entry.path());
                }
            }
        }
    };

    if (options.recursive) {
        scan(fs::recursive_directory_iterator(input_dir));
    } else {
        scan(fs::directory_iterator(input_dir));
    }

    if (files.empty()) {
        spdlog::warn("batch: aucun fichier G4TX trouve");
        return 0;
    }

    // Trier pour un acces disque sequentiel (meilleur pour HDD, neutre pour SSD)
    std::sort(files.begin(), files.end());

    stats.total_files.store(files.size(), std::memory_order_relaxed);
    const size_t total = files.size();

    // 2. Determiner le nombre de threads
    int num_threads = options.threads > 0
        ? options.threads
        : static_cast<int>(std::thread::hardware_concurrency());
    num_threads = std::max(1, std::min(num_threads, static_cast<int>(total)));

    spdlog::info("batch: {} fichiers, {} threads, format {}",
                 total, num_threads,
                 options.format == ExportFormat::PNG ? "PNG" :
                 options.format == ExportFormat::WebP ? "WebP" : "DDS");

    // 3. Creer le dossier de sortie
    std::error_code ec;
    fs::create_directories(output_dir, ec);

    // 4. Pre-creer les sous-dossiers (evite la contention mkdir en parallele)
    if (!options.flat_output) {
        std::vector<fs::path> dirs_to_create;
        for (const auto& f : files) {
            auto rel = fs::relative(f.parent_path(), input_dir);
            auto target = output_dir / rel;
            if (std::find(dirs_to_create.begin(), dirs_to_create.end(), target) == dirs_to_create.end()) {
                dirs_to_create.push_back(target);
            }
        }
        for (const auto& d : dirs_to_create) {
            fs::create_directories(d, ec);
        }
    }

    // 5. Work-stealing atomique
    std::atomic<size_t> next_idx{0};

    auto worker = [&]() {
        while (true) {
            const size_t idx = next_idx.fetch_add(1, std::memory_order_relaxed);
            if (idx >= total) break;

            const auto& file_path = files[idx];

            // Calculer le dossier de sortie
            fs::path file_out_dir;
            if (options.flat_output) {
                file_out_dir = output_dir;
            } else {
                auto rel = fs::relative(file_path.parent_path(), input_dir);
                file_out_dir = output_dir / rel;
            }

            // Traiter le fichier
            const size_t count = process_single(file_path, file_out_dir, options, stats);

            if (count > 0) {
                stats.succeeded.fetch_add(1, std::memory_order_relaxed);
            } else {
                stats.failed.fetch_add(1, std::memory_order_relaxed);
            }
            stats.processed.fetch_add(1, std::memory_order_relaxed);

            // Callback de progression
            if (options.on_progress) {
                options.on_progress(stats, file_path.filename().string());
            }
        }
    };

    // 6. Lancer les threads
    std::vector<std::thread> threads;
    threads.reserve(static_cast<size_t>(num_threads));
    for (int i = 0; i < num_threads; ++i) {
        threads.emplace_back(worker);
    }
    for (auto& t : threads) {
        t.join();
    }

    // 7. Calculer le temps total
    const auto t1 = std::chrono::high_resolution_clock::now();
    const auto elapsed_us = std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
    stats.elapsed_us.store(static_cast<uint64_t>(elapsed_us), std::memory_order_relaxed);

    const double elapsed_s = static_cast<double>(elapsed_us) / 1'000'000.0;
    const double fps = elapsed_s > 0 ? static_cast<double>(stats.succeeded.load()) / elapsed_s : 0;
    const double mpx_s = elapsed_s > 0
        ? static_cast<double>(stats.total_pixels.load()) / 1'000'000.0 / elapsed_s
        : 0;
    const double mb_in = static_cast<double>(stats.total_bytes_in.load()) / (1024.0 * 1024.0);
    const double mb_out = static_cast<double>(stats.total_bytes_out.load()) / (1024.0 * 1024.0);

    spdlog::info("batch: termine en {:.1f}s", elapsed_s);
    spdlog::info("  {} OK, {} erreurs, {} ignores",
                 stats.succeeded.load(), stats.failed.load(), stats.skipped.load());
    spdlog::info("  {:.0f} fichiers/s, {:.0f} Mpx/s", fps, mpx_s);
    spdlog::info("  {:.0f} MB in → {:.0f} MB out (ratio {:.1f}x)",
                 mb_in, mb_out, mb_out > 0 ? mb_in / mb_out : 0);

    return stats.succeeded.load();
}

} // namespace iecode::converters
