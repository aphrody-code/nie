/// @file bench.cpp
/// Harnais C++ du banc d'essai inter-langages.
///
/// Compile SANS vcpkg : n'inclut que `crc32.cpp` et `crilayla.cpp`, qui ne dépendent que de
/// la bibliothèque standard. Voir `bench/cpp/build.ps1`.
///
/// Protocole identique aux harnais Rust / C# / TypeScript : même générateur xorshift64*,
/// même graine, 3 tours de chauffe, 7 mesures, médiane.

#include "iecode/compression/crilayla.h"
#include "iecode/crypto/crc32.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <span>
#include <string>
#include <vector>

namespace {

constexpr uint64_t kSeed = 0x2545F4914F6CDD1DULL;
constexpr int kWarmup = 3;
constexpr int kRuns = 7;

void fill_xorshift(std::vector<uint8_t>& buf) {
    uint64_t x = kSeed;
    for (size_t i = 0; i < buf.size(); i += 8) {
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        const uint64_t v = x * 0x2545F4914F6CDD1DULL;
        const size_t n = std::min<size_t>(8, buf.size() - i);
        std::memcpy(buf.data() + i, &v, n);
    }
}

double median(std::vector<double> v) {
    std::sort(v.begin(), v.end());
    return v[v.size() / 2];
}

using Clock = std::chrono::steady_clock;

double seconds_since(Clock::time_point t) {
    return std::chrono::duration<double>(Clock::now() - t).count();
}

// ── CRC32 slicing-by-8, local au banc ────────────────────────────────────────
// Le toolkit (`src/crypto/crc32.cpp`) est en slicing-by-4. Pour que la comparaison porte
// sur le langage et non sur la fenêtre choisie, on mesure aussi le C++ avec l'algorithme
// exact du Rust. Sans ça, l'écart mesuré dirait « C++ vs Rust » en pensant « by-4 vs by-8 ».

constexpr uint32_t kPoly = 0xEDB88320u;

constexpr auto make_slice8() noexcept {
    std::array<std::array<uint32_t, 256>, 8> t{};
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t crc = i;
        for (int j = 0; j < 8; ++j) {
            crc = (crc & 1) ? ((crc >> 1) ^ kPoly) : (crc >> 1);
        }
        t[0][i] = crc;
    }
    for (int k = 1; k < 8; ++k) {
        for (uint32_t i = 0; i < 256; ++i) {
            t[k][i] = (t[k - 1][i] >> 8) ^ t[0][t[k - 1][i] & 0xFF];
        }
    }
    return t;
}

constexpr auto kSlice8 = make_slice8();

uint32_t crc32_slice8(std::span<const uint8_t> data) noexcept {
    uint32_t crc = 0xFFFFFFFFu;
    const uint8_t* p = data.data();
    size_t len = data.size();
    while (len >= 8) {
        uint32_t lo;
        uint32_t hi;
        std::memcpy(&lo, p, 4);
        std::memcpy(&hi, p + 4, 4);
        lo ^= crc;
        crc = kSlice8[7][lo & 0xFF] ^ kSlice8[6][(lo >> 8) & 0xFF] ^
              kSlice8[5][(lo >> 16) & 0xFF] ^ kSlice8[4][(lo >> 24) & 0xFF] ^
              kSlice8[3][hi & 0xFF] ^ kSlice8[2][(hi >> 8) & 0xFF] ^
              kSlice8[1][(hi >> 16) & 0xFF] ^ kSlice8[0][(hi >> 24) & 0xFF];
        p += 8;
        len -= 8;
    }
    while (len-- > 0) {
        crc = kSlice8[0][(crc ^ *p++) & 0xFF] ^ (crc >> 8);
    }
    return ~crc;
}

int bench_crc32(size_t mib, bool slice8) {
    std::vector<uint8_t> buf(mib * 1024 * 1024);
    fill_xorshift(buf);
    const auto run = [&](std::span<const uint8_t> d) {
        return slice8 ? crc32_slice8(d) : iecode::crypto::crc32_compute(d);
    };

    volatile uint32_t sink = 0;
    for (int i = 0; i < kWarmup; ++i) {
        sink = run(buf);
    }
    std::vector<double> times;
    times.reserve(kRuns);
    uint32_t last = 0;
    for (int i = 0; i < kRuns; ++i) {
        const auto t = Clock::now();
        last = run(buf);
        times.push_back(seconds_since(t));
        sink = last;
    }
    (void)sink;
    const double s = median(times);
    std::printf("lang=cpp bench=crc32 algo=%s mib=%zu median_ms=%.3f mib_s=%.1f checksum=0x%08x\n",
                slice8 ? "slice8" : "slice4", mib, s * 1000.0, static_cast<double>(mib) / s, last);
    return 0;
}

int bench_crilayla(const char* path, int iters) {
    std::ifstream f(path, std::ios::binary);
    if (!f) {
        std::fprintf(stderr, "échantillon absent : %s\n", path);
        return 1;
    }
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(f)),
                              std::istreambuf_iterator<char>());
    if (!iecode::compression::is_crilayla(data)) {
        std::fprintf(stderr, "%s n'est pas un blob CRILAYLA\n", path);
        return 1;
    }

    for (int i = 0; i < kWarmup; ++i) {
        auto out = iecode::compression::crilayla_decompress(data);
        if (out.empty()) {
            std::fprintf(stderr, "décompression échouée\n");
            return 1;
        }
    }
    std::vector<double> times;
    times.reserve(kRuns);
    size_t out_len = 0;
    for (int i = 0; i < kRuns; ++i) {
        const auto t = Clock::now();
        for (int k = 0; k < iters; ++k) {
            auto out = iecode::compression::crilayla_decompress(data);
            out_len = out.size();
        }
        times.push_back(seconds_since(t));
    }
    const double s = median(times);
    const double mib = static_cast<double>(out_len) * iters / (1024.0 * 1024.0);
    std::printf("lang=cpp bench=crilayla in=%zu out=%zu iters=%d median_ms=%.3f mib_s=%.1f\n",
                data.size(), out_len, iters, s * 1000.0, mib / s);
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    const std::string cmd = argc > 1 ? argv[1] : "crc32";
    if (cmd == "crc32" || cmd == "crc32-slice8") {
        const size_t mib = argc > 2 ? std::stoul(argv[2]) : 64;
        return bench_crc32(mib, cmd == "crc32-slice8");
    }
    if (cmd == "crilayla") {
        const char* path = argc > 2 ? argv[2] : "bench/data/sample.crilayla";
        const int iters = argc > 3 ? std::stoi(argv[3]) : 500;
        return bench_crilayla(path, iters);
    }
    std::fprintf(stderr, "usage: bench [crc32 <mib> | crc32-slice8 <mib> | crilayla <blob>]\n");
    return 2;
}
