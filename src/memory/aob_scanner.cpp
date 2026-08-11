/// @file aob_scanner.cpp
/// Implementation du scanner AOB — parse de patterns, scan memoire, acceleration AVX2.

#ifdef _WIN32

#include "iecode/memory/aob_scanner.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <charconv>
#include <cstring>

#ifdef IECODE_HAS_AVX2
#include <immintrin.h>
#endif

namespace iecode::memory {

// ── AobPattern ───────────────────────────────────────────────────────

std::optional<AobPattern> AobPattern::from_string(std::string_view pattern) {
    AobPattern result;

    size_t i = 0;
    while (i < pattern.size()) {
        // Skip espaces
        while (i < pattern.size() && pattern[i] == ' ') ++i;
        if (i >= pattern.size()) break;

        // Wildcard : ? ou ??
        if (pattern[i] == '?') {
            result.bytes.push_back(0);
            result.mask.push_back(0x00);
            ++i;
            if (i < pattern.size() && pattern[i] == '?') ++i;  // ??
            continue;
        }

        // Octet hex
        if (i + 1 >= pattern.size()) {
            spdlog::error("aob: pattern tronque a la position {}", i);
            return std::nullopt;
        }

        uint8_t value = 0;
        auto [ptr, ec] = std::from_chars(pattern.data() + i, pattern.data() + i + 2, value, 16);
        if (ec != std::errc{}) {
            spdlog::error("aob: octet hex invalide '{}' a la position {}",
                         pattern.substr(i, 2), i);
            return std::nullopt;
        }
        result.bytes.push_back(value);
        result.mask.push_back(0xFF);
        i += 2;
    }

    if (result.bytes.empty()) {
        spdlog::error("aob: pattern vide");
        return std::nullopt;
    }

    spdlog::debug("aob: pattern parse — {} octets ({} wildcards)",
                  result.bytes.size(),
                  std::count(result.mask.begin(), result.mask.end(), 0x00));
    return result;
}

bool AobPattern::matches_at(const uint8_t* data, size_t data_size, size_t pos) const noexcept {
    if (pos + bytes.size() > data_size) return false;

    for (size_t i = 0; i < bytes.size(); ++i) {
        if ((data[pos + i] & mask[i]) != (bytes[i] & mask[i])) {
            return false;
        }
    }
    return true;
}

// ── AobScanner ───────────────────────────────────────────────────────

AobScanner::AobScanner(const ProcessHandle& process)
    : process_(process) {}

std::optional<uintptr_t> AobScanner::find_first(const AobPattern& pattern) const {
    if (pattern.empty()) return std::nullopt;

    auto regions = process_.enumerate_executable_regions();
    spdlog::debug("aob: scan de {} regions executables", regions.size());

    for (const auto& region : regions) {
        auto result = find_in_range(pattern, region.base_address, region.region_size);
        if (result) return result;
    }

    spdlog::debug("aob: pattern non trouve dans {} regions", regions.size());
    return std::nullopt;
}

std::vector<uintptr_t> AobScanner::find_all(const AobPattern& pattern) const {
    std::vector<uintptr_t> results;
    if (pattern.empty()) return results;

    auto regions = process_.enumerate_executable_regions();

    for (const auto& region : regions) {
        auto region_results = find_all_in_range(pattern, region.base_address, region.region_size);
        results.insert(results.end(), region_results.begin(), region_results.end());
    }

    spdlog::debug("aob: {} occurrences trouvees", results.size());
    return results;
}

std::optional<uintptr_t> AobScanner::find_in_range(
    const AobPattern& pattern, uintptr_t start, size_t size) const {
    if (pattern.empty() || size < pattern.size()) return std::nullopt;

    // Lire la region en une seule fois
    auto data = process_.read_vec(start, size);
    if (!data) return std::nullopt;

    auto offsets = scan_buffer(data->data(), data->size(), pattern);
    if (offsets.empty()) return std::nullopt;

    return start + offsets[0];
}

std::vector<uintptr_t> AobScanner::find_all_in_range(
    const AobPattern& pattern, uintptr_t start, size_t size) const {
    std::vector<uintptr_t> results;
    if (pattern.empty() || size < pattern.size()) return results;

    auto data = process_.read_vec(start, size);
    if (!data) return results;

    auto offsets = scan_buffer(data->data(), data->size(), pattern);
    results.reserve(offsets.size());
    for (auto off : offsets) {
        results.push_back(start + off);
    }
    return results;
}

std::optional<uintptr_t> AobScanner::resolve_rip_relative(
    uintptr_t pattern_addr, size_t rip_offset, size_t instr_len) const {
    // Lire le deplacement relatif 32 bits
    auto disp = process_.read<int32_t>(pattern_addr + rip_offset);
    if (!disp) return std::nullopt;

    // RIP-relative : adresse = adresse_instruction + longueur_instruction + deplacement
    uintptr_t target = pattern_addr + instr_len + static_cast<uintptr_t>(*disp);
    spdlog::debug("aob: RIP resolve 0x{:X} + {} + {} = 0x{:X}",
                  pattern_addr, instr_len, *disp, target);
    return target;
}

// ── Scan buffer (scalar) ─────────────────────────────────────────────

std::vector<size_t> AobScanner::scan_buffer(
    const uint8_t* data, size_t size, const AobPattern& pattern) const {

#ifdef IECODE_HAS_AVX2
    // Utiliser le path AVX2 si le pattern est assez grand
    if (pattern.size() >= 2) {
        return scan_buffer_avx2(data, size, pattern);
    }
#endif

    std::vector<size_t> results;
    if (size < pattern.size()) return results;

    const size_t end = size - pattern.size() + 1;

    for (size_t i = 0; i < end; ++i) {
        if (pattern.matches_at(data, size, i)) {
            results.push_back(i);
        }
    }
    return results;
}

// ── Scan buffer AVX2 ─────────────────────────────────────────────────

#ifdef IECODE_HAS_AVX2

std::vector<size_t> AobScanner::scan_buffer_avx2(
    const uint8_t* data, size_t size, const AobPattern& pattern) const {
    std::vector<size_t> results;
    if (size < pattern.size()) return results;

    const size_t end = size - pattern.size() + 1;

    // Strategie : utiliser le premier octet non-wildcard comme filtre rapide.
    // Broadcaster ce byte dans un YMM, comparer 32 octets a la fois,
    // puis valider les candidats avec le pattern complet.

    // Trouver le premier octet non-wildcard
    size_t first_fixed = 0;
    while (first_fixed < pattern.size() && pattern.mask[first_fixed] == 0x00) {
        ++first_fixed;
    }
    if (first_fixed >= pattern.size()) {
        // Pattern entierement wildcard — tout matche
        for (size_t i = 0; i < end; ++i) results.push_back(i);
        return results;
    }

    const uint8_t needle_byte = pattern.bytes[first_fixed];
    const __m256i needle_vec = _mm256_set1_epi8(static_cast<char>(needle_byte));

    size_t i = 0;
    const size_t avx_end = (end > first_fixed + 32) ? end - first_fixed - 31 : 0;

    // Phase AVX2 : scanner 32 octets a la fois
    for (; i < avx_end; i += 32) {
        __m256i chunk = _mm256_loadu_si256(
            reinterpret_cast<const __m256i*>(data + i + first_fixed));
        __m256i cmp = _mm256_cmpeq_epi8(chunk, needle_vec);
        uint32_t mask = static_cast<uint32_t>(_mm256_movemask_epi8(cmp));

        while (mask != 0) {
            uint32_t bit = _tzcnt_u32(mask);
            size_t candidate = i + bit;
            if (candidate < end && pattern.matches_at(data, size, candidate)) {
                results.push_back(candidate);
            }
            mask &= mask - 1;  // Clear lowest set bit
        }
    }

    // Phase scalaire : octets restants
    for (; i < end; ++i) {
        if (pattern.matches_at(data, size, i)) {
            results.push_back(i);
        }
    }

    return results;
}

#endif // IECODE_HAS_AVX2

} // namespace iecode::memory

#endif // _WIN32
