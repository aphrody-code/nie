#include "iecode/compression/huffman.h"

#include <spdlog/spdlog.h>

#include <cstddef>

namespace iecode::compression {

namespace {

/// Taille minimale du header Level-5 (methode + taille 24-bit).
constexpr size_t HEADER_SIZE = 4;

/// Lit la taille decompressee depuis le header Level-5.
/// Octets 1-3 = taille 24-bit LE. Si == 0, octets 4-7 = taille 32-bit LE.
/// Retourne aussi le nombre d'octets consommes par le header (4 ou 8).
struct HeaderInfo {
    uint32_t decompressed_size;
    size_t header_bytes; // 4 ou 8
};

[[nodiscard]] std::optional<HeaderInfo>
parse_header(std::span<const uint8_t> data) {
    if (data.size() < HEADER_SIZE) {
        spdlog::error("huffman: donnees trop courtes pour le header ({} < {})",
                      data.size(), HEADER_SIZE);
        return std::nullopt;
    }

    uint32_t size_24 = static_cast<uint32_t>(data[1]) |
                        (static_cast<uint32_t>(data[2]) << 8) |
                        (static_cast<uint32_t>(data[3]) << 16);

    if (size_24 != 0) {
        return HeaderInfo{size_24, 4};
    }

    // Taille etendue sur 32 bits
    if (data.size() < 8) {
        spdlog::error("huffman: donnees trop courtes pour le header etendu ({} < 8)",
                      data.size());
        return std::nullopt;
    }

    uint32_t size_32 = static_cast<uint32_t>(data[4]) |
                        (static_cast<uint32_t>(data[5]) << 8) |
                        (static_cast<uint32_t>(data[6]) << 16) |
                        (static_cast<uint32_t>(data[7]) << 24);

    return HeaderInfo{size_32, 8};
}

/// Noeud de l'arbre Huffman.
struct HuffmanNode {
    uint8_t value = 0;
    bool is_leaf  = false;
    int left      = -1; // Index enfant gauche
    int right     = -1; // Index enfant droit
};

/// Construit l'arbre Huffman depuis la table Nintendo/Level-5.
///
/// Format de la table (spec GBATEK) :
/// - Octet 0 = tree_size : la table d'arbre occupe (tree_size + 1) * 2 octets
///   apres cet octet.
/// - Octets 1..(tree_size+1)*2 = noeuds de l'arbre
///
/// Chaque noeud interne est encode sur un octet :
/// - Bit 7 : enfant gauche est une feuille (data node)
/// - Bit 6 : enfant droit est une feuille (data node)
/// - Bits 0-5 : offset relatif vers la paire d'enfants
///
/// Feuilles : l'octet contient directement la valeur du symbole.
///
/// @param tree_data Donnees commencant par l'octet tree_size.
/// @param tree_table_size [out] Taille totale de la table d'arbre (y compris
///        l'octet tree_size) en octets.
[[nodiscard]] std::optional<std::vector<HuffmanNode>>
build_tree(std::span<const uint8_t> tree_data, size_t& tree_table_size) {
    if (tree_data.empty()) {
        spdlog::error("huffman: table d'arbre vide");
        return std::nullopt;
    }

    const size_t tree_size = tree_data[0];
    // La table d'arbre (apres l'octet tree_size) fait (tree_size + 1) * 2 octets.
    const size_t tree_bytes = (tree_size + 1) * 2;
    tree_table_size = 1 + tree_bytes; // +1 pour l'octet tree_size lui-meme

    if (tree_data.size() < tree_table_size) {
        spdlog::error("huffman: table d'arbre tronquee ({} < {})",
                      tree_data.size(), tree_table_size);
        return std::nullopt;
    }

    // On alloue tous les noeuds dans un vecteur plat.
    // L'index 0 = racine, situe a tree_data[1].
    std::vector<HuffmanNode> nodes;
    nodes.reserve(tree_bytes + 1);

    // Construction iterative avec une pile.
    // On travaille avec les offsets dans tree_data (base 1).
    struct BuildEntry {
        size_t data_offset; // Position dans tree_data (1 = racine)
        int node_index;     // Index dans le vecteur nodes
    };

    // Creer la racine
    nodes.push_back(HuffmanNode{});
    std::vector<BuildEntry> stack;
    stack.push_back({1, 0});

    while (!stack.empty()) {
        auto [data_off, node_idx] = stack.back();
        stack.pop_back();

        if (data_off >= tree_table_size) {
            spdlog::error("huffman: offset d'arbre hors limites ({} >= {})",
                          data_off, tree_table_size);
            return std::nullopt;
        }

        const uint8_t node_byte = tree_data[data_off];
        const bool left_is_leaf  = (node_byte & 0x80) != 0;
        const bool right_is_leaf = (node_byte & 0x40) != 0;
        const size_t offset      = node_byte & 0x3F;

        // Position de base pour les enfants :
        // L'offset est relatif a la paire contenant ce noeud.
        // Base = (data_off & ~1) + (offset + 1) * 2
        const size_t base = (data_off & ~static_cast<size_t>(1)) + (offset + 1) * 2;
        const size_t left_off  = base;
        const size_t right_off = base + 1;

        if (right_off >= tree_table_size) {
            spdlog::error("huffman: enfants hors limites (left={}, right={}, max={})",
                          left_off, right_off, tree_table_size - 1);
            return std::nullopt;
        }

        // Enfant gauche
        const int left_idx = static_cast<int>(nodes.size());
        if (left_is_leaf) {
            nodes.push_back(HuffmanNode{.value = tree_data[left_off], .is_leaf = true});
        } else {
            nodes.push_back(HuffmanNode{});
            stack.push_back({left_off, left_idx});
        }
        nodes[static_cast<size_t>(node_idx)].left = left_idx;

        // Enfant droit
        const int right_idx = static_cast<int>(nodes.size());
        if (right_is_leaf) {
            nodes.push_back(HuffmanNode{.value = tree_data[right_off], .is_leaf = true});
        } else {
            nodes.push_back(HuffmanNode{});
            stack.push_back({right_off, right_idx});
        }
        nodes[static_cast<size_t>(node_idx)].right = right_idx;
    }

    return nodes;
}

/// Decompression Huffman generique (4-bit ou 8-bit).
/// @param data Donnees completes incluant le header Level-5.
/// @param bits_per_symbol 4 pour Huffman4, 8 pour Huffman8.
[[nodiscard]] std::optional<std::vector<uint8_t>>
huffman_decompress_impl(std::span<const uint8_t> data, int bits_per_symbol) {
    // Parser le header Level-5
    auto header = parse_header(data);
    if (!header) return std::nullopt;

    const auto [decompressed_size, header_bytes] = *header;
    if (decompressed_size == 0) return std::vector<uint8_t>{};

    // Verifier qu'il reste assez de donnees pour la table d'arbre
    auto tree_start = data.subspan(header_bytes);
    if (tree_start.empty()) {
        spdlog::error("huffman: pas de donnees apres le header");
        return std::nullopt;
    }

    // Construire l'arbre Huffman
    size_t tree_table_size = 0;
    auto tree_opt = build_tree(tree_start, tree_table_size);
    if (!tree_opt) return std::nullopt;
    const auto& nodes = *tree_opt;

    if (nodes.empty()) {
        spdlog::error("huffman: arbre vide");
        return std::nullopt;
    }

    // Le bitstream commence apres le header Level-5 + la table d'arbre.
    // La table d'arbre fait tree_table_size octets (1 octet tree_size + donnees).
    const size_t bitstream_offset = header_bytes + tree_table_size;

    if (bitstream_offset >= data.size()) {
        spdlog::error("huffman: pas de bitstream apres l'arbre");
        return std::nullopt;
    }

    auto bitstream = data.subspan(bitstream_offset);

    // Decompression — pre-allouer la sortie a la taille exacte
    std::vector<uint8_t> output(decompressed_size);
    size_t out_pos = 0;

    size_t bit_pos   = 0; // Position dans le bitstream (en bits)
    int current_node = 0; // Index du noeud courant (commence a la racine)

    // Nombre de symboles a decoder
    // Pour 4-bit : 2 symboles par octet de sortie
    // Pour 8-bit : 1 symbole par octet de sortie
    const size_t total_symbols =
        (bits_per_symbol == 4) ? static_cast<size_t>(decompressed_size) * 2
                               : static_cast<size_t>(decompressed_size);

    size_t symbols_decoded = 0;
    uint8_t pending_nibble = 0;
    bool has_pending       = false;

    // Cache du mot 32-bit courant pour eviter de le reconstruire a chaque bit
    uint32_t cached_word = 0;
    size_t cached_word_idx = SIZE_MAX; // Sentinelle : force le premier chargement

    while (symbols_decoded < total_symbols) {
        // Lire le bit courant
        const size_t byte_idx = bit_pos / 8;

        if (byte_idx >= bitstream.size()) [[unlikely]] {
            spdlog::error("huffman: bitstream tronque a la position {}", bit_pos);
            output.resize(out_pos);
            return std::nullopt;
        }

        // Les bits sont lus du MSB vers le LSB dans chaque mot de 32 bits,
        // mais les mots sont lus en little-endian.
        // On recharge le mot 32-bit LE seulement quand on change de mot.
        const size_t word_idx = byte_idx / 4;
        if (word_idx != cached_word_idx) [[unlikely]] {
            cached_word_idx = word_idx;
            const size_t word_start = word_idx * 4;
            // Reconstituer le mot 32-bit LE
            cached_word = 0;
            for (size_t i = 0; i < 4 && (word_start + i) < bitstream.size(); ++i) {
                cached_word |= static_cast<uint32_t>(bitstream[word_start + i]) << (i * 8);
            }
        }

        // Position du bit dans le mot (31 = MSB, 0 = LSB)
        const size_t bit_in_word = (bit_pos % 32);
        const bool bit_value = (cached_word >> (31 - bit_in_word)) & 1;

        bit_pos++;

        // Traverser l'arbre
        if (bit_value) {
            current_node = nodes[static_cast<size_t>(current_node)].right;
        } else {
            current_node = nodes[static_cast<size_t>(current_node)].left;
        }

        if (current_node < 0 || static_cast<size_t>(current_node) >= nodes.size()) [[unlikely]] {
            spdlog::error("huffman: noeud invalide {}", current_node);
            output.resize(out_pos);
            return std::nullopt;
        }

        // Feuille atteinte : emettre le symbole
        if (nodes[static_cast<size_t>(current_node)].is_leaf) {
            const uint8_t symbol = nodes[static_cast<size_t>(current_node)].value;

            if (bits_per_symbol == 4) {
                // Huffman 4-bit : deux nibbles par octet de sortie.
                // Premier symbole = nibble bas, second = nibble haut.
                if (!has_pending) {
                    pending_nibble = symbol & 0x0F;
                    has_pending = true;
                } else {
                    const uint8_t out_byte =
                        static_cast<uint8_t>(pending_nibble | ((symbol & 0x0F) << 4));
                    output[out_pos++] = out_byte;
                    has_pending = false;
                }
            } else {
                // Huffman 8-bit : un symbole = un octet
                output[out_pos++] = symbol;
            }

            symbols_decoded++;
            current_node = 0; // Retour a la racine
        }
    }

    // Verification de la taille finale
    if (out_pos != decompressed_size) {
        spdlog::warn("huffman: taille decompressée inattendue ({} != {})",
                     out_pos, decompressed_size);
        output.resize(out_pos);
    }

    return output;
}

} // namespace

std::optional<std::vector<uint8_t>>
huffman4_decompress(std::span<const uint8_t> data) {
    return huffman_decompress_impl(data, 4);
}

std::optional<std::vector<uint8_t>>
huffman8_decompress(std::span<const uint8_t> data) {
    return huffman_decompress_impl(data, 8);
}

} // namespace iecode::compression
