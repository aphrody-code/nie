#include "iecode/compression/lz10.h"

#include <algorithm>
#include <cstring>

namespace iecode::compression {

bool is_lz10(std::span<const uint8_t> data) {
    // Le header LZ10 commence par l'octet 0x10
    if (data.size() < 4) return false;
    return data[0] == 0x10;
}

std::vector<uint8_t> lz10_decompress(std::span<const uint8_t> data) {
    if (!is_lz10(data)) return {};

    // Taille decompresse sur 3 octets LE apres le magic byte
    const uint32_t decompressed_size =
        static_cast<uint32_t>(data[1]) |
        (static_cast<uint32_t>(data[2]) << 8) |
        (static_cast<uint32_t>(data[3]) << 16);

    if (decompressed_size == 0) return {};

    std::vector<uint8_t> output;
    output.reserve(decompressed_size);

    // Fenetre glissante de 4096 octets
    constexpr size_t WINDOW_SIZE = 0x1000;
    uint8_t window[WINDOW_SIZE] = {};
    size_t win_pos = 0;

    size_t src_pos = 4; // Apres le header de 4 octets
    uint8_t flags = 0;
    uint8_t mask = 0;  // 0 force la lecture du premier flag byte

    while (output.size() < decompressed_size) {
        // Lire un nouveau flag byte quand le masque est epuise
        if (mask == 0) [[unlikely]] {
            if (src_pos >= data.size()) break;
            flags = data[src_pos++];
            mask = 0x80; // MSB first
        }

        if (flags & mask) {
            // Bit a 1 : back-reference
            if (src_pos + 1 >= data.size()) [[unlikely]] break;
            const uint8_t b0 = data[src_pos++];
            const uint8_t b1 = data[src_pos++];

            const size_t length = (b0 >> 4) + 3;
            const size_t displacement = ((b0 & 0x0F) << 8 | b1) + 1;

            // Calculer la position source dans la fenetre (sans modulo dans la boucle)
            size_t src_win = (displacement <= win_pos)
                ? win_pos - displacement
                : win_pos + WINDOW_SIZE - displacement;

            // Nombre d'octets effectifs a copier
            const size_t actual = std::min(length, decompressed_size - output.size());

            // Verifier si la copie ne chevauche pas (src et dst dans la fenetre)
            // Dans la fenetre circulaire, le chevauchement se produit quand
            // displacement < actual — copie octet par octet requise
            if (displacement >= actual) [[likely]] {
                // Pas de chevauchement : copie par blocs depuis la fenetre
                const size_t old_size = output.size();
                output.resize(old_size + actual);

                // Copier depuis la fenetre vers la sortie + mettre a jour la fenetre
                if (src_win + actual <= WINDOW_SIZE) {
                    // Copie contigue dans la fenetre
                    std::memcpy(output.data() + old_size, &window[src_win], actual);
                    // Mettre a jour la fenetre
                    if (win_pos + actual <= WINDOW_SIZE) {
                        std::memcpy(&window[win_pos], &window[src_win], actual);
                    } else {
                        // La destination wrap autour de la fenetre
                        const size_t first = WINDOW_SIZE - win_pos;
                        std::memcpy(&window[win_pos], &window[src_win], first);
                        std::memcpy(&window[0], &window[src_win + first], actual - first);
                    }
                } else {
                    // La source wrap autour de la fenetre — copie en deux parties
                    const size_t first = WINDOW_SIZE - src_win;
                    std::memcpy(output.data() + old_size, &window[src_win], first);
                    std::memcpy(output.data() + old_size + first, &window[0], actual - first);
                    // Mettre a jour la fenetre
                    if (win_pos + actual <= WINDOW_SIZE) {
                        std::memcpy(&window[win_pos], output.data() + old_size, actual);
                    } else {
                        const size_t f2 = WINDOW_SIZE - win_pos;
                        std::memcpy(&window[win_pos], output.data() + old_size, f2);
                        std::memcpy(&window[0], output.data() + old_size + f2, actual - f2);
                    }
                }
                win_pos = (win_pos + actual) % WINDOW_SIZE;
            } else {
                // Chevauchement : copie octet par octet (run-length repetition)
                for (size_t i = 0; i < actual; ++i) {
                    const uint8_t byte = window[src_win];
                    output.push_back(byte);
                    window[win_pos] = byte;
                    win_pos = (win_pos + 1) % WINDOW_SIZE;
                    src_win = (src_win + 1) % WINDOW_SIZE;
                }
            }
        } else {
            // Bit a 0 : octet litteral
            if (src_pos >= data.size()) [[unlikely]] break;
            const uint8_t byte = data[src_pos++];
            output.push_back(byte);
            window[win_pos] = byte;
            win_pos = (win_pos + 1) % WINDOW_SIZE;
        }

        mask >>= 1;
    }

    return output;
}

} // namespace iecode::compression
