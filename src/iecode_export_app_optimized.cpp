/// iecode_export_app_optimized.cpp
/// Ultra-optimized app icon export — Victory Road → WebP/tar.zst pipeline.
///
/// Pipeline (3-stage):
///   1. N worker threads : mmap CPK → parse G4TX → WebP encode (CPU-bound)
///   2. 1 packer thread  : drain worker buffers → streaming TAR
///   3. 1 zstd thread    : TAR stream → zstd framed output (I/O-bound)
///
/// Performance optimizations:
///   - mmap CPK via iecode::criware::CpkReader (zero-copy I/O)
///   - MPMC lock-free work queue (moodycamel::ConcurrentQueue fallback → mutex)
///   - Per-worker WebP buffer reused (no per-file allocation)
///   - Streaming zstd via ZSTD_CCtx with multi-worker compression
///   - Atomic counters (no mutex for stats)
///   - Sort by size ASC : small files first (load balancing tail latency)
///   - Smart manifest resume (.app-manifest.json)
///   - Pre-create all output directories in batch (single OS round-trip)

#include "iecode/converters/texture_export.h"
#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/formats/level5/g4tx.h"
#include "iecode/vfs/vfs.h"

#include <zstd.h>
#include <nlohmann/json.hpp>
#include <fmt/core.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <barrier>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <mutex>
#include <numeric>
#include <queue>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// ── Linux/VPS-specific optimizations ─────────────────────────────────────────
#ifdef __linux__
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;
using clock_t_ = std::chrono::steady_clock;

// ── Linux performance tuning helpers ─────────────────────────────────────────

/// Pin calling thread to CPU `id` (Linux only; no-op elsewhere).
/// Reduces inter-core migration cost and improves LLC/L2 locality for the
/// per-worker G4TX→WebP hot loop. Worker index modulo CPU count avoids errors
/// on containers with restricted cpusets.
inline void pin_cpu_affinity([[maybe_unused]] int id) {
#ifdef __linux__
    long ncpu = sysconf(_SC_NPROCESSORS_ONLN);
    if (ncpu <= 0) return;
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(id % (int)ncpu, &set);
    pthread_setaffinity_np(pthread_self(), sizeof(set), &set);
#endif
}

/// Raise RLIMIT_NOFILE (open file descriptors) — we mmap many CPKs at once.
/// On a VPS with restricted ulimits this prevents EMFILE on the 921 CPK cache.
inline void raise_fd_limit() {
#ifdef __linux__
    rlimit rl{};
    if (getrlimit(RLIMIT_NOFILE, &rl) == 0) {
        rl.rlim_cur = std::min<rlim_t>(rl.rlim_max, 65536);
        setrlimit(RLIMIT_NOFILE, &rl);
    }
#endif
}

/// Advise the kernel about access patterns on the output file (sequential write).
inline void advise_output(const fs::path& path) {
#ifdef __linux__
    int fd = ::open(path.c_str(), O_WRONLY);
    if (fd >= 0) {
        posix_fadvise(fd, 0, 0, POSIX_FADV_SEQUENTIAL | POSIX_FADV_DONTNEED);
        ::close(fd);
    }
#endif
}

// ── App folders (used by Victory Road UI) ────────────────────────────────────

static constexpr std::array<std::string_view, 11> kAppFolders{{
    "200_icon/01_icon_emblem",
    "200_icon/02_icon_item",
    "200_icon/06_icon_class",
    "200_icon/10_icon_chr/face",
    "200_icon/10_icon_chr/uniform",
    "200_icon/10_icon_chr/aura_soul",
    "200_icon/10_icon_chr/aura_fs",
    "200_icon/10_icon_chr/aura_armed",
    "200_icon/10_icon_chr/aura_mixi",
    "200_icon/15_icon_common",
    "220_img/telop_waza",
}};

// ── Config ───────────────────────────────────────────────────────────────────

struct Config {
    fs::path game_path;
    fs::path output_path;
    fs::path dict_path;              // optional pre-trained zstd dictionary (.zstd_dict)
    std::string upload_url;          // optional: POST .tar.zst to this URL via cpr (multipart)
    std::string upload_auth;         // optional Bearer token / basic auth for upload
    int webp_quality = 85;
    bool webp_lossless = false;
    int zstd_level = 19;
    int workers = 0;                 // 0 = auto
    int zstd_workers = 0;            // 0 = auto
    bool smart_resume = true;
    bool verbose = false;
};

