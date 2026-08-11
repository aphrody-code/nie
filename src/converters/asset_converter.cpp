/// @file asset_converter.cpp
/// Facade de conversion unifiee.

#include "iecode/converters/asset_converter.h"
#include "iecode/converters/texture_export.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/formats/level5/g4tx.h"
#include "iecode/formats/format_detector.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <fstream>
#include <mutex>
#include <thread>
#include <unordered_set>
#include <vector>

namespace iecode::converters {

namespace fs = std::filesystem;

// ── Helpers ─────────────────────────────────────────────────────────

static std::vector<uint8_t> read_file(const fs::path& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return {};
    const auto sz = f.tellg();
    if (sz <= 0) return {};
    std::vector<uint8_t> buf(static_cast<size_t>(sz));
    f.seekg(0);
    f.read(reinterpret_cast<char*>(buf.data()), sz);
    return buf;
}

static std::string effective_ext(const fs::path& p) {
    auto s = p.filename().string();
    // Handle .cfg.bin double extension
    if (s.size() > 8 && s.substr(s.size() - 8) == ".cfg.bin") return ".cfg.bin";
    auto ext = p.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return ext;
}

/// Known locale path segments.
static const std::vector<std::string> LOCALE_CODES = {
    "de", "en", "es", "fr", "it", "pt", "ja", "zh", "ko",
    "zh_hans", "zh_hant"
};

/// Check if a path contains a locale segment not in the allowed set.
static bool should_skip_locale(const fs::path& p, const std::set<std::string>& langs) {
    if (langs.empty()) return false;
    const auto s = p.string();
    for (const auto& loc : LOCALE_CODES) {
        // Check for /loc/ in path
        const auto needle = "/" + loc + "/";
        if (s.find(needle) != std::string::npos) {
            return langs.find(loc) == langs.end();
        }
    }
    return false; // no locale in path = keep
}

static const std::vector<std::string> SUPPORTED_EXTS = {
    ".g4tx", ".cfg.bin"
};

static bool is_supported(const std::string& ext) {
    return std::find(SUPPORTED_EXTS.begin(), SUPPORTED_EXTS.end(), ext) != SUPPORTED_EXTS.end();
}

// ── convert_file ────────────────────────────────────────────────────

bool convert_file(const fs::path& input, const fs::path& output,
                  const ConvertOptions& opts) {
    const auto ext = effective_ext(input);

    // Create parent directories
    if (!output.parent_path().empty()) {
        std::error_code ec;
        fs::create_directories(output.parent_path(), ec);
    }

    if (ext == ".g4tx") {
        auto data = read_file(input);
        if (data.empty()) {
            spdlog::error("convert: cannot read '{}'", input.string());
            return false;
        }
        auto g4tx = level5::g4tx_parse(data);
        if (!g4tx) {
            spdlog::error("convert: g4tx parse failed for '{}'", input.string());
            return false;
        }
        if (g4tx->textures.empty()) return false;

        bool any = false;
        for (size_t i = 0; i < g4tx->textures.size(); ++i) {
            const auto& tex = g4tx->textures[i];
            fs::path out_path;
            if (g4tx->textures.size() == 1) {
                out_path = output;
            } else {
                out_path = output.parent_path() /
                           (input.stem().string() + "_" + std::to_string(i) + output.extension().string());
            }

            bool ok = false;
            if (opts.format == "webp") {
                ok = export_webp(tex, out_path, opts.webp_quality, false);
            } else {
                ok = export_png(tex, out_path);
            }
            if (ok) any = true;
        }
        return any;
    }

    if (ext == ".cfg.bin") {
        auto data = read_file(input);
        if (data.empty()) {
            spdlog::error("convert: cannot read '{}'", input.string());
            return false;
        }
        auto cfg = level5::cfgbin_parse(data);
        if (!cfg) {
            spdlog::error("convert: cfgbin parse failed for '{}'", input.string());
            return false;
        }
        const auto json_str = level5::cfgbin_to_json(*cfg);
        std::ofstream out(output, std::ios::binary);
        if (!out) {
            spdlog::error("convert: cannot open output '{}'", output.string());
            return false;
        }
        out.write(json_str.data(), static_cast<std::streamsize>(json_str.size()));
        return out.good();
    }

    // Unsupported format stubs — log and return false
    spdlog::warn("convert: format '{}' not yet implemented for '{}'", ext, input.string());
    return false;
}

// ── convert_directory ───────────────────────────────────────────────

ConvertResult convert_directory(const fs::path& input_dir,
                                 const fs::path& output_dir,
                                 bool recursive,
                                 const ConvertOptions& opts) {
    const auto t0 = std::chrono::high_resolution_clock::now();
    ConvertResult result;

    // 1. Collect files
    std::vector<fs::path> files;
    auto it = recursive
        ? fs::recursive_directory_iterator(input_dir, fs::directory_options::skip_permission_denied)
        : fs::recursive_directory_iterator(input_dir, fs::directory_options::skip_permission_denied);

    for (const auto& entry : it) {
        if (!entry.is_regular_file()) continue;
        if (!recursive && entry.path().parent_path() != input_dir) continue;
        const auto ext = effective_ext(entry.path());
        if (!is_supported(ext)) continue;
        if (should_skip_locale(entry.path(), opts.languages)) continue;
        files.push_back(entry.path());
    }

    // 2. Sort for sequential disk access
    std::sort(files.begin(), files.end());
    result.files_processed = files.size();

    if (files.empty()) {
        result.elapsed_ms = 0;
        return result;
    }

    // 3. Dedup
    std::mutex dedup_mutex;
    std::unordered_set<std::string> seen;

    // 4. Work-stealing parallel conversion
    std::atomic<size_t> next_idx{0};
    std::atomic<size_t> converted{0};
    std::atomic<size_t> skipped{0};
    std::atomic<size_t> errors{0};

    const auto num_threads = std::max(1u, std::thread::hardware_concurrency());
    std::vector<std::thread> threads;
    threads.reserve(num_threads);

    for (unsigned t = 0; t < num_threads; ++t) {
        threads.emplace_back([&]() {
            while (true) {
                const size_t idx = next_idx.fetch_add(1, std::memory_order_relaxed);
                if (idx >= files.size()) break;

                const auto& file = files[idx];
                const auto rel = fs::relative(file, input_dir);
                auto out_path = output_dir / rel;

                // Change extension based on format
                const auto ext = effective_ext(file);
                if (ext == ".g4tx") {
                    if (opts.format == "webp")
                        out_path.replace_extension(".webp");
                    else
                        out_path.replace_extension(".png");
                } else if (ext == ".cfg.bin") {
                    out_path = output_dir / rel.parent_path() /
                               (file.stem().stem().string() + ".json");
                }

                // Dedup check
                if (opts.skip_duplicates) {
                    std::lock_guard lock(dedup_mutex);
                    if (!seen.insert(out_path.string()).second) {
                        skipped.fetch_add(1, std::memory_order_relaxed);
                        continue;
                    }
                }

                if (convert_file(file, out_path, opts)) {
                    converted.fetch_add(1, std::memory_order_relaxed);
                } else {
                    errors.fetch_add(1, std::memory_order_relaxed);
                }
            }
        });
    }

    for (auto& th : threads) th.join();

    result.files_converted = converted.load();
    result.files_skipped = skipped.load();
    result.errors = errors.load();

    const auto t1 = std::chrono::high_resolution_clock::now();
    result.elapsed_ms = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count());

    return result;
}

} // namespace iecode::converters
