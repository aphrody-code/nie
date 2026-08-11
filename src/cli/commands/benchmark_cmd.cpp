/// @file benchmark_cmd.cpp
/// Commande CLI 'benchmark' — mesure de throughput crypto/compression.
///
/// Benchmarks :
///   1. CRI XOR decrypt (SIMD AVX2/SSE2 ou scalaire)
///   2. CRC32 compute
///   3. LZ10 decompress (donnees synthetiques)
///   4. Detection SIMD (AVX2, SSE2)

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/crypto/cri_crypto.h"
#include "iecode/crypto/crc32.h"
#include "iecode/compression/lz10.h"

#include <CLI/CLI.hpp>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <numeric>
#include <random>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace iecode::cli {

// ── Generation de donnees aleatoires ───────────────────────────────

static std::vector<uint8_t> generate_random_buffer(size_t size_bytes) {
    std::vector<uint8_t> buf(size_bytes);
    std::mt19937 rng(42); // Seed fixe pour reproductibilite
    std::uniform_int_distribution<uint16_t> dist(0, 255);
    for (auto& b : buf) b = static_cast<uint8_t>(dist(rng));
    return buf;
}

// ── Benchmark CRI XOR ──────────────────────────────────────────────

static json bench_cri_xor(size_t size_mb, int iterations) {
    const size_t size_bytes = size_mb * 1024 * 1024;
    auto data = generate_random_buffer(size_bytes);
    constexpr uint32_t key = 0x1717E18E;

    // Warmup
    crypto::cri_decrypt(data, key);

    auto t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iterations; ++i) {
        crypto::cri_decrypt(data, key);
    }
    auto t1 = std::chrono::high_resolution_clock::now();

    const double ms = static_cast<double>(
        std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count()) / 1000.0;
    const double total_mb = static_cast<double>(size_mb) * iterations;
    const double throughput = (ms > 0) ? (total_mb / (ms / 1000.0)) : 0.0;

    return json{
        {"name", "cri_xor_decrypt"},
        {"sizeMB", size_mb},
        {"iterations", iterations},
        {"totalMs", ms},
        {"throughputMBs", static_cast<int64_t>(throughput)},
    };
}

// ── Benchmark CRC32 ───────────────────────────────────────────────

static json bench_crc32(size_t size_mb, int iterations) {
    const size_t size_bytes = size_mb * 1024 * 1024;
    auto data = generate_random_buffer(size_bytes);

    // Warmup
    volatile uint32_t sink = crypto::crc32_compute(std::span<const uint8_t>(data));
    (void)sink;

    auto t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iterations; ++i) {
        sink = crypto::crc32_compute(std::span<const uint8_t>(data));
    }
    auto t1 = std::chrono::high_resolution_clock::now();

    const double ms = static_cast<double>(
        std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count()) / 1000.0;
    const double total_mb = static_cast<double>(size_mb) * iterations;
    const double throughput = (ms > 0) ? (total_mb / (ms / 1000.0)) : 0.0;

    return json{
        {"name", "crc32_compute"},
        {"sizeMB", size_mb},
        {"iterations", iterations},
        {"totalMs", ms},
        {"throughputMBs", static_cast<int64_t>(throughput)},
        {"lastCrc", fmt::format("0x{:08X}", static_cast<uint32_t>(sink))},
    };
}

// ── Benchmark LZ10 decompress (donnees synthetiques) ───────────────

static json bench_lz10(int iterations) {
    // Construire un petit bloc LZ10 synthetique valide :
    // Header 4 octets : magic 0x10, taille decompresse sur 3 octets (little-endian)
    // Puis des flag bytes + donnees literals simples.
    const size_t decomp_size = 4096;
    std::vector<uint8_t> compressed;
    compressed.push_back(0x10); // Magic LZ10
    compressed.push_back(static_cast<uint8_t>(decomp_size & 0xFF));
    compressed.push_back(static_cast<uint8_t>((decomp_size >> 8) & 0xFF));
    compressed.push_back(static_cast<uint8_t>((decomp_size >> 16) & 0xFF));

    // Remplir avec des literals (flag byte 0x00 = 8 literals suivants)
    size_t remaining = decomp_size;
    uint8_t pattern = 0;
    while (remaining > 0) {
        compressed.push_back(0x00); // 8 flags = 0 (tous literals)
        for (int bit = 0; bit < 8 && remaining > 0; ++bit) {
            compressed.push_back(pattern++);
            --remaining;
        }
    }

    // Verifier que le bloc est valide
    if (!compression::is_lz10(compressed)) {
        return json{
            {"name", "lz10_decompress"},
            {"error", "impossible de generer un bloc LZ10 valide"},
        };
    }

    // Warmup
    auto result = compression::lz10_decompress(compressed);
    if (result.empty()) {
        return json{
            {"name", "lz10_decompress"},
            {"error", "echec de decompression du bloc synthetique"},
        };
    }

    auto t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iterations; ++i) {
        auto out = compression::lz10_decompress(compressed);
        // Empecher l'optimisation
        if (out.empty()) break;
    }
    auto t1 = std::chrono::high_resolution_clock::now();

    const double ms = static_cast<double>(
        std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count()) / 1000.0;
    const double total_kb = (static_cast<double>(decomp_size) * iterations) / 1024.0;
    const double throughput_kbs = (ms > 0) ? (total_kb / (ms / 1000.0)) : 0.0;

    return json{
        {"name", "lz10_decompress"},
        {"compressedSize", compressed.size()},
        {"decompressedSize", decomp_size},
        {"iterations", iterations},
        {"totalMs", ms},
        {"throughputKBs", static_cast<int64_t>(throughput_kbs)},
    };
}

// ── Detection SIMD ─────────────────────────────────────────────────

static json detect_simd() {
    json simd;

#ifdef __AVX2__
    simd["avx2"] = true;
#else
    simd["avx2"] = false;
#endif

#ifdef __SSE2__
    simd["sse2"] = true;
#else
    simd["sse2"] = false;
#endif

#ifdef __ARM_NEON
    simd["neon"] = true;
#else
    simd["neon"] = false;
#endif

    return simd;
}

// ── Commande principale ────────────────────────────────────────────

static void cmd_benchmark(int size_mb, int iterations) {
    if (size_mb <= 0) size_mb = 10;
    if (iterations <= 0) iterations = 5;

    json benchmarks = json::array();

    benchmarks.push_back(bench_cri_xor(static_cast<size_t>(size_mb), iterations));
    benchmarks.push_back(bench_crc32(static_cast<size_t>(size_mb), iterations));
    benchmarks.push_back(bench_lz10(iterations * 100)); // Plus d'iterations car le bloc est petit

    emit(json{
        {"ok", true},
        {"sizeMB", size_mb},
        {"iterations", iterations},
        {"simd", detect_simd()},
        {"benchmarks", std::move(benchmarks)},
    });
}

// ── Registration ───────────────────────────────────────────────────

void register_benchmark_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("benchmark", "Run crypto/compression benchmarks (JSON output)");

    static int size_mb = 10;
    static int iterations = 5;

    cmd->add_option("-s,--size", size_mb, "Buffer size in MB (default: 10)");
    cmd->add_option("-n,--iterations", iterations, "Number of iterations (default: 5)");

    cmd->callback([]() { cmd_benchmark(size_mb, iterations); });
}

} // namespace iecode::cli