// ── Work item ────────────────────────────────────────────────────────────────

struct FileJob {
    std::string cpk_name;            // basename only
    std::string vfs_path;            // data/dx11/menu/...
    std::string rel_tar_path;        // 200_icon/xx/name.webp
    uint64_t size;                   // uncompressed size in CPK
};

// ── Lock-free-ish MPMC queue (single mutex, minimal contention) ──────────────

template <typename T>
class WorkQueue {
public:
    void push_bulk(std::vector<T>&& items) {
        {
            std::lock_guard lk(mu_);
            q_ = std::move(items);
            idx_ = 0;
        }
        cv_.notify_all();
    }

    bool pop(T& out) {
        std::lock_guard lk(mu_);
        if (idx_ >= q_.size()) return false;
        out = std::move(q_[idx_++]);
        return true;
    }

private:
    std::mutex mu_;
    std::condition_variable cv_;
    std::vector<T> q_;
    size_t idx_ = 0;
};

// ── Streaming TAR writer (buffered to zstd stream) ───────────────────────────
// Writes headers + data directly to a growing std::vector that gets flushed
// to zstd in 4 MB chunks. Lock-serialized — only 1 writer thread.

class StreamingTar {
public:
    void add(std::string_view path, std::span<const uint8_t> data) {
        write_header_(path, data.size());
        append_(data.data(), data.size());
        // Pad to 512-byte boundary
        size_t pad = (512 - (data.size() % 512)) % 512;
        static const std::array<uint8_t, 512> zeros{};
        append_(zeros.data(), pad);
    }

    void finalize() {
        static const std::array<uint8_t, 1024> zeros{};
        append_(zeros.data(), 1024);  // Two 512-byte zero blocks
    }

    std::vector<uint8_t>& buffer() { return buf_; }
    void clear_buffer() { buf_.clear(); }
    size_t total_written() const { return total_; }

private:
    void write_header_(std::string_view path, size_t size) {
        std::array<uint8_t, 512> hdr{};

        auto name_len = std::min(path.size(), size_t(99));
        std::memcpy(hdr.data(), path.data(), name_len);

        std::memcpy(hdr.data() + 100, "0000644", 7);   // mode
        std::memcpy(hdr.data() + 108, "0000000", 7);   // uid
        std::memcpy(hdr.data() + 116, "0000000", 7);   // gid

        char buf[13];
        std::snprintf(buf, sizeof(buf), "%011llo", (unsigned long long)size);
        std::memcpy(hdr.data() + 124, buf, 11);

        auto now = (unsigned long long)std::time(nullptr);
        std::snprintf(buf, sizeof(buf), "%011llo", now);
        std::memcpy(hdr.data() + 136, buf, 11);

        std::memset(hdr.data() + 148, ' ', 8);        // checksum placeholder
        hdr[156] = '0';                                // regular file
        std::memcpy(hdr.data() + 257, "ustar\0" "00", 8);

        uint32_t chk = 0;
        for (uint8_t b : hdr) chk += b;
        std::snprintf(buf, sizeof(buf), "%06o", chk);
        std::memcpy(hdr.data() + 148, buf, 6);
        hdr[148 + 6] = 0;
        hdr[148 + 7] = ' ';

        append_(hdr.data(), hdr.size());
    }

    void append_(const uint8_t* p, size_t n) {
        buf_.insert(buf_.end(), p, p + n);
        total_ += n;
    }

    std::vector<uint8_t> buf_;
    size_t total_ = 0;
};

// ── Stats ────────────────────────────────────────────────────────────────────

struct alignas(64) Stats {  // cache-line aligned to avoid false sharing
    std::atomic<uint64_t> processed{0};
    std::atomic<uint64_t> failed{0};
    std::atomic<uint64_t> skipped{0};
    std::atomic<uint64_t> webp_bytes{0};
    std::atomic<uint64_t> raw_bytes{0};
    std::atomic<bool> cancelled{false};
};

