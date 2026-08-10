#include "iecode/io/binary_utils.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <fmt/format.h>

// Recherche de pattern acceleree via memchr + memcmp
// Significativement plus rapide que la boucle naive pour les gros buffers
// car memchr utilise les intrinseques CPU (SSE4.2/AVX2) dans les CRT modernes.

namespace iecode::io {

double entropy(std::span<const uint8_t> data) {
    if (data.empty()) return 0.0;

    // Compte la frequence de chaque octet
    std::array<size_t, 256> freq{};
    for (const auto byte : data) {
        ++freq[byte];
    }

    const auto total = static_cast<double>(data.size());
    double result = 0.0;
    for (const auto count : freq) {
        if (count == 0) continue;
        const double p = static_cast<double>(count) / total;
        result -= p * std::log2(p);
    }
    return result;
}

std::string hex_dump(std::span<const uint8_t> data, size_t max_bytes) {
    const size_t len = std::min(data.size(), max_bytes);
    std::string result;
    // Pre-allouer plus genereusement (~78 chars par ligne de 16 octets)
    result.reserve((len / 16 + 1) * 80);

    for (size_t i = 0; i < len; i += 16) {
        // Offset
        result += fmt::format("{:08x}  ", i);

        // Octets hex
        for (size_t j = 0; j < 16; ++j) {
            if (i + j < len) {
                result += fmt::format("{:02x} ", data[i + j]);
            } else {
                result += "   ";
            }
            if (j == 7) result += ' ';
        }

        // Caracteres ASCII
        result += " |";
        for (size_t j = 0; j < 16 && (i + j) < len; ++j) {
            const auto c = data[i + j];
            result += (c >= 0x20 && c < 0x7F) ? static_cast<char>(c) : '.';
        }
        result += "|\n";
    }

    if (data.size() > max_bytes) {
        result += fmt::format("... ({} octets restants)\n", data.size() - max_bytes);
    }

    return result;
}

std::optional<size_t> find_pattern(std::span<const uint8_t> haystack,
                                    std::span<const uint8_t> needle) {
    if (needle.empty() || needle.size() > haystack.size()) return std::nullopt;

    // Strategie : utiliser memchr pour trouver le premier octet du needle,
    // puis memcmp pour verifier le reste. memchr est optimise par le CRT
    // MSVC (ucrt) avec des intrinseques SIMD (SSE2/AVX2 selon le CPU).
    const uint8_t first = needle[0];
    const auto* p = haystack.data();
    const auto* end = p + haystack.size() - needle.size() + 1;

    while (p < end) {
        // memchr cherche le premier octet correspondant dans le buffer restant
        const auto* found = static_cast<const uint8_t*>(
            std::memchr(p, first, static_cast<size_t>(end - p)));

        if (!found) return std::nullopt;

        // Verifier le reste du pattern
        if (std::memcmp(found, needle.data(), needle.size()) == 0) {
            return static_cast<size_t>(found - haystack.data());
        }

        p = found + 1;
    }

    return std::nullopt;
}

} // namespace iecode::io
