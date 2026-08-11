/// @file prepare_menu_cmd.cpp
/// Pipeline complet G4TX → WebP pour le bucket Supabase "menu" d'Azalee.
///
/// Convertit 200_icon/ et 220_img/ en WebP avec le nommage exact attendu :
///   - Mono-texture : {g4tx_stem}.webp
///   - Multi-texture : {g4tx_stem}_{texture_name}.webp
///   - Preserve la structure de dossiers (200_icon/10_icon_chr/face/...)
///
/// Deux modes :
///   1. Dossier de G4TX deja extraits : iecode prepare-menu g4tx_dir/ -o webp/
///   2. Dossier de CPKs (ou .cpk unique) : iecode prepare-menu cpk_dir/ -o webp/
///      Streaming direct depuis les CPKs sans ecrire les G4TX intermediaires.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/converters/texture_export.h"
#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/formats/level5/g4tx.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

/// Sanitise un nom de fichier : remplace tout caractere non-ASCII-imprimable
/// ou reserve par Windows (\\ / : * ? " < > | espaces de controle) par '_'.
/// Tronque a 96 caracteres pour eviter les noms absurdes issus de pools de
/// chaines G4TX corrompus. Renvoie "_" si le resultat est vide.
static std::string sanitize_filename(std::string_view in) {
    std::string out;
    out.reserve(std::min<size_t>(in.size(), 96));
    for (unsigned char c : in) {
        if (out.size() >= 96) break;
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                        (c >= '0' && c <= '9') || c == '_' || c == '-' ||
                        c == '.' || c == '(' || c == ')';
        out.push_back(ok ? static_cast<char>(c) : '_');
    }
    if (out.empty()) out = "_";
    return out;
}

/// Genere le nom WebP pour une texture dans un G4TX.
/// Regle : mono-texture → {stem}.webp, multi → {stem}_{tex_name}.webp
static std::string make_webp_name(const std::string& g4tx_stem,
                                    const std::string& tex_name,
                                    size_t tex_count) {
    const auto safe_name = sanitize_filename(tex_name);
    if (tex_count == 1) {
        // Mono-texture : verifier si le nom est deja contenu dans le stem
        // Ex: em010010.g4tx contient texture "010010" → em010010.webp
        if (g4tx_stem.find(safe_name) != std::string::npos) {
            return g4tx_stem + ".webp";
        }
        // Sinon : stem_name.webp
        return g4tx_stem + "_" + safe_name + ".webp";
    }
    // Multi-texture : toujours stem_name.webp
    return g4tx_stem + "_" + safe_name + ".webp";
}

/// Calcule le chemin relatif de sortie en strippant tout ce qui precede
/// "200_icon" ou "220_img" dans le directory CPK.
/// Exemple: "data/dx11/menu/220_img/banner_img" → "220_img/banner_img"
/// Retourne nullopt si le directory ne contient ni "200_icon" ni "220_img".
static std::optional<fs::path> menu_relative_path(std::string_view dir) {
    static constexpr std::array<std::string_view, 2> roots = {"200_icon", "220_img"};
    for (auto root : roots) {
        const auto pos = dir.find(root);
        if (pos != std::string_view::npos) {
            return fs::path(std::string(dir.substr(pos)));
        }
    }
    return std::nullopt;
}

