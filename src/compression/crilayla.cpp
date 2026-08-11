#include "iecode/compression/crilayla.h"

#include <algorithm>
#include <cstring>

namespace iecode::compression {

namespace {

/// Taille minimale d'un bloc CRILAYLA : header 16 octets + prefixe 0x100 octets.
constexpr size_t CRILAYLA_MIN_SIZE = 0x10 + 0x100;

/// Taille du prefixe non compresse copie au debut de la sortie.
constexpr size_t CRILAYLA_PREFIX_SIZE = 0x100;

/// Lecture little-endian d'un uint32 depuis un span.
[[nodiscard]] inline uint32_t crilayla_read_u32_le(
    std::span<const uint8_t> data, size_t offset) noexcept {
    return static_cast<uint32_t>(data[offset])
         | (static_cast<uint32_t>(data[offset + 1]) << 8)
         | (static_cast<uint32_t>(data[offset + 2]) << 16)
         | (static_cast<uint32_t>(data[offset + 3]) << 24);
}

/// Lecteur de bits avec accumulateur 64-bit (lecture a rebours).
/// Pre-charge jusqu'a 8 octets pour eviter la lecture bit par bit.
struct CrilaylaBitReader {
    const uint8_t* base;   // Debut du bloc compresse (offset 0x10 dans le fichier)
    size_t byte_pos;       // Position courante (prochain octet a consommer, decroit)
    uint64_t accumulator;  // Bits pre-charges
    int bits_available;    // Nombre de bits valides dans l'accumulateur

    /// Recharge l'accumulateur avec autant d'octets que possible.
    inline void refill() noexcept {
        while (bits_available <= 56 && byte_pos > 0) {
            --byte_pos;
            // Nouveaux bits entrent par le bas, anciens restent en haut
            accumulator |= static_cast<uint64_t>(base[byte_pos])
                           << (56 - bits_available);
            bits_available += 8;
        }
    }

    /// Lit @p count bits depuis le flux (1..32).
    [[nodiscard]] inline uint32_t read_bits(int count) noexcept {
        if (bits_available < count) {
            refill();
        }

        if (bits_available < count) [[unlikely]] {
            // Plus assez de donnees — retourne les bits restants
            if (bits_available <= 0) return 0;
            count = bits_available;
            const uint32_t result = static_cast<uint32_t>(accumulator >> (64 - count));
            accumulator = 0;
            bits_available = 0;
            return result;
        }

        const uint32_t result = static_cast<uint32_t>(accumulator >> (64 - count));
        accumulator <<= count;
        bits_available -= count;
        return result;
    }
};

} // namespace

bool is_crilayla(std::span<const uint8_t> data) {
    if (data.size() < 8) return false;
    return std::memcmp(data.data(), "CRILAYLA", 8) == 0;
}

std::vector<uint8_t> crilayla_decompress(std::span<const uint8_t> data) {
    if (!is_crilayla(data)) return {};
    if (data.size() < CRILAYLA_MIN_SIZE) return {};

    // --- Lecture du header (16 octets) ---
    // Octets 8-11 : taille decompresse de la partie compressée
    const uint32_t uncomp_size = crilayla_read_u32_le(data, 8);
    // Octets 12-15 : taille du header (offset vers le prefixe non compresse)
    const uint32_t header_size = crilayla_read_u32_le(data, 12);

    // Le prefixe non compresse (0x100 octets) commence a l'offset (header_size + 0x10)
    const size_t prefix_offset = static_cast<size_t>(header_size) + 0x10;
    if (prefix_offset + CRILAYLA_PREFIX_SIZE > data.size()) return {};

    // Taille totale de sortie
    const size_t total_output = static_cast<size_t>(uncomp_size) + CRILAYLA_PREFIX_SIZE;

    // Limite raisonnable (256 Mo) pour eviter les allocations abusives
    if (total_output > 256 * 1024 * 1024) return {};

    std::vector<uint8_t> output(total_output, 0);

    // --- Copier le prefixe non compresse au debut de la sortie ---
    std::memcpy(output.data(), data.data() + prefix_offset, CRILAYLA_PREFIX_SIZE);

    // --- Decompression LZSS a rebours ---
    // Les donnees compressees vont de l'offset 0x10 a (prefix_offset - 1).
    const size_t comp_data_offset = 0x10;
    const size_t comp_data_size = prefix_offset - comp_data_offset;

    if (comp_data_size == 0 && uncomp_size > 0) return {};

    CrilaylaBitReader reader{};
    reader.base = data.data() + comp_data_offset;
    reader.byte_pos = comp_data_size;  // Commence apres le dernier octet
    reader.accumulator = 0;
    reader.bits_available = 0;
    // Pre-charger l'accumulateur
    reader.refill();

    // Position d'ecriture : on ecrit de la fin vers le debut (dans la zone post-prefixe)
    size_t write_pos = total_output;

    while (write_pos > CRILAYLA_PREFIX_SIZE) {
        // Lire 1 bit de flag
        const uint32_t flag = reader.read_bits(1);

        if (flag == 0) [[likely]] {
            // Octet litteral : lire 8 bits, ecrire a la position courante
            const uint8_t literal = static_cast<uint8_t>(reader.read_bits(8));
            --write_pos;
            output[write_pos] = literal;
        } else {
            // Back-reference
            // Lire 13 bits pour l'offset de la reference
            const uint32_t ref_offset = reader.read_bits(13);

            // Lire la longueur avec encodage variable Fibonacci-style
            uint32_t length = 3; // Longueur minimale de copie

            // Premiere passe : 2 bits
            uint32_t val = reader.read_bits(2);
            length += val;
            if (val == 3) {
                // Deuxieme passe : 3 bits
                val = reader.read_bits(3);
                length += val;
                if (val == 7) {
                    // Troisieme passe : 5 bits
                    val = reader.read_bits(5);
                    length += val;
                    if (val == 31) {
                        // Passes supplementaires : 8 bits tant que val == 255
                        for (;;) {
                            val = reader.read_bits(8);
                            length += val;
                            if (val != 255) break;
                        }
                    }
                }
            }

            // Copier les octets depuis la reference (en arriere dans la sortie).
            // La source est a (write_pos + ref_offset + 2) — toujours en avant
            // de la position d'ecriture. Copie octet par octet car chaque ecriture
            // change la position source relative.
            for (uint32_t i = 0; i < length; ++i) {
                if (write_pos == 0) break;
                --write_pos;
                const size_t src_pos = write_pos + ref_offset + 2;
                if (src_pos >= total_output) [[unlikely]] {
                    output[write_pos] = 0;
                } else {
                    output[write_pos] = output[src_pos];
                }
            }
        }
    }

    return output;
}

} // namespace iecode::compression
