/// @file dump_service.cpp
/// Implementation du service d'extraction massive CPK.
///
/// Architecture optimisee (v2 — streaming decrypt + file-level parallelism) :
///   1. Charger/creer le manifest (.iecode-manifest.json) si smart_dump
///   2. Enumerer les CPK, trier par taille
///   3. Ouvrir TOUS les CPK (streaming : mmap + decrypt header/TOC seulement, ~0 cost)
///   4. Pre-creer TOUS les repertoires de sortie en un seul batch
///   5. Construire une work queue plate de TOUS les fichiers (253K entries)
///   6. Pool de N jthread workers consommant la queue (file-level, pas CPK-level)
///   7. Chaque worker : read_region (decrypt a la volee) + CRILAYLA decompress + write
///
/// Gains vs v1 :
///   - Plus de copie de 56 GB en RAM pour le dechiffrement
///   - Parallelisme au niveau fichier = meilleur load balancing
///   - Pre-creation des repertoires = moins d'appels OS repetes

#include "iecode/services/dump_service.h"

#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/vfs/vfs.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <fstream>
#ifdef _WIN32
#include <io.h>
#endif
#include <iomanip>
#include <sstream>
#include <thread>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::services {

// ── Constantes ─────────────────────────────────────────────────────────

static constexpr const char* MANIFEST_FILENAME = ".iecode-manifest.json";
static constexpr auto MANIFEST_SAVE_INTERVAL = std::chrono::seconds(300);

// ── Serialisation JSON du manifest ─────────────────────────────────────

static json file_info_to_json(const DumpService::ExtractedFileInfo& info) {
    return json{{"size", info.size}, {"cpk_name", info.cpk_name}};
}

static DumpService::ExtractedFileInfo file_info_from_json(const json& j) {
    DumpService::ExtractedFileInfo info;
    if (j.contains("size")) info.size = j["size"].get<int64_t>();
    if (j.contains("cpk_name")) info.cpk_name = j["cpk_name"].get<std::string>();
    return info;
}

static json manifest_to_json(const DumpService::Manifest& m) {
    json j;
    j["game_path"] = m.game_path;
    j["created_at"] = m.created_at;
    j["last_updated"] = m.last_updated;

    j["completed_cpks"] = json::array();
    for (const auto& cpk : m.completed_cpks) {
        j["completed_cpks"].push_back(cpk);
    }

    j["extracted_files"] = json::object();
    for (const auto& [path, info] : m.extracted_files) {
        j["extracted_files"][path] = file_info_to_json(info);
    }

    return j;
}

static DumpService::Manifest manifest_from_json(const json& j) {
    DumpService::Manifest m;
    if (j.contains("game_path")) m.game_path = j["game_path"].get<std::string>();
    if (j.contains("created_at")) m.created_at = j["created_at"].get<std::string>();
    if (j.contains("last_updated")) m.last_updated = j["last_updated"].get<std::string>();

    if (j.contains("completed_cpks") && j["completed_cpks"].is_array()) {
        for (const auto& cpk : j["completed_cpks"]) {
            m.completed_cpks.insert(cpk.get<std::string>());
        }
    }

    if (j.contains("extracted_files") && j["extracted_files"].is_object()) {
        for (const auto& [key, val] : j["extracted_files"].items()) {
            m.extracted_files[key] = file_info_from_json(val);
        }
    }

    return m;
}

// ── Helpers ────────────────────────────────────────────────────────────

/// Matching glob simple (supporte * et ?).
static bool glob_match(std::string_view pattern, std::string_view text) {
    size_t pi = 0;
    size_t ti = 0;
    size_t star_pi = std::string_view::npos;
    size_t star_ti = 0;

    while (ti < text.size()) {
        if (pi < pattern.size() && (pattern[pi] == '?' || pattern[pi] == text[ti])) {
            ++pi;
            ++ti;
        } else if (pi < pattern.size() && pattern[pi] == '*') {
            star_pi = pi;
            star_ti = ti;
            ++pi;
        } else if (star_pi != std::string_view::npos) {
            pi = star_pi + 1;
            ++star_ti;
            ti = star_ti;
        } else {
            return false;
        }
    }

    while (pi < pattern.size() && pattern[pi] == '*') ++pi;
    return pi == pattern.size();
}