/// Encode un G4TX (deja parse) en WebP(s) sur disque selon la convention Azalee.
/// Met a jour les compteurs atomiques. Retourne true si au moins une texture exportee.
static bool write_g4tx_as_webp(const level5::G4txFile& g4tx,
                                 const std::string& g4tx_stem,
                                 const fs::path& target_dir,
                                 int quality,
                                 bool skip_existing,
                                 std::atomic<size_t>& skip_count,
                                 std::atomic<size_t>& textures_out,
                                 std::atomic<uint64_t>& total_pixels,
                                 std::atomic<uint64_t>& bytes_out) {
    const size_t tc = g4tx.textures.size();
    bool any_ok = false;

    for (const auto& tex : g4tx.textures) {
        // Skip defensif : textures malformees (parser n'a pas reconnu le format,
        // ou donnees vides, ou dimensions absurdes) — evite les chemins instables
        // dans bcdec/libwebp sur entrees corrompues.
        if (tex.format == level5::G4txFormat::Unknown ||
            tex.data.empty() ||
            tex.width == 0 || tex.height == 0 ||
            tex.width > 8192 || tex.height > 8192) {
            continue;
        }

        const auto webp_name = make_webp_name(g4tx_stem, tex.name, tc);
        const auto out_path = target_dir / webp_name;

        if (skip_existing && fs::exists(out_path)) {
            skip_count.fetch_add(1, std::memory_order_relaxed);
            continue;
        }

        const bool exported = converters::export_webp(tex, out_path, quality, false);
        if (exported) {
            any_ok = true;
            textures_out.fetch_add(1, std::memory_order_relaxed);
            total_pixels.fetch_add(static_cast<uint64_t>(tex.width) * tex.height,
                                   std::memory_order_relaxed);
            std::error_code ec;
            const auto sz = fs::file_size(out_path, ec);
            if (!ec) bytes_out.fetch_add(sz, std::memory_order_relaxed);
        }
    }
    return any_ok;
}

// ── Mode 1 : Dossier de G4TX deja extraits ─────────────────────────

static void cmd_prepare_menu_from_g4tx(const std::string& input_dir,
                                          const std::string& output_dir,
                                          int threads,
                                          int quality,
                                          bool skip_existing) {
    if (!fs::is_directory(input_dir)) {
        emit(json{{"ok", false}, {"error", "directory not found"}});
        return;
    }

    // 1. Scan
    std::vector<fs::path> files;
    files.reserve(25000);
    for (const auto& entry : fs::recursive_directory_iterator(input_dir)) {
        if (entry.is_regular_file()) {
            const auto& ext = entry.path().extension();
            if (ext == ".g4tx" || ext == ".G4TX") {
                files.push_back(entry.path());
            }
        }
    }

    if (files.empty()) {
        emit(json{{"ok", false}, {"error", "no g4tx files found"}});
        return;
    }

    std::sort(files.begin(), files.end());
    const size_t total = files.size();

    // 2. Pre-creer les sous-dossiers
    const fs::path in_base(input_dir);
    const fs::path out_base(output_dir);

    {
        std::vector<fs::path> dirs;
        for (const auto& f : files) {
            auto rel = fs::relative(f.parent_path(), in_base);
            auto d = out_base / rel;
            if (std::find(dirs.begin(), dirs.end(), d) == dirs.end()) {
                dirs.push_back(d);
            }
        }
        for (const auto& d : dirs) {
            std::error_code ec;
            fs::create_directories(d, ec);
        }
    }

    // 3. Work-stealing
    int num_threads = threads > 0 ? threads
                                   : static_cast<int>(std::thread::hardware_concurrency());
    num_threads = std::max(1, std::min(num_threads, static_cast<int>(total)));

    std::atomic<size_t> next_idx{0};
    std::atomic<size_t> ok_count{0};
    std::atomic<size_t> fail_count{0};
    std::atomic<size_t> skip_count{0};
    std::atomic<uint64_t> total_pixels{0};
    std::atomic<uint64_t> bytes_in{0};
    std::atomic<uint64_t> bytes_out{0};
    std::atomic<size_t> textures_out{0};

    const auto t0 = std::chrono::high_resolution_clock::now();

    auto worker = [&]() {
        while (true) {
            const size_t idx = next_idx.fetch_add(1, std::memory_order_relaxed);
            if (idx >= total) break;

            const auto& file_path = files[idx];
            const auto stem = file_path.stem().string();
            const auto rel_dir = fs::relative(file_path.parent_path(), in_base);
            const auto target_dir = out_base / rel_dir;

            // Lire le G4TX
            auto data = read_file(file_path);
            if (data.empty()) { fail_count.fetch_add(1); continue; }
            bytes_in.fetch_add(data.size());

            // Parser
            auto g4tx = level5::g4tx_parse(data);
            if (!g4tx || g4tx->textures.empty()) { fail_count.fetch_add(1); continue; }
            data.clear();

            const bool any_ok = write_g4tx_as_webp(
                *g4tx, stem, target_dir, quality, skip_existing,
                skip_count, textures_out, total_pixels, bytes_out);

            if (any_ok) ok_count.fetch_add(1);
            else fail_count.fetch_add(1);
        }
    };

    // 4. Lancer
    std::vector<std::thread> pool;
    pool.reserve(static_cast<size_t>(num_threads));
    for (int i = 0; i < num_threads; ++i) pool.emplace_back(worker);
    for (auto& t : pool) t.join();

    const auto t1 = std::chrono::high_resolution_clock::now();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    const double secs = static_cast<double>(ms) / 1000.0;
    const double fps = secs > 0 ? static_cast<double>(ok_count.load()) / secs : 0;

    emit(json{
        {"ok", true},
        {"mode", "g4tx"},
        {"totalG4tx", total},
        {"succeededG4tx", ok_count.load()},
        {"failedG4tx", fail_count.load()},
        {"skippedTextures", skip_count.load()},
        {"texturesExported", textures_out.load()},
        {"totalPixels", total_pixels.load()},
        {"bytesIn", bytes_in.load()},
        {"bytesOut", bytes_out.load()},
        {"compressionRatio", bytes_in.load() > 0 ? static_cast<double>(bytes_in.load()) / static_cast<double>(std::max(bytes_out.load(), uint64_t{1})) : 0},
        {"elapsedMs", ms},
        {"g4txPerSec", static_cast<int>(fps)},
        {"threads", num_threads},
        {"webpQuality", quality},
        {"outputDir", output_dir},
    });
}