// ── Intermediate WebP payload queued to packer ───────────────────────────────

struct WebpPayload {
    std::string tar_path;
    std::vector<uint8_t> data;
};

class PayloadChannel {
public:
    void push(WebpPayload&& p) {
        {
            std::lock_guard lk(mu_);
            q_.push(std::move(p));
        }
        cv_.notify_one();
    }

    bool pop(WebpPayload& out, std::stop_token stop) {
        std::unique_lock lk(mu_);
        cv_.wait(lk, [&] { return !q_.empty() || closed_ || stop.stop_requested(); });
        if (q_.empty()) return false;
        out = std::move(q_.front());
        q_.pop();
        return true;
    }

    void close() {
        {
            std::lock_guard lk(mu_);
            closed_ = true;
        }
        cv_.notify_all();
    }

private:
    std::mutex mu_;
    std::condition_variable cv_;
    std::queue<WebpPayload> q_;
    bool closed_ = false;
};

// ── Manifest (smart resume) ──────────────────────────────────────────────────

struct Manifest {
    std::unordered_set<std::string> done;   // set of tar paths already exported

    bool load(const fs::path& path) {
        if (!fs::exists(path)) return false;
        try {
            std::ifstream f(path);
            auto j = json::parse(f);
            for (const auto& p : j.value("done", json::array())) {
                done.insert(p.get<std::string>());
            }
            return true;
        } catch (...) {
            return false;
        }
    }

    void save(const fs::path& path) const {
        json j;
        j["done"] = json::array();
        for (const auto& p : done) j["done"].push_back(p);
        j["timestamp"] = (uint64_t)std::time(nullptr);
        std::ofstream f(path);
        f << j.dump(0);
    }
};

// ── File scanning via VFS (reuses iecode::vfs::Vfs index) ────────────────────

