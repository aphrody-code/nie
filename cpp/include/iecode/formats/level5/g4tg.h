#pragma once

/// @file g4tg.h
/// Companion GPU data pour les textures G4TX.
/// Contient les donnees brutes DX11 subresource / mip tail, sans header.

#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <vector>

namespace iecode::level5 {

/// Fichier G4TG — donnees GPU brutes companion d'un .g4tx.
struct G4Tg {
    std::vector<uint8_t> gpu_data;

    [[nodiscard]] size_t size() const noexcept { return gpu_data.size(); }
};

/// Parse un .g4tg depuis un span brut (copie les donnees).
[[nodiscard]] std::optional<G4Tg> g4tg_load(std::span<const uint8_t> data);

/// Charge le .g4tg companion du meme stem qu'un .g4tx (meme repertoire).
/// Retourne nullopt si aucun companion n'existe.
[[nodiscard]] std::optional<G4Tg> g4tg_load_companion(
    const std::filesystem::path& g4tx_path);

/// Teste si un .g4tg companion existe pour un .g4tx donne.
[[nodiscard]] bool g4tg_has_companion(const std::filesystem::path& g4tx_path);

} // namespace iecode::level5
