#pragma once

/// @file texture_swizzler.h
/// Deswizzle de textures Tegra X1 block-linear (Nintendo Switch).
/// Certaines textures G4TX utilisent ce layout meme sur PC.

#include <cstdint>
#include <span>
#include <vector>

namespace iecode::level5 {

/// Deswizzle un buffer de texture du layout block-linear Tegra X1 vers lineaire.
/// @param data     Donnees swizzled
/// @param width    Largeur en pixels
/// @param height   Hauteur en pixels
/// @param bpp      Bits par pixel (ou taille de bloc pour BCn)
/// @return         Donnees lineaires, ou vecteur vide en cas d'erreur
[[nodiscard]] std::vector<uint8_t> unswizzle(std::span<const uint8_t> data,
                                              int width, int height, int bpp);

} // namespace iecode::level5