/// Normalise un chemin pour le manifest (forward slashes, lowercase).
static std::string normalize_path(const std::string& path) {
    std::string result = path;
    for (auto& ch : result) {
        if (ch == '\\') ch = '/';
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return result;
}

// ── Constructeur ───────────────────────────────────────────────────────

DumpService::DumpService(fs::path game_path)
    : game_path_(std::move(game_path))
    , data_path_(game_path_ / "data")
    , packs_path_(game_path_ / "data" / "packs") {}

// ── Timestamp ISO 8601 ────────────────────────────────────────────────

std::string DumpService::now_iso8601() {
    const auto now = std::chrono::system_clock::now();
    const auto time_t = std::chrono::system_clock::to_time_t(now);
    std::tm tm_buf{};
#ifdef _WIN32
    gmtime_s(&tm_buf, &time_t);
#else
    gmtime_r(&time_t, &tm_buf);
#endif
    std::ostringstream oss;
    oss << std::put_time(&tm_buf, "%Y-%m-%dT%H:%M:%SZ");
    return oss.str();
}

// ── Manifest I/O ──────────────────────────────────────────────────────

bool DumpService::load_manifest(const fs::path& output_dir, Manifest& manifest) const {
    const auto path = output_dir / MANIFEST_FILENAME;
    std::error_code ec;
    if (!fs::exists(path, ec)) return false;

    std::ifstream file(path);
    if (!file) return false;

    try {
        json j = json::parse(file);
        manifest = manifest_from_json(j);
        return true;
    } catch (const json::exception& e) {
        (void)e;
        return false;
    }
}

bool DumpService::save_manifest(const fs::path& output_dir, const Manifest& manifest) const {
    const auto path = output_dir / MANIFEST_FILENAME;
    std::error_code ec;
    fs::create_directories(output_dir, ec);
    if (ec) return false;

    const auto tmp_path = output_dir / ".iecode-manifest.tmp";
    {
        std::ofstream file(tmp_path, std::ios::trunc);
        if (!file) return false;
        file << manifest_to_json(manifest).dump(2);
        if (!file.good()) return false;
    }

    fs::rename(tmp_path, path, ec);
    return !ec;
}

// ── Build plan ────────────────────────────────────────────────────────

std::vector<DumpService::CpkPlan> DumpService::build_plan(
    const fs::path& packs_dir,
    const Manifest& manifest) const {
    std::vector<CpkPlan> plans;
    std::error_code ec;

    if (!fs::exists(packs_dir, ec) || !fs::is_directory(packs_dir, ec)) {
        return plans;
    }

    for (const auto& entry : fs::recursive_directory_iterator(packs_dir, ec)) {
        if (!entry.is_regular_file()) continue;

        auto ext = entry.path().extension().string();
        for (auto& ch : ext) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        if (ext != ".cpk") continue;

        const std::string name = entry.path().filename().string();

        // Skip les CPK deja completes
        if (manifest.completed_cpks.count(name) > 0) continue;

        const auto size = static_cast<int64_t>(fs::file_size(entry.path(), ec));
        if (ec) continue;

        plans.push_back(CpkPlan{
            .path = entry.path(),
            .name = name,
            .size = size,
        });
    }

    // Trier par taille croissante — petits CPK d'abord pour feedback rapide
    std::sort(plans.begin(), plans.end(), [](const CpkPlan& a, const CpkPlan& b) {
        return a.size < b.size;
    });

    return plans;
}

// ── Extraction d'un CPK (garde pour compatibilite, utilise streaming) ──

void DumpService::extract_cpk(const fs::path& cpk_path,
                               const fs::path& output_path,
                               const std::string& file_filter,
                               bool is_resume,
                               std::atomic<int>& files_out,
                               std::atomic<int64_t>& bytes_out,
                               std::mutex& manifest_mutex,
                               Manifest& manifest,
                               std::vector<std::string>& errors,
                               std::mutex& errors_mutex) const {
    const std::string cpk_name = cpk_path.filename().string();

    criware::CpkReader reader;
    if (!reader.open(cpk_path)) {
        std::lock_guard lock(errors_mutex);
        errors.push_back(fmt::format("{}: impossible d'ouvrir", cpk_name));
        return;
    }

    const auto& entries = reader.list();

    // Batch local
    std::vector<std::pair<std::string, ExtractedFileInfo>> batch;
    batch.reserve(entries.size());

    std::unordered_set<std::string> created_dirs;

    // En mode resume, snapshot des fichiers deja extraits
    std::unordered_set<std::string> already_extracted;
    if (is_resume) {
        std::lock_guard lock(manifest_mutex);
        already_extracted.reserve(manifest.extracted_files.size());
        for (const auto& [k, _] : manifest.extracted_files) {
            already_extracted.insert(k);
        }
    }

    int local_files = 0;
    int64_t local_bytes = 0;
    std::vector<std::string> local_errors;

    for (const auto& entry : entries) {
        if (!file_filter.empty() && !glob_match(file_filter, entry.filename)) {
            continue;
        }

        fs::path out_path = output_path;
        if (!entry.directory.empty()) {
            out_path /= entry.directory;
        }
        out_path /= entry.filename;

        std::string rel_path;
        if (!entry.directory.empty()) {
            rel_path = entry.directory + "/" + entry.filename;
        } else {
            rel_path = entry.filename;
        }
        const auto normalized = normalize_path(rel_path);

        if (is_resume && already_extracted.count(normalized) > 0) {
            std::error_code ec;
            if (fs::exists(out_path, ec)) {
                continue;
            }
        }

        const auto parent = out_path.parent_path().string();
        if (created_dirs.find(parent) == created_dirs.end()) {
            std::error_code ec;
            fs::create_directories(out_path.parent_path(), ec);
            if (ec) {
                local_errors.push_back(fmt::format("{}: impossible de creer le dossier pour '{}'",
                                                    cpk_name, entry.filename));
                continue;
            }
            created_dirs.insert(parent);
        }

        // Extraction via streaming decrypt (read_region dans CpkReader)
        auto data = reader.extract(entry);
        if (data.empty() && entry.size > 0) {
            local_errors.push_back(fmt::format("{}: echec extraction '{}'",
                                                cpk_name, entry.filename));
            continue;
        }

        std::ofstream out(out_path, std::ios::binary);
        if (!out) {
            local_errors.push_back(fmt::format("{}: impossible d'ecrire '{}'",
                                                cpk_name, out_path.string()));
            continue;
        }
        out.write(reinterpret_cast<const char*>(data.data()),
                  static_cast<std::streamsize>(data.size()));

        if (!out.good()) {
            local_errors.push_back(fmt::format("{}: erreur ecriture '{}'",
                                                cpk_name, out_path.string()));
            continue;
        }

        const auto written_size = static_cast<int64_t>(data.size());
        ++local_files;
        local_bytes += written_size;

        batch.emplace_back(normalized, ExtractedFileInfo{
            .size = written_size,
            .cpk_name = cpk_name,
        });
    }

    files_out.fetch_add(local_files, std::memory_order_relaxed);
    bytes_out.fetch_add(local_bytes, std::memory_order_relaxed);

    {
        std::lock_guard lock(manifest_mutex);
        for (auto& [key, info] : batch) {
            manifest.extracted_files[std::move(key)] = std::move(info);
        }
        manifest.completed_cpks.insert(cpk_name);
    }

    if (!local_errors.empty()) {
        std::lock_guard lock(errors_mutex);
        errors.insert(errors.end(),
                      std::make_move_iterator(local_errors.begin()),
                      std::make_move_iterator(local_errors.end()));
    }

}

// ── Copie des loose files ─────────────────────────────────────────────

void DumpService::copy_loose_files(const DumpOptions& opts,
                                    const Manifest& /*manifest*/,
                                    DumpResult& result) const {
    std::error_code ec;
    if (!fs::exists(data_path_, ec)) return;

    static constexpr std::array<const char*, 2> LOOSE_EXTENSIONS = {".cfg.bin", ".ini"};

    for (const auto& entry : fs::recursive_directory_iterator(data_path_, ec)) {
        if (!entry.is_regular_file()) continue;

        const auto entry_str = entry.path().string();
        auto lower_path = normalize_path(entry_str);
        if (lower_path.find("/packs/") != std::string::npos ||
            lower_path.find("\\packs\\") != std::string::npos) {
            continue;
        }

        const auto filename = entry.path().filename().string();
        bool matches = false;
        for (const auto* ext : LOOSE_EXTENSIONS) {
            if (filename.size() >= std::strlen(ext) &&
                filename.compare(filename.size() - std::strlen(ext),
                                 std::strlen(ext), ext) == 0) {
                matches = true;
                break;
            }
        }
        if (!matches) continue;

        const auto rel = fs::relative(entry.path(), data_path_, ec);
        if (ec) continue;
        const auto out_path = opts.output_path / rel;

        if (opts.smart_dump && fs::exists(out_path, ec)) continue;

        fs::create_directories(out_path.parent_path(), ec);
        if (ec) continue;

        fs::copy_file(entry.path(), out_path, fs::copy_options::overwrite_existing, ec);
        if (!ec) {
            ++result.loose_files_copied;
        }
    }
}

// ── Dump principal (v2 — streaming decrypt + file-level parallelism) ──

DumpResult DumpService::dump(const DumpOptions& options) const {
    std::atomic<bool> no_cancel{false};
    return dump(options, no_cancel);
}

DumpResult DumpService::dump(const DumpOptions& options,
                              std::atomic<bool>& cancel_flag) const {
    DumpResult result;
    result.output_path = options.output_path;

    const auto start = std::chrono::steady_clock::now();

    // ── 1. Charger ou creer le manifest ──────────────────────────────
    if (options.on_progress) {
        options.on_progress(DumpProgress{
            .phase = DumpPhase::LOADING,
            .message = "Chargement du manifest...",
        });
    }

    Manifest manifest;
    if (options.smart_dump && load_manifest(options.output_path, manifest)) {
        result.is_resume = !manifest.extracted_files.empty();
    } else {
        manifest.game_path = game_path_.string();
        manifest.created_at = now_iso8601();
    }

    // ── 2. Construire le plan d'extraction ───────────────────────────
    if (cancel_flag.load(std::memory_order_relaxed)) {
        result.was_cancelled = true;
        return result;
    }

    if (options.on_progress) {
        options.on_progress(DumpProgress{
            .phase = DumpPhase::PLANNING,
            .message = "Construction du plan d'extraction...",
        });
    }

    const auto& packs_dir = options.packs_path.value_or(packs_path_);

    std::vector<CpkPlan> plan;
    {
        bool vfs_ok = false;
        vfs::Vfs vfs_index;

        if (options.use_vfs) {
            // Chemin du JSON pre-genere
            const auto json_index_path = data_path_ / "cpk_index.json";
            bool json_loaded = false;

            std::error_code ec_json;
            if (fs::exists(json_index_path, ec_json)) {
                std::ifstream jf(json_index_path);
                if (jf) {
                    try {
                        json idx = json::parse(jf);
                        if (idx.value("v", 0) == 1 && idx.contains("cpks")) {
                            for (auto& [cpk_name, files] : idx["cpks"].items()) {
                                if (manifest.completed_cpks.count(cpk_name)) continue;
                                const auto cpk_path = packs_dir / cpk_name;
                                std::error_code ec2;
                                if (!fs::exists(cpk_path, ec2)) continue;

                                int64_t total = 0;
                                for (const auto& fe : files) {
                                    if (!options.file_filter.empty()) {
                                        const auto& fpath = fe["p"].get_ref<const std::string&>();
                                        const auto slash = fpath.rfind('/');
                                        const auto fname = (slash != std::string::npos)
                                            ? std::string_view(fpath).substr(slash + 1)
                                            : std::string_view(fpath);
                                        if (!glob_match(options.file_filter, fname)) continue;
                                    }
                                    total += static_cast<int64_t>(fe["s"].get<uint32_t>());
                                }
                                if (!options.file_filter.empty() && total == 0) continue;

                                plan.push_back(CpkPlan{
                                    .path = cpk_path,
                                    .name = cpk_name,
                                    .size = total,
                                });
                            }
                            std::sort(plan.begin(), plan.end(),
                                      [](const CpkPlan& a, const CpkPlan& b) { return a.size < b.size; });
                            json_loaded = true;
                        }
                    } catch (const json::exception&) {
                        // JSON corrompu — fallback
                    }
                }
            }

            if (!json_loaded) {
                std::error_code ec;
                if (fs::exists(data_path_ / "cpk_list.cfg.bin", ec)) {
                    vfs_ok = vfs_index.init(data_path_);
                }
            }
        }

        if (vfs_ok) {
            // Grouper les entrees VFS par CPK — filter-aware
            // Si filtre, seuls les CPKs contenant des fichiers matchants sont ouverts
            const std::string glob = options.file_filter.empty() ? "*" : options.file_filter;
            auto vfs_entries = vfs_index.list(glob);

            std::unordered_map<std::string, int64_t> cpk_totals;
            for (const auto& e : vfs_entries) {
                cpk_totals[e.cpk_filename] += static_cast<int64_t>(e.file_size);
            }

            for (const auto& [cpk_name, total_size] : cpk_totals) {
                if (manifest.completed_cpks.count(cpk_name)) continue;
                std::error_code ec;
                const auto cpk_path = packs_dir / cpk_name;
                if (!fs::exists(cpk_path, ec)) continue;
                plan.push_back(CpkPlan{
                    .path = cpk_path,
                    .name = cpk_name,
                    .size = total_size,
                });
            }

            std::sort(plan.begin(), plan.end(),
                      [](const CpkPlan& a, const CpkPlan& b) { return a.size < b.size; });
        } else if (plan.empty()) {
            plan = build_plan(packs_dir, manifest);
        }
    }

    result.total_cpks = static_cast<int>(plan.size());
    result.skipped_files = static_cast<int>(manifest.extracted_files.size());

    int64_t total_plan_bytes = 0;
    for (const auto& cpk : plan) {
        total_plan_bytes += cpk.size;
    }

    if (options.on_progress) {
        options.on_progress(DumpProgress{
            .phase = DumpPhase::PLANNING,
            .message = fmt::format("Plan: {} CPK a extraire ({:.1f} GB, {} deja completes)",
                                   plan.size(),
                                   static_cast<double>(total_plan_bytes) / (1024.0 * 1024.0 * 1024.0),
                                   manifest.completed_cpks.size()),
            .total_cpks = static_cast<int>(plan.size()),
            .total_bytes = total_plan_bytes,
        });
    }

    if (plan.empty()) {
    }

    // ── 3. Ouvrir TOUS les CPK en parallele (streaming mmap) ──────────
    //
    // Chaque open() ne dechiffre que header+TOC (~quelques KB).
    // Parallelise car 921 mmaps + TOC parses = ~10s sequentiel → ~1-2s.

    // Auto-detect workers
    const int hw_threads = static_cast<int>(std::thread::hardware_concurrency());
    const int requested = (options.max_parallelism > 0)
        ? options.max_parallelism
        : std::max(8, hw_threads * 2);

    if (options.on_progress) {
        options.on_progress(DumpProgress{
            .phase = DumpPhase::PLANNING,
            .message = fmt::format("Ouverture de {} CPK ({} threads)...", plan.size(), requested),
        });
    }

    struct OpenedCpk {
        criware::CpkReader reader;
        std::string name;
        bool valid = false;
    };

    // Pre-allouer le vecteur — chaque index ecrit par un seul thread
    std::vector<OpenedCpk> all_cpks(plan.size());

    {
        std::atomic<size_t> next_open{0};
        const int open_workers = std::max(1, std::min(requested, static_cast<int>(plan.size())));
        std::vector<std::jthread> pool;
        pool.reserve(static_cast<size_t>(open_workers));

        for (int i = 0; i < open_workers; ++i) {
            pool.emplace_back([&]() {
                while (!cancel_flag.load(std::memory_order_relaxed)) {
                    const size_t idx = next_open.fetch_add(1, std::memory_order_relaxed);
                    if (idx >= plan.size()) break;
                    all_cpks[idx].name = plan[idx].name;
                    all_cpks[idx].valid = all_cpks[idx].reader.open(plan[idx].path);
                }
            });
        }
    }

    // Compacter : ne garder que les CPK valides
    std::vector<OpenedCpk> readers;
    readers.reserve(plan.size());
    for (auto& cpk : all_cpks) {
        if (cpk.valid) {
            readers.push_back(std::move(cpk));
        }
    }
    all_cpks.clear(); // Liberer la memoire


    // ── 4. Construire la work queue plate + pre-creer les repertoires ──
    //
    // Au lieu de paralleliser par CPK (un gros CPK bloque un thread),
    // on construit une queue plate de tous les fichiers individuels.
    // Cela permet un load balancing optimal : chaque thread prend le
    // prochain fichier disponible.

    // ── Priorite d'extraction par type de contenu ──────────────────────
    static auto task_priority = [](std::string_view path) noexcept -> uint8_t {
        if (path.find("gamedata") != std::string_view::npos ||
            path.find("/script/") != std::string_view::npos ||
            path.find("/text/")   != std::string_view::npos)
            return 0;
        if (path.find("dx11/")    != std::string_view::npos ||
            path.find("/movie/")  != std::string_view::npos ||
            path.find("/sound")   != std::string_view::npos)
            return 2;
        return 1;
    };

    struct FileTask {
        size_t reader_idx;           // Index dans readers[]
        size_t entry_idx;            // Index dans reader.list()
        int64_t file_size = 0;       // Taille non-compressee (pour split heavy/light)
        uint8_t priority = 1;        // 0=gamedata/scripts, 1=default, 2=dx11/textures/audio
    };

    std::vector<FileTask> tasks;
    tasks.reserve(250000); // Pre-allouer pour les ~250K fichiers du jeu

    // Ensemble de repertoires a creer (dedupliques)
    std::unordered_set<std::string> dirs_to_create;

    // Snapshot des fichiers deja extraits pour le skip (sans mutex pendant la boucle)
    std::unordered_set<std::string> already_extracted;
    if (result.is_resume) {
        already_extracted.reserve(manifest.extracted_files.size());
        for (const auto& [k, _] : manifest.extracted_files) {
            already_extracted.insert(k);
        }
    }

    for (size_t ri = 0; ri < readers.size(); ++ri) {
        const auto& entries = readers[ri].reader.list();

        for (size_t ei = 0; ei < entries.size(); ++ei) {
            const auto& entry = entries[ei];

            // Filtre glob
            if (!options.file_filter.empty() &&
                !glob_match(options.file_filter, entry.filename)) {
                continue;
            }

            // Chemin de sortie
            fs::path out_path = options.output_path;
            if (!entry.directory.empty()) {
                out_path /= entry.directory;
            }
            out_path /= entry.filename;

            // Cle normalisee pour le manifest
            std::string rel_path;
            if (!entry.directory.empty()) {
                rel_path = entry.directory + "/" + entry.filename;
            } else {
                rel_path = entry.filename;
            }
            auto normalized = normalize_path(rel_path);

            // Smart skip (pas de mutex ici — snapshot)
            if (result.is_resume && already_extracted.count(normalized) > 0) {
                std::error_code ec;
                if (fs::exists(out_path, ec)) {
                    continue;
                }
            }

            // Collecter le repertoire parent
            dirs_to_create.insert(out_path.parent_path().string());

            const auto file_size = static_cast<int64_t>(entry.size);
            tasks.push_back(FileTask{
                .reader_idx = ri,
                .entry_idx  = ei,
                .file_size  = file_size,
                .priority   = options.priority_mode ? task_priority(rel_path) : uint8_t{1},
            });
        }
    }

    result.total_files = static_cast<int>(tasks.size());


    // Pre-creer tous les repertoires en parallele
    {
        std::vector<std::string> dir_list(dirs_to_create.begin(), dirs_to_create.end());
        dirs_to_create.clear(); // Liberer memoire

        std::atomic<size_t> next_dir{0};
        const int dir_workers = std::max(1, std::min(requested, static_cast<int>(dir_list.size())));
        std::vector<std::jthread> pool;
        pool.reserve(static_cast<size_t>(dir_workers));

        for (int i = 0; i < dir_workers; ++i) {
            pool.emplace_back([&]() {
                while (true) {
                    const size_t idx = next_dir.fetch_add(1, std::memory_order_relaxed);
                    if (idx >= dir_list.size()) break;
                    std::error_code ec;
                    fs::create_directories(fs::path(dir_list[idx]), ec);
                }
            });
        }
    }

    // ── 5. Split heavy / light + tri par priorite ───────────────────
    std::vector<FileTask> light_tasks, heavy_tasks;
    light_tasks.reserve(tasks.size());
    heavy_tasks.reserve(tasks.size() / 8);

    for (auto& t : tasks) {
        if (t.file_size >= options.large_file_threshold)
            heavy_tasks.push_back(t);
        else
            light_tasks.push_back(t);
    }
    tasks.clear();
    tasks.shrink_to_fit(); // Liberer memoire

    // LPT sur heavy : gros fichiers en tete pour equilibrer les workers
    std::sort(heavy_tasks.begin(), heavy_tasks.end(),
              [](const FileTask& a, const FileTask& b) {
                  return a.file_size > b.file_size;
              });

    // Priority sort sur light si demande
    if (options.priority_mode) {
        std::stable_sort(light_tasks.begin(), light_tasks.end(),
                         [](const FileTask& a, const FileTask& b) {
                             return a.priority < b.priority;
                         });
    }

    const size_t total_task_count = light_tasks.size() + heavy_tasks.size();

    // ── 6. Extraction parallele (deux pools heavy/light + FILE*) ────

    std::atomic<int> extracted_files{0};
    std::atomic<int64_t> extracted_bytes{0};
    std::atomic<size_t> next_light{0};
    std::atomic<size_t> next_heavy{0};
    std::mutex manifest_mutex;
    std::vector<std::string> errors;
    std::mutex errors_mutex;

    auto last_save_time = std::chrono::steady_clock::now();
    std::mutex save_time_mutex;

    const int num_workers = std::max(1, std::min(requested, static_cast<int>(total_task_count)));

    static constexpr size_t MANIFEST_BATCH_SIZE = 1024;

    // Progression : toutes les 5000 fichiers
    static constexpr size_t PROGRESS_INTERVAL = 5000;

    auto make_worker = [&](bool is_heavy) {
        return [&, is_heavy]() {
            auto& queue    = is_heavy ? heavy_tasks : light_tasks;
            auto& next_idx = is_heavy ? next_heavy  : next_light;

            std::vector<std::pair<std::string, ExtractedFileInfo>> local_batch;
            local_batch.reserve(MANIFEST_BATCH_SIZE);
            std::vector<std::string> local_errors;

            auto flush_batch = [&]() {
                if (local_batch.empty()) return;
                {
                    std::lock_guard lock(manifest_mutex);
                    for (auto& [key, info] : local_batch) {
                        manifest.extracted_files[std::move(key)] = std::move(info);
                    }
                }
                local_batch.clear();

                // Sauvegarde periodique
                {
                    std::lock_guard lock(save_time_mutex);
                    const auto now = std::chrono::steady_clock::now();
                    if (now - last_save_time > MANIFEST_SAVE_INTERVAL) {
                        last_save_time = now;
                        Manifest copy;
                        {
                            std::lock_guard mlock(manifest_mutex);
                            copy = manifest;
                        }
                        copy.last_updated = now_iso8601();
                        (void)save_manifest(options.output_path, copy);
                    }
                }
            };

            while (!cancel_flag.load(std::memory_order_relaxed)) {
                const size_t idx = next_idx.fetch_add(1, std::memory_order_relaxed);
                if (idx >= queue.size()) break;

                const auto& task = queue[idx];
                const auto& reader = readers[task.reader_idx].reader;
                const auto& cpk_name = readers[task.reader_idx].name;
                const auto& entry = reader.list()[task.entry_idx];

                // Reconstruire les chemins a la volee (economise ~46 MB RAM)
                fs::path out_path = options.output_path;
                if (!entry.directory.empty()) out_path /= entry.directory;
                out_path /= entry.filename;

                std::string rel;
                if (!entry.directory.empty()) rel = entry.directory + "/" + entry.filename;
                else rel = entry.filename;
                const auto normalized = normalize_path(rel);

                // Extraction : streaming decrypt a la volee
                auto data = reader.extract(entry);

                if (data.empty() && entry.size > 0) {
                    local_errors.push_back(fmt::format("{}: {}", cpk_name, entry.filename));
                    continue;
                }

                // Ecriture via FILE* (2-3x plus rapide que ofstream pour petits fichiers)
#ifdef _WIN32
                FILE* f = nullptr;
                _wfopen_s(&f, out_path.wstring().c_str(), L"wb");
#else
                FILE* f = std::fopen(out_path.string().c_str(), "wb");
#endif
                if (!f) {
                    local_errors.push_back(fmt::format("write: {}", out_path.string()));
                    continue;
                }

                // Buffer thread-local 2 MB pour reduire les syscalls sur gros fichiers
                if (entry.size > 4096) {
                    static thread_local char tls_write_buf[2 * 1024 * 1024];
                    setvbuf(f, tls_write_buf, _IOFBF, sizeof(tls_write_buf));
                }

                // Pre-allouer pour eviter la fragmentation FS sur gros fichiers
                if (is_heavy && entry.size > 0) {
#ifdef _WIN32
                    _chsize_s(_fileno(f), static_cast<long long>(entry.size));
                    rewind(f);
#endif
                }

                bool write_ok = true;
                if (!data.empty()) {
                    write_ok = (std::fwrite(data.data(), 1, data.size(), f) == data.size());
                }
                std::fclose(f);

                if (!write_ok) {
                    local_errors.push_back(fmt::format("fwrite: {}", out_path.string()));
                    continue;
                }

                const auto written = static_cast<int64_t>(data.size());
                extracted_files.fetch_add(1, std::memory_order_relaxed);
                extracted_bytes.fetch_add(written, std::memory_order_relaxed);

                local_batch.emplace_back(normalized, ExtractedFileInfo{
                    .size = written,
                    .cpk_name = cpk_name,
                });

                if (local_batch.size() >= MANIFEST_BATCH_SIZE) {
                    flush_batch();
                }

                // Progression
                if (options.on_progress && (idx % PROGRESS_INTERVAL == 0)) {
                    const auto elapsed_s = std::chrono::duration<double>(
                        std::chrono::steady_clock::now() - start).count();
                    const auto cur_bytes = extracted_bytes.load(std::memory_order_relaxed);
                    const auto cur_files = extracted_files.load(std::memory_order_relaxed);
                    const auto mb_s = elapsed_s > 0.0
                        ? static_cast<double>(cur_bytes) / (1024.0 * 1024.0 * elapsed_s) : 0.0;

                    options.on_progress(DumpProgress{
                        .phase = DumpPhase::EXTRACTING,
                        .message = fmt::format("[{}/{}] {:.0f} MB/s",
                                               cur_files, total_task_count, mb_s),
                        .extracted_files = cur_files,
                        .total_files = static_cast<int>(total_task_count),
                        .extracted_bytes = cur_bytes,
                        .total_bytes = total_plan_bytes,
                        .bytes_per_second = elapsed_s > 0.0
                            ? static_cast<double>(cur_bytes) / elapsed_s : 0.0,
                    });
                }
            }

            flush_batch();

            if (!local_errors.empty()) {
                std::lock_guard lock(errors_mutex);
                errors.insert(errors.end(),
                              std::make_move_iterator(local_errors.begin()),
                              std::make_move_iterator(local_errors.end()));
            }
        };
    };

    // Les deux pools tournent en parallele — heavy et light concurrents
    const int light_workers = std::max(1, std::min(num_workers, static_cast<int>(light_tasks.size())));
    const int heavy_workers = std::max(1, std::min(num_workers, static_cast<int>(heavy_tasks.size())));

    std::vector<std::jthread> light_pool, heavy_pool;

    if (!light_tasks.empty()) {
        light_pool.reserve(static_cast<size_t>(light_workers));
        for (int i = 0; i < light_workers; ++i)
            light_pool.emplace_back(make_worker(false));
    }
    if (!heavy_tasks.empty()) {
        heavy_pool.reserve(static_cast<size_t>(heavy_workers));
        for (int i = 0; i < heavy_workers; ++i)
            heavy_pool.emplace_back(make_worker(true));
    }

    // Attendre les deux pools
    light_pool.clear();
    heavy_pool.clear();

    // Marquer tous les CPK comme completes dans le manifest
    {
        std::lock_guard lock(manifest_mutex);
        for (const auto& opened : readers) {
            manifest.completed_cpks.insert(opened.name);
        }
    }

    // ── 6. Copier les loose files ────────────────────────────────────
    if (!cancel_flag.load(std::memory_order_relaxed) && options.include_loose_files) {
        if (options.on_progress) {
            options.on_progress(DumpProgress{
                .phase = DumpPhase::COPYING_LOOSE,
                .message = "Copie des fichiers loose...",
            });
        }
        copy_loose_files(options, manifest, result);
    }

    // ── 7. Sauvegarder le manifest final ─────────────────────────────
    manifest.last_updated = now_iso8601();
    (void)save_manifest(options.output_path, manifest);

    // ── 8. Assembler le resultat ─────────────────────────────────────
    const auto elapsed = std::chrono::steady_clock::now() - start;
    result.duration_seconds = std::chrono::duration<double>(elapsed).count();
    result.extracted_files = extracted_files.load();
    result.extracted_bytes = extracted_bytes.load();
    result.errors = std::move(errors);

    if (cancel_flag.load(std::memory_order_relaxed)) {
        result.was_cancelled = true;
        if (options.on_progress) {
            options.on_progress(DumpProgress{
                .phase = DumpPhase::CANCELLED,
                .message = "Dump annule par l'utilisateur",
            });
        }
    } else if (result.errors.empty()) {
        result.success = true;
        if (options.on_progress) {
            options.on_progress(DumpProgress{
                .phase = DumpPhase::COMPLETED,
                .message = fmt::format("Dump termine : {} fichiers, {:.1f} GB en {:.1f}s ({:.0f} MB/s)",
                                       result.extracted_files,
                                       static_cast<double>(result.extracted_bytes) / (1024.0 * 1024.0 * 1024.0),
                                       result.duration_seconds,
                                       result.duration_seconds > 0.0
                                           ? static_cast<double>(result.extracted_bytes) / (1024.0 * 1024.0 * result.duration_seconds)
                                           : 0.0),
                .extracted_files = result.extracted_files,
                .extracted_bytes = result.extracted_bytes,
            });
        }
    } else {
        result.success = true;
        if (options.on_progress) {
            options.on_progress(DumpProgress{
                .phase = DumpPhase::COMPLETED,
                .message = fmt::format("Dump termine avec {} erreurs ({} fichiers extraits)",
                                       result.errors.size(), result.extracted_files),
                .extracted_files = result.extracted_files,
                .extracted_bytes = result.extracted_bytes,
            });
        }
    }

    return result;
}

} // namespace iecode::services
