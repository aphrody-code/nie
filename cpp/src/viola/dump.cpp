#include "iecode/viola/dump.h"

#include "iecode/formats/criware/cpk_reader.h"

#include <algorithm>
#include <fstream>
#include <mutex>
#include <spdlog/spdlog.h>
#include <thread>
#include <vector>

namespace iecode::viola {

namespace {

// ── Helpers (prefixe viola_dump_ pour unity build) ─────────────────

/// Collecte les fichiers .cpk dans un dossier (recursivement si demande).
[[nodiscard]] std::vector<std::filesystem::path> viola_dump_find_cpks(
    const std::filesystem::path& dir, bool recursive) {

    std::vector<std::filesystem::path> cpks;
    std::error_code ec;

    if (recursive) {
        for (const auto& entry : std::filesystem::recursive_directory_iterator(dir, ec)) {
            if (!entry.is_regular_file()) continue;
            auto ext = entry.path().extension().string();
            // Comparaison case-insensitive
            std::transform(ext.begin(), ext.end(), ext.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            if (ext == ".cpk") {
                cpks.push_back(entry.path());
            }
        }
    } else {
        for (const auto& entry : std::filesystem::directory_iterator(dir, ec)) {
            if (!entry.is_regular_file()) continue;
            auto ext = entry.path().extension().string();
            std::transform(ext.begin(), ext.end(), ext.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            if (ext == ".cpk") {
                cpks.push_back(entry.path());
            }
        }
    }

    return cpks;
}

/// Ecrit un buffer dans un fichier, creant les dossiers parents si necessaire.
/// Thread-safe grace au mutex partage pour la creation de dossiers.
bool viola_dump_write_file(const std::filesystem::path& path,
                            std::span<const uint8_t> data,
                            std::mutex& dir_mutex) {
    // Creer le dossier parent si necessaire (protege par mutex)
    {
        auto parent = path.parent_path();
        std::error_code ec;
        if (!std::filesystem::exists(parent, ec)) {
            std::lock_guard lock(dir_mutex);
            // Re-verifier apres le lock (double-check locking)
            if (!std::filesystem::exists(parent, ec)) {
                std::filesystem::create_directories(parent, ec);
                if (ec) {
                    spdlog::error("viola_dump: impossible de creer '{}'", parent.string());
                    return false;
                }
            }
        }
    }

    std::ofstream file(path, std::ios::binary);
    if (!file.is_open()) return false;

    file.write(reinterpret_cast<const char*>(data.data()),
               static_cast<std::streamsize>(data.size()));
    return file.good();
}

/// Traite un seul fichier CPK : ouvre, liste, extrait chaque fichier.
void viola_dump_process_cpk(
    const std::filesystem::path& cpk_path,
    const std::filesystem::path& output_dir,
    DumpStats& stats,
    std::mutex& dir_mutex) {

    iecode::criware::CpkReader reader;
    if (!reader.open(cpk_path)) {
        spdlog::warn("viola_dump: echec d'ouverture de '{}'", cpk_path.string());
        stats.cpk_failed.fetch_add(1, std::memory_order_relaxed);
        return;
    }

    const auto& entries = reader.list();
    spdlog::debug("viola_dump: '{}' contient {} fichiers",
                   cpk_path.filename().string(), entries.size());

    for (const auto& entry : entries) {
        auto extracted = reader.extract(entry);
        if (extracted.empty()) {
            spdlog::debug("viola_dump: extraction vide pour '{}' dans '{}'",
                           entry.filename, cpk_path.filename().string());
            continue;
        }

        // Construire le chemin de sortie : output_dir / directory / filename
        std::filesystem::path out_path = output_dir;
        if (!entry.directory.empty()) {
            out_path /= entry.directory;
        }
        out_path /= entry.filename;

        if (viola_dump_write_file(out_path, extracted, dir_mutex)) {
            stats.files_extracted.fetch_add(1, std::memory_order_relaxed);
            stats.bytes_written.fetch_add(extracted.size(), std::memory_order_relaxed);
        }
    }

    stats.cpk_processed.fetch_add(1, std::memory_order_relaxed);
}

} // namespace

size_t batch_extract(const std::filesystem::path& cpk_dir,
                     const std::filesystem::path& output_dir,
                     const DumpOptions& options,
                     DumpStats& stats) {

    // --- Trouver les CPK ---
    auto cpk_paths = viola_dump_find_cpks(cpk_dir, options.recursive);
    if (cpk_paths.empty()) {
        spdlog::info("viola_dump: aucun fichier .cpk trouve dans '{}'", cpk_dir.string());
        return 0;
    }

    stats.cpk_found.store(cpk_paths.size(), std::memory_order_relaxed);
    spdlog::info("viola_dump: {} CPK trouves dans '{}'", cpk_paths.size(), cpk_dir.string());

    // --- Creer le dossier de sortie ---
    {
        std::error_code ec;
        std::filesystem::create_directories(output_dir, ec);
        if (ec) {
            spdlog::error("viola_dump: impossible de creer '{}'", output_dir.string());
            return 0;
        }
    }

    // --- Determiner le nombre de threads ---
    int num_threads = options.threads;
    if (num_threads <= 0) {
        num_threads = std::max(1, static_cast<int>(std::thread::hardware_concurrency()) - 1);
    }
    num_threads = std::min(num_threads, static_cast<int>(cpk_paths.size()));
    spdlog::info("viola_dump: extraction avec {} threads", num_threads);

    // --- Work-stealing via index atomique ---
    std::atomic<size_t> next_idx{0};
    std::mutex dir_mutex;  // Pour la creation thread-safe de dossiers

    auto worker = [&]() {
        while (true) {
            const size_t idx = next_idx.fetch_add(1, std::memory_order_relaxed);
            if (idx >= cpk_paths.size()) break;

            const auto& cpk_path = cpk_paths[idx];

            spdlog::debug("viola_dump: traitement de '{}' ({}/{})",
                           cpk_path.filename().string(), idx + 1, cpk_paths.size());

            viola_dump_process_cpk(cpk_path, output_dir, stats, dir_mutex);

            // Callback de progression
            if (options.on_progress) {
                options.on_progress(stats, cpk_path.filename().string());
            }
        }
    };

    // --- Lancer les threads ---
    if (num_threads == 1) {
        // Single-thread : pas besoin de creer un thread supplementaire
        worker();
    } else {
        std::vector<std::thread> threads;
        threads.reserve(static_cast<size_t>(num_threads));

        for (int i = 0; i < num_threads; ++i) {
            threads.emplace_back(worker);
        }

        for (auto& t : threads) {
            t.join();
        }
    }

    const size_t total_extracted = stats.files_extracted.load(std::memory_order_relaxed);
    spdlog::info("viola_dump: extraction terminee — {} fichiers, {} octets ecrits",
                  total_extracted,
                  stats.bytes_written.load(std::memory_order_relaxed));

    return total_extracted;
}

} // namespace iecode::viola