// ── Mode 2 : Dossier de CPKs (ou .cpk unique) ──────────────────────

/// Tache plate : reference (reader_idx, entry_idx) dans le pool global.
struct CpkG4txTask {
    size_t reader_idx;
    size_t entry_idx;
    fs::path target_dir;  // pre-calcule (root menu strip)
    std::string g4tx_stem;
};

static void cmd_prepare_menu_from_cpks(const fs::path& input,
                                          const std::string& output_dir,
                                          int threads,
                                          int quality,
                                          bool skip_existing) {
    // 1. Lister les CPKs
    std::vector<fs::path> cpk_paths;
    cpk_paths.reserve(256);

    if (fs::is_regular_file(input) && input.extension() == ".cpk") {
        cpk_paths.push_back(input);
    } else if (fs::is_directory(input)) {
        for (const auto& e : fs::recursive_directory_iterator(input)) {
            if (e.is_regular_file() && e.path().extension() == ".cpk") {
                cpk_paths.push_back(e.path());
            }
        }
    }

    if (cpk_paths.empty()) {
        emit(json{{"ok", false}, {"error", "no cpk files found"}});
        return;
    }

    std::sort(cpk_paths.begin(), cpk_paths.end());
    const fs::path out_base(output_dir);
    fs::create_directories(out_base);

    const auto t0 = std::chrono::high_resolution_clock::now();

    int num_threads = threads > 0 ? threads
                                   : static_cast<int>(std::thread::hardware_concurrency());
    num_threads = std::max(1, num_threads);

    // 2. Ouvrir tous les CPKs en parallele
    std::vector<criware::CpkReader> readers(cpk_paths.size());
    std::vector<bool> reader_ok(cpk_paths.size(), false);

    {
        std::atomic<size_t> next_open{0};
        std::vector<std::jthread> open_pool;
        const int open_workers = std::min(num_threads, static_cast<int>(cpk_paths.size()));
        open_pool.reserve(static_cast<size_t>(open_workers));
        for (int i = 0; i < open_workers; ++i) {
            open_pool.emplace_back([&]() {
                while (true) {
                    const size_t idx = next_open.fetch_add(1, std::memory_order_relaxed);
                    if (idx >= cpk_paths.size()) break;
                    if (readers[idx].open(cpk_paths[idx])) {
                        reader_ok[idx] = true;
                    } else {
                        spdlog::warn("prepare-menu: echec ouverture CPK '{}'",
                                     cpk_paths[idx].string());
                    }
                }
            });
        }
    } // join

    // 3. Construire la queue plate de toutes les G4TX entries filtrees par chemin menu
    std::vector<CpkG4txTask> tasks;
    tasks.reserve(50000);

    std::atomic<size_t> g4tx_scanned{0};
    std::atomic<size_t> g4tx_skipped{0};
    std::atomic<size_t> dirs_to_create_count{0};

    // Pre-calcul des sous-dossiers a creer (deduplique)
    std::vector<fs::path> dirs_dedup;

    for (size_t ri = 0; ri < readers.size(); ++ri) {
        if (!reader_ok[ri]) continue;
        const auto& entries = readers[ri].list();
        for (size_t ei = 0; ei < entries.size(); ++ei) {
            const auto& entry = entries[ei];

            // Filtre extension
            std::string fname_lower;
            fname_lower.reserve(entry.filename.size());
            for (char c : entry.filename) {
                fname_lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
            }
            if (fname_lower.size() < 5 ||
                fname_lower.compare(fname_lower.size() - 5, 5, ".g4tx") != 0) {
                continue;
            }

            g4tx_scanned.fetch_add(1, std::memory_order_relaxed);

            // Filtre chemin : doit contenir 200_icon ou 220_img
            auto rel = menu_relative_path(entry.directory);
            if (!rel) {
                g4tx_skipped.fetch_add(1, std::memory_order_relaxed);
                continue;
            }

            const auto target_dir = out_base / *rel;
            // Stem du G4TX (filename sans .g4tx)
            const auto stem = fs::path(entry.filename).stem().string();

            // Collecte deduplication des dossiers
            if (std::find(dirs_dedup.begin(), dirs_dedup.end(), target_dir) == dirs_dedup.end()) {
                dirs_dedup.push_back(target_dir);
            }

            tasks.push_back(CpkG4txTask{
                .reader_idx = ri,
                .entry_idx = ei,
                .target_dir = target_dir,
                .g4tx_stem = stem,
            });
        }
    }

    dirs_to_create_count.store(dirs_dedup.size(), std::memory_order_relaxed);

    // Pre-creation des dossiers en parallele
    {
        std::atomic<size_t> next_dir{0};
        std::vector<std::jthread> dir_pool;
        const int dir_workers = std::max(1, std::min(num_threads,
                                                       static_cast<int>(dirs_dedup.size())));
        dir_pool.reserve(static_cast<size_t>(dir_workers));
        for (int i = 0; i < dir_workers; ++i) {
            dir_pool.emplace_back([&]() {
                while (true) {
                    const size_t idx = next_dir.fetch_add(1, std::memory_order_relaxed);
                    if (idx >= dirs_dedup.size()) break;
                    std::error_code ec;
                    fs::create_directories(dirs_dedup[idx], ec);
                }
            });
        }
    }
    dirs_dedup.clear();
    dirs_dedup.shrink_to_fit();

    const size_t total_tasks = tasks.size();

    // 4. Pool de workers consommant la queue plate
    std::atomic<size_t> next_idx{0};
    std::atomic<size_t> ok_count{0};
    std::atomic<size_t> fail_count{0};
    std::atomic<size_t> skip_count{0};
    std::atomic<uint64_t> total_pixels{0};
    std::atomic<uint64_t> bytes_in{0};
    std::atomic<uint64_t> bytes_out{0};
    std::atomic<size_t> textures_out{0};

    const int worker_count = std::max(1, std::min(num_threads, static_cast<int>(total_tasks)));

    auto worker = [&]() {
        while (true) {
            const size_t idx = next_idx.fetch_add(1, std::memory_order_relaxed);
            if (idx >= total_tasks) break;

            const auto& task = tasks[idx];
            const auto& reader = readers[task.reader_idx];
            const auto& entry = reader.list()[task.entry_idx];

            // Extraction streaming depuis le CPK (mmap, decrypt a la volee si chiffre)
            auto data = reader.extract(entry);
            if (data.empty()) {
                fail_count.fetch_add(1, std::memory_order_relaxed);
                continue;
            }
            bytes_in.fetch_add(data.size(), std::memory_order_relaxed);

            // Parser G4TX
            auto g4tx = level5::g4tx_parse(data);
            if (!g4tx || g4tx->textures.empty()) {
                fail_count.fetch_add(1, std::memory_order_relaxed);
                continue;
            }
            data.clear();
            data.shrink_to_fit();

            const bool any_ok = write_g4tx_as_webp(
                *g4tx, task.g4tx_stem, task.target_dir, quality, skip_existing,
                skip_count, textures_out, total_pixels, bytes_out);

            if (any_ok) ok_count.fetch_add(1, std::memory_order_relaxed);
            else fail_count.fetch_add(1, std::memory_order_relaxed);
        }
    };

    if (total_tasks > 0) {
        std::vector<std::jthread> pool;
        pool.reserve(static_cast<size_t>(worker_count));
        for (int i = 0; i < worker_count; ++i) pool.emplace_back(worker);
    } // join

    const auto t1 = std::chrono::high_resolution_clock::now();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    const double secs = static_cast<double>(ms) / 1000.0;
    const double fps = secs > 0 ? static_cast<double>(ok_count.load()) / secs : 0;

    size_t cpk_open_count = 0;
    for (bool ok : reader_ok) if (ok) ++cpk_open_count;

    emit(json{
        {"ok", true},
        {"mode", "cpk"},
        {"cpkCount", cpk_paths.size()},
        {"cpkOpened", cpk_open_count},
        {"g4txEntriesScanned", g4tx_scanned.load()},
        {"g4txEntriesSkipped", g4tx_skipped.load()},
        {"totalG4tx", total_tasks},
        {"succeededG4tx", ok_count.load()},
        {"failedG4tx", fail_count.load()},
        {"skippedTextures", skip_count.load()},
        {"texturesExported", textures_out.load()},
        {"totalPixels", total_pixels.load()},
        {"bytesIn", bytes_in.load()},
        {"bytesOut", bytes_out.load()},
        {"compressionRatio", bytes_in.load() > 0 ? static_cast<double>(bytes_in.load()) / static_cast<double>(std::max(bytes_out.load(), uint64_t{1})) : 0},
        {"elapsedMs", ms},
        {"g4txPerSec", static_cast<int>(fps)},
        {"threads", worker_count},
        {"webpQuality", quality},
        {"outputDir", output_dir},
    });
}