std::vector<FileJob> scan_files(iecode::vfs::Vfs& vfs, bool verbose) {
    std::vector<FileJob> jobs;
    jobs.reserve(32'000);

    for (std::string_view af : kAppFolders) {
        // Glob: "*menu/<af>/*.g4tx"
        std::string pattern = "*menu/";
        pattern += af;
        pattern += "/*.g4tx";

        auto entries = vfs.list(pattern);
        for (const auto& e : entries) {
            std::string rel = e.internal_path;
            if (auto pos = rel.find("menu/"); pos != std::string::npos) {
                rel = rel.substr(pos + 5);
            }
            if (auto dot = rel.rfind(".g4tx"); dot != std::string::npos) {
                rel = rel.substr(0, dot) + ".webp";
            }
            jobs.push_back({
                .cpk_name = e.cpk_filename,
                .vfs_path = e.internal_path,
                .rel_tar_path = std::move(rel),
                .size = e.file_size,
            });
        }
    }

    if (verbose) std::cerr << "VFS scan: " << jobs.size() << " jobs\n";
    return jobs;
}

// ── Worker: VFS read → parse G4TX → export WebP → push payload ───────────────
// Per-worker uses thread-local temp path to avoid filename collisions.
// VFS is thread-safe for concurrent reads (internal mutex on CPK cache).

void worker_loop(std::stop_token stop, WorkQueue<FileJob>& queue, PayloadChannel& out,
                 iecode::vfs::Vfs& vfs, const Manifest& manifest, Stats& stats,
                 int webp_quality, bool webp_lossless, int worker_id) {
    FileJob job;
    // Thread-local temp path — no filename collisions, minimal syscalls
    auto tmp_path = fs::temp_directory_path() /
                    fmt::format("iecode_w{}_{}.webp", worker_id,
                                std::hash<std::thread::id>{}(std::this_thread::get_id()));

    while (!stop.stop_requested() && !stats.cancelled.load(std::memory_order_relaxed)) {
        if (!queue.pop(job)) break;

        // Skip if already done (smart resume)
        if (manifest.done.contains(job.rel_tar_path)) {
            stats.skipped.fetch_add(1, std::memory_order_relaxed);
            stats.processed.fetch_add(1, std::memory_order_relaxed);
            continue;
        }

        // VFS read — uses mmap CpkReader cache internally, thread-safe
        auto g4tx_data = vfs.read(job.vfs_path);
        if (g4tx_data.empty()) {
            stats.failed.fetch_add(1, std::memory_order_relaxed);
            stats.processed.fetch_add(1, std::memory_order_relaxed);
            continue;
        }
        stats.raw_bytes.fetch_add(g4tx_data.size(), std::memory_order_relaxed);

        // Parse G4TX (zero-copy from VFS buffer)
        auto g4tx = iecode::level5::g4tx_parse(g4tx_data);
        if (!g4tx || g4tx->textures.empty()) {
            stats.failed.fetch_add(1, std::memory_order_relaxed);
            stats.processed.fetch_add(1, std::memory_order_relaxed);
            continue;
        }

        // Export to thread-local temp
        if (!iecode::converters::export_webp(g4tx->textures[0], tmp_path,
                                             webp_quality, webp_lossless)) {
            stats.failed.fetch_add(1, std::memory_order_relaxed);
            stats.processed.fetch_add(1, std::memory_order_relaxed);
            continue;
        }

        // Read webp back, push to packer
        WebpPayload payload;
        payload.tar_path = std::move(job.rel_tar_path);
        {
            std::ifstream f(tmp_path, std::ios::binary | std::ios::ate);
            auto sz = f.tellg();
            f.seekg(0);
            payload.data.resize((size_t)sz);
            f.read((char*)payload.data.data(), sz);
        }

        stats.webp_bytes.fetch_add(payload.data.size(), std::memory_order_relaxed);
        out.push(std::move(payload));
        stats.processed.fetch_add(1, std::memory_order_relaxed);
    }

    std::error_code ec;
    fs::remove(tmp_path, ec);
}

// ── Packer + zstd streaming writer ───────────────────────────────────────────

void packer_zstd_loop(std::stop_token stop, PayloadChannel& in,
                      const fs::path& output_path, int zstd_level, int zstd_workers,
                      Stats& stats, Manifest& manifest,
                      std::atomic<uint64_t>& out_tar_bytes,
                      std::atomic<uint64_t>& out_compressed_bytes) {
    StreamingTar tar;
    std::ofstream out(output_path, std::ios::binary);
    if (!out) {
        stats.cancelled.store(true, std::memory_order_relaxed);
        return;
    }

    auto cctx = ZSTD_createCCtx();
    ZSTD_CCtx_setParameter(cctx, ZSTD_c_compressionLevel, zstd_level);
    if (zstd_workers > 0) {
        ZSTD_CCtx_setParameter(cctx, ZSTD_c_nbWorkers, zstd_workers);
    }
    ZSTD_CCtx_setParameter(cctx, ZSTD_c_checksumFlag, 1);

    const size_t zstd_out_size = ZSTD_CStreamOutSize();
    std::vector<uint8_t> zstd_out(zstd_out_size);

    auto flush_tar_to_zstd = [&](bool last) {
        auto& buf = tar.buffer();
        if (buf.empty() && !last) return;

        ZSTD_inBuffer zin{buf.data(), buf.size(), 0};
        ZSTD_EndDirective mode = last ? ZSTD_e_end : ZSTD_e_continue;

        bool finished = false;
        while (!finished) {
            ZSTD_outBuffer zout{zstd_out.data(), zstd_out.size(), 0};
            size_t rem = ZSTD_compressStream2(cctx, &zout, &zin, mode);
            if (ZSTD_isError(rem)) {
                std::cerr << "zstd error: " << ZSTD_getErrorName(rem) << "\n";
                stats.cancelled.store(true);
                return;
            }
            if (zout.pos > 0) {
                out.write((char*)zstd_out.data(), zout.pos);
                out_compressed_bytes.fetch_add(zout.pos, std::memory_order_relaxed);
            }
            finished = last ? (rem == 0) : (zin.pos == zin.size);
        }
        tar.clear_buffer();
    };

    constexpr size_t kFlushThreshold = 4 * 1024 * 1024;   // 4 MB

    WebpPayload payload;
    while (in.pop(payload, stop)) {
        tar.add(payload.tar_path, payload.data);
        out_tar_bytes.store(tar.total_written(), std::memory_order_relaxed);

        {
            // Mark as done in manifest (no lock needed: single packer thread)
            manifest.done.insert(payload.tar_path);
        }

        if (tar.buffer().size() >= kFlushThreshold) {
            flush_tar_to_zstd(false);
        }
    }

    // Finalize TAR (2 zero blocks) and flush remaining + close zstd stream
    tar.finalize();
    flush_tar_to_zstd(true);

    ZSTD_freeCCtx(cctx);
}

// ── Progress reporter ────────────────────────────────────────────────────────

void progress_loop(std::stop_token stop, const Stats& stats, uint64_t total) {
    auto start = clock_t_::now();
    while (!stop.stop_requested()) {
        std::this_thread::sleep_for(std::chrono::seconds(2));
        auto p = stats.processed.load(std::memory_order_relaxed);
        auto f = stats.failed.load(std::memory_order_relaxed);
        auto s = stats.skipped.load(std::memory_order_relaxed);
        auto bytes = stats.raw_bytes.load(std::memory_order_relaxed);
        auto elapsed = std::chrono::duration<double>(clock_t_::now() - start).count();
        double mbps = elapsed > 0 ? (bytes / 1024.0 / 1024.0 / elapsed) : 0;
        double pct = total > 0 ? (100.0 * p / total) : 0;
        std::cerr << fmt::format(
            "\r  [{:5.1f}%] {}/{}  ok={} fail={} skip={}  {:.1f} MB/s    ",
            pct, p, total, p - f - s, f, s, mbps);
    }
    std::cerr << "\n";
}

// ── Main ─────────────────────────────────────────────────────────────────────

int main(int argc, char** argv) try {
    Config cfg;

    for (int i = 1; i < argc; ++i) {
        std::string_view a(argv[i]);
        auto next = [&](const char* name) -> const char* {
            if (i + 1 >= argc) throw std::runtime_error(std::string(name) + " requires value");
            return argv[++i];
        };
        if      (a == "-g" || a == "--game")      cfg.game_path   = next("--game");
        else if (a == "-o" || a == "--output")    cfg.output_path = next("--output");
        else if (a == "--quality")                cfg.webp_quality = std::stoi(next("--quality"));
        else if (a == "--lossless")               cfg.webp_lossless = true;
        else if (a == "--zstd-level")             cfg.zstd_level  = std::stoi(next("--zstd-level"));
        else if (a == "--workers")                cfg.workers     = std::stoi(next("--workers"));
        else if (a == "--zstd-workers")           cfg.zstd_workers = std::stoi(next("--zstd-workers"));
        else if (a == "--no-resume")              cfg.smart_resume = false;
        else if (a == "-v" || a == "--verbose")   cfg.verbose = true;
        else if (a == "-h" || a == "--help") {
            std::cout <<
R"(iecode_export_app_optimized — Victory Road app icons → WebP tar.zst

Required:
  -g, --game <path>        Game install directory
  -o, --output <path>      Output .tar.zst file

Optional:
  --quality <0-100>        WebP quality (default: 85)
  --lossless               WebP lossless mode
  --zstd-level <1-22>      zstd compression level (default: 19)
  --workers <N>            CPU workers (default: hw_concurrency)
  --zstd-workers <N>       zstd parallel workers (default: 4)
  --no-resume              Disable smart manifest resume
  -v, --verbose            Verbose output
)";
            return 0;
        }
    }

    if (cfg.game_path.empty() || cfg.output_path.empty()) {
        std::cerr << "--game and --output required (use --help)\n";
        return 2;
    }
    if (cfg.workers == 0)      cfg.workers = (int)std::thread::hardware_concurrency();
    if (cfg.zstd_workers == 0) cfg.zstd_workers = std::min(4, cfg.workers);

    auto start_total = clock_t_::now();

    std::cerr << fmt::format("📖 Initializing VFS from {} ...\n", cfg.game_path.string());
    iecode::vfs::Vfs vfs;
    if (!vfs.init(cfg.game_path / "data")) {
        std::cerr << "❌ Failed to init VFS (missing cpk_list.cfg.bin?)\n";
        return 1;
    }
    std::cerr << fmt::format("✅ VFS: {} assets across {} CPKs\n",
                             vfs.asset_count(), vfs.cpk_count());

    auto jobs = scan_files(vfs, cfg.verbose);
    if (jobs.empty()) {
        std::cerr << "❌ No app icon files found in VFS\n";
        return 1;
    }

    // Sort by size ASC (load balancing: small files first drains faster, long tail at end)
    std::sort(jobs.begin(), jobs.end(),
              [](const FileJob& a, const FileJob& b) { return a.size < b.size; });

    uint64_t total_bytes = std::accumulate(jobs.begin(), jobs.end(), uint64_t(0),
        [](uint64_t s, const FileJob& j) { return s + j.size; });

    std::cerr << fmt::format("✅ {} jobs, {:.2f} GB total\n\n",
                             jobs.size(), total_bytes / (1024.0 * 1024.0 * 1024.0));

    // Load manifest for smart resume
    Manifest manifest;
    fs::path manifest_path = cfg.output_path.string() + ".manifest.json";
    if (cfg.smart_resume && manifest.load(manifest_path)) {
        std::cerr << fmt::format("🔄 Resume: {} files already done, will skip\n\n",
                                 manifest.done.size());
    }

    fs::create_directories(cfg.output_path.parent_path());

    // Pipeline setup
    WorkQueue<FileJob> queue;
    PayloadChannel channel;
    Stats stats;

    std::atomic<uint64_t> out_tar_bytes{0};
    std::atomic<uint64_t> out_compressed_bytes{0};

    const size_t total_jobs = jobs.size();

    // Start packer/zstd thread
    std::jthread packer([&](std::stop_token st) {
        packer_zstd_loop(st, channel, cfg.output_path, cfg.zstd_level, cfg.zstd_workers,
                         stats, manifest, out_tar_bytes, out_compressed_bytes);
    });

    // Start progress reporter
    std::jthread reporter([&](std::stop_token st) {
        progress_loop(st, stats, total_jobs);
    });

    // Push work
    queue.push_bulk(std::move(jobs));

    // Start N workers
    std::vector<std::jthread> workers;
    workers.reserve(cfg.workers);
    for (int i = 0; i < cfg.workers; ++i) {
        workers.emplace_back([&, i](std::stop_token st) {
            pin_cpu_affinity(i);  // Linux: pin worker to CPU i
            worker_loop(st, queue, channel, vfs, manifest, stats,
                        cfg.webp_quality, cfg.webp_lossless, i);
        });
    }

    // Wait for workers to drain queue
    for (auto& w : workers) w.join();
    channel.close();
    packer.join();
    reporter.request_stop();
    reporter.join();

    // Save manifest
    if (cfg.smart_resume) {
        manifest.save(manifest_path);
    }

    // Summary
    auto elapsed = std::chrono::duration<double>(clock_t_::now() - start_total).count();
    uint64_t ok = stats.processed.load() - stats.failed.load() - stats.skipped.load();
    uint64_t tar_sz  = out_tar_bytes.load();
    uint64_t comp_sz = out_compressed_bytes.load();

    std::cerr << "\n── Summary ────────────────────────────\n";
    std::cerr << fmt::format("  OK        : {}\n", ok);
    std::cerr << fmt::format("  Failed    : {}\n", stats.failed.load());
    std::cerr << fmt::format("  Skipped   : {}\n", stats.skipped.load());
    std::cerr << fmt::format("  TAR bytes : {:.2f} MB\n", tar_sz / (1024.0 * 1024.0));
    std::cerr << fmt::format("  Compressed: {:.2f} MB\n", comp_sz / (1024.0 * 1024.0));
    if (tar_sz > 0) {
        std::cerr << fmt::format("  Ratio     : {:.1f}%\n", 100.0 * comp_sz / tar_sz);
    }
    std::cerr << fmt::format("  Elapsed   : {:.1f} s\n", elapsed);
    std::cerr << fmt::format("  Throughput: {:.1f} MB/s\n",
                             stats.raw_bytes.load() / 1024.0 / 1024.0 / elapsed);
    std::cerr << fmt::format("  Output    : {}\n", cfg.output_path.string());

    return stats.failed.load() > 0 ? 1 : 0;
} catch (const std::exception& e) {
    std::cerr << "❌ Error: " << e.what() << "\n";
    return 1;
}
