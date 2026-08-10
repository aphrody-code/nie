#pragma once

/// @file aob_scanner.h
/// Recherche de patterns d'octets (Array of Bytes) dans la memoire d'un processus.
/// Supporte les wildcards (??) et l'acceleration AVX2 quand disponible.

#ifdef _WIN32

#include "process.h"

#include <cstdint>
#include <optional>
#include <string_view>
#include <vector>

namespace iecode::memory {

/// Pattern AOB parse — chaque octet est soit une valeur fixe, soit un wildcard.
struct AobPattern {
    std::vector<uint8_t> bytes;    ///< Valeurs des octets (0 pour wildcards)
    std::vector<uint8_t> mask;     ///< 0xFF = octet fixe, 0x00 = wildcard

    /// Parse un pattern depuis une chaine hex avec wildcards.
    /// Format : "48 8B 45 ?? ?? 48 8B" ou "48 8B 45 ? ? 48 8B"
    [[nodiscard]] static std::optional<AobPattern> from_string(std::string_view pattern);

    /// Nombre d'octets dans le pattern.
    [[nodiscard]] size_t size() const noexcept { return bytes.size(); }

    /// Pattern vide ?
    [[nodiscard]] bool empty() const noexcept { return bytes.empty(); }

    /// Teste si le pattern matche a la position donnee dans le buffer.
    [[nodiscard]] bool matches_at(const uint8_t* data, size_t data_size, size_t pos) const noexcept;
};

/// Scanner AOB pour processus externe.
///
/// Usage :
/// @code
///   AobScanner scanner(process);
///   auto pattern = AobPattern::from_string("48 8B 45 ?? ?? 48 8B");
///   auto addr = scanner.find_first(*pattern);
/// @endcode
class AobScanner {
public:
    explicit AobScanner(const ProcessHandle& process);

    /// Scanne toutes les regions executables pour la premiere occurrence.
    [[nodiscard]] std::optional<uintptr_t> find_first(const AobPattern& pattern) const;

    /// Scanne toutes les regions executables pour toutes les occurrences.
    [[nodiscard]] std::vector<uintptr_t> find_all(const AobPattern& pattern) const;

    /// Scanne un range memoire specifique.
    [[nodiscard]] std::optional<uintptr_t> find_in_range(
        const AobPattern& pattern, uintptr_t start, size_t size) const;

    /// Scanne un range et retourne toutes les occurrences.
    [[nodiscard]] std::vector<uintptr_t> find_all_in_range(
        const AobPattern& pattern, uintptr_t start, size_t size) const;

    /// Resout un pointeur relatif RIP (pattern + offset → adresse absolue).
    /// Utile pour les instructions LEA/MOV avec RIP-relative addressing x86_64.
    /// @param pattern_addr Adresse ou le pattern a ete trouve
    /// @param rip_offset   Offset dans le pattern ou commence le deplacement relatif (4 octets)
    /// @param instr_len    Longueur totale de l'instruction
    [[nodiscard]] std::optional<uintptr_t> resolve_rip_relative(
        uintptr_t pattern_addr, size_t rip_offset, size_t instr_len) const;

private:
    /// Scanne un buffer local pour trouver le pattern.
    /// Retourne les offsets dans le buffer ou le pattern matche.
    [[nodiscard]] std::vector<size_t> scan_buffer(
        const uint8_t* data, size_t size, const AobPattern& pattern) const;

#ifdef IECODE_HAS_AVX2
    /// Scan AVX2 accelere — compare 32 octets a la fois.
    [[nodiscard]] std::vector<size_t> scan_buffer_avx2(
        const uint8_t* data, size_t size, const AobPattern& pattern) const;
#endif

    const ProcessHandle& process_;
};

} // namespace iecode::memory

#endif // _WIN32
