#include "iecode/formats/level5/texture_swizzler.h"

#include <spdlog/spdlog.h>
#include <algorithm>
#include <cstring>

namespace iecode::level5 {

// ── Tegra X1 Block-Linear Deswizzle ────────────────────────────────
//
// Le GPU Tegra X1 (et les GPUs NVIDIA en general) utilisent un layout
// "block-linear" pour les textures en memoire, qui differe du layout
// lineaire row-major standard.
//
// Hierarchie du layout:
//   Pixel → GOB (Group of Bytes) → Block → Surface
//
// Un GOB (Group of Bytes) = 512 octets = 8 lignes x 64 octets.
//   - C'est l'unite atomique de swizzle.
//   - A l'interieur d'un GOB, les octets sont rearranges selon un
//     pattern fixe (bits x/y sont entrelaces).
//
// Un Block = GOB_WIDTH (1) x block_height GOBs empiles verticalement.
//   - block_height typique pour Tegra X1 = 16 GOBs (donc 128 lignes).
//   - block_height peut varier : min(ceil(height / 8), 16).
//
// L'algorithme inverse le mapping : pour chaque position lineaire (x, y),
// on calcule l'adresse swizzled source.

/// Largeur d'un GOB en octets.
static constexpr int GOB_WIDTH_BYTES = 64;

/// Hauteur d'un GOB en lignes.
static constexpr int GOB_HEIGHT = 8;

/// Taille d'un GOB en octets (64 * 8 = 512).
static constexpr int GOB_SIZE = GOB_WIDTH_BYTES * GOB_HEIGHT;

/// Calcule le block_height optimal pour une hauteur donnee.
/// Le block_height est la puissance de 2 la plus proche de ceil(height / GOB_HEIGHT),
/// plafonnee a 16.
static int swizzle_compute_block_height(int height) {
    // Nombre de GOBs necessaires verticalement
    int gob_count = (height + GOB_HEIGHT - 1) / GOB_HEIGHT;

    // Plus grande puissance de 2 <= gob_count, plafonnee a 16
    int bh = 1;
    while (bh < 16 && bh * 2 <= gob_count) {
        bh *= 2;
    }
    return bh;
}

/// Calcule l'offset d'un octet dans le layout block-linear Tegra X1.
///
/// @param x       Position horizontale en octets (pas en pixels)
/// @param y       Position verticale en lignes
/// @param width   Largeur de la surface en octets
/// @param height  Hauteur de la surface en lignes
/// @param bh      Block height en nombre de GOBs
/// @return        Offset dans le buffer swizzled
static size_t swizzle_offset(int x, int y, int width, int /*height*/, int bh) {
    // Nombre de GOBs par ligne
    const int gobs_per_row = (width + GOB_WIDTH_BYTES - 1) / GOB_WIDTH_BYTES;

    // Hauteur d'un block complet en lignes
    const int block_height_lines = bh * GOB_HEIGHT;

    // Quel block (verticalement) ?
    const int block_y = y / block_height_lines;

    // Position dans le block
    const int y_in_block = y % block_height_lines;

    // Quel GOB dans le block (verticalement) ?
    const int gob_y = y_in_block / GOB_HEIGHT;

    // Position dans le GOB
    const int y_in_gob = y_in_block % GOB_HEIGHT;

    // Quel GOB horizontalement ?
    const int gob_x = x / GOB_WIDTH_BYTES;

    // Position dans le GOB horizontalement
    const int x_in_gob = x % GOB_WIDTH_BYTES;

    // ── Calcul de l'adresse swizzled ────────────────────────────────
    //
    // Organisation memoire :
    //   blocks sont ranges de haut en bas, puis de gauche a droite.
    //   Dans un block, les GOBs sont ranges par colonne, puis par rangee
    //   de GOBs.
    //
    //   offset = block_offset + gob_offset_in_block + byte_offset_in_gob

    // Taille d'un block complet en octets
    const size_t block_size = static_cast<size_t>(gobs_per_row) * bh * GOB_SIZE;

    // Offset du block
    const size_t block_offset = static_cast<size_t>(block_y) * block_size;

    // Offset du GOB dans le block
    // Les GOBs dans un block sont organises : d'abord par colonne (gob_x),
    // puis par rangee de GOBs (gob_y) dans le block.
    const size_t gob_offset_in_block = (static_cast<size_t>(gob_x) * bh +
                                         static_cast<size_t>(gob_y)) *
                                        GOB_SIZE;

    // ── Adresse intra-GOB (pattern Tegra X1) ────────────────────────
    //
    // A l'interieur d'un GOB, les octets sont rearranges avec un
    // entrelacement de bits specifique au GPU.
    //
    // L'adresse intra-GOB est calculee comme suit :
    //   bit 0-3 : x[0:3]  (octets 0-15 dans la ligne du GOB)
    //   bit 4   : y[0]    (ligne paire/impaire)
    //   bit 5   : x[4]    (moitie gauche/droite des 64 octets)
    //   bit 6-8 : y[1:3]  (reste des lignes dans le GOB)
    //   bit 9   : x[5]    (jamais utilise si GOB_WIDTH = 64, mais pour completude)
    //
    // Formule simplifiee pour GOB 64x8 :
    const int intra_gob = ((x_in_gob & 0x0F))            // bits 0-3
                        | ((y_in_gob & 0x01) << 4)        // bit 4
                        | ((x_in_gob & 0x10) << 1)        // bit 5
                        | ((y_in_gob & 0x06) << 5)        // bits 6-7
                        | ((y_in_gob & ~0x07) << 6);      // bit 8+ (toujours 0 pour h=8)

    return block_offset + gob_offset_in_block + static_cast<size_t>(intra_gob);
}

std::vector<uint8_t> unswizzle(std::span<const uint8_t> data,
                                int width, int height, int bpp) {
    if (data.empty() || width <= 0 || height <= 0 || bpp <= 0) {
        spdlog::error("unswizzle: parametres invalides ({}x{}, bpp={})",
                      width, height, bpp);
        return {};
    }

    // bpp est la taille en octets par pixel (ou par bloc BCn).
    // Les valeurs typiques sont :
    //   - 4  : RGBA8 (4 octets/pixel)
    //   - 8  : BC1/BC4 (8 octets/bloc 4x4)
    //   - 16 : BC3/BC5/BC7 (16 octets/bloc 4x4)
    // Si l'appelant passe des bits (32, 64, 128), on convertit en octets.
    const int bytes_per_unit = (bpp > 16) ? bpp / 8 : bpp;

    // Largeur en octets de la surface
    const int width_bytes = width * bytes_per_unit;
    const size_t linear_size = static_cast<size_t>(width_bytes) * height;

    // Calculer le block_height optimal
    const int block_height = swizzle_compute_block_height(height);

    spdlog::debug("unswizzle: {}x{} bpp={} bytes_per_unit={} "
                  "width_bytes={} block_height={} input_size={} linear_size={}",
                  width, height, bpp, bytes_per_unit,
                  width_bytes, block_height, data.size(), linear_size);

    // Verifier que les donnees source sont suffisantes
    // Le buffer swizzled peut etre plus grand que le lineaire a cause du padding
    // des blocks incomplets. On ne verifie pas la taille exacte car elle depend
    // de l'alignement.

    std::vector<uint8_t> output(linear_size, 0);

    // ── Deswizzle optimise ──────────────────────────────────────────
    //
    // Strategie : au lieu de copier octet par octet, on calcule l'adresse
    // swizzled pour chaque "unite" (pixel ou bloc BCn) et on copie
    // bytes_per_unit octets d'un coup avec memcpy. C'est significativement
    // plus rapide pour les formats BCn (8-16x moins d'appels a swizzle_offset).

    for (int y = 0; y < height; ++y) {
        const size_t dst_row = static_cast<size_t>(y) * width_bytes;

        for (int x_unit = 0; x_unit < width; ++x_unit) {
            const int x_byte = x_unit * bytes_per_unit;
            const size_t src_offset = swizzle_offset(x_byte, y, width_bytes,
                                                      height, block_height);
            const size_t dst_offset = dst_row + static_cast<size_t>(x_byte);

            if (src_offset + bytes_per_unit <= data.size() &&
                dst_offset + bytes_per_unit <= output.size()) {
                std::memcpy(output.data() + dst_offset,
                            data.data() + src_offset,
                            static_cast<size_t>(bytes_per_unit));
            }
            // Si src_offset est hors bornes, on garde les zeros (padding)
        }
    }

    spdlog::debug("unswizzle: deswizzle termine ({} octets)", output.size());
    return output;
}

} // namespace iecode::level5