// ── Dispatch ────────────────────────────────────────────────────────

/// Detecte si l'input contient des CPKs (.cpk single ou repertoire avec .cpk).
static bool input_has_cpk(const fs::path& input) {
    if (fs::is_regular_file(input) && input.extension() == ".cpk") return true;
    if (fs::is_directory(input)) {
        for (const auto& e : fs::recursive_directory_iterator(input)) {
            if (e.is_regular_file() && e.path().extension() == ".cpk") return true;
        }
    }
    return false;
}

static void cmd_prepare_menu(const std::string& input_path,
                               const std::string& output_dir,
                               int threads,
                               int quality,
                               bool skip_existing) {
    const fs::path input(input_path);
    if (!fs::exists(input)) {
        emit(json{{"ok", false}, {"error", "input not found"}});
        return;
    }

    if (input_has_cpk(input)) {
        cmd_prepare_menu_from_cpks(input, output_dir, threads, quality, skip_existing);
    } else {
        cmd_prepare_menu_from_g4tx(input_path, output_dir, threads, quality, skip_existing);
    }
}

// ── Registration ────────────────────────────────────────────────────

void register_prepare_menu_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("prepare-menu",
        "Convert G4TX (or CPK contents) to WebP for Azalee Supabase bucket");

    static std::string input_path;
    static std::string output_dir;
    static int threads = 0;
    static int quality = 85;
    static bool skip = false;

    cmd->add_option("input", input_path,
                     "Input: dir of .g4tx, dir of .cpk, or single .cpk file")->required();
    cmd->add_option("-o,--output", output_dir, "Output: menu/200_icon/ or menu/220_img/")->required();
    cmd->add_option("-t,--threads", threads, "Thread count (0=auto)")->default_val(0);
    cmd->add_option("-q,--quality", quality, "WebP quality (1-100)")->default_val(85);
    cmd->add_flag("--skip", skip, "Skip existing WebP files");

    cmd->callback([]() {
        cmd_prepare_menu(input_path, output_dir, threads, quality, skip);
    });
}

} // namespace iecode::cli
