#pragma once

/// @file steam_helper.h
/// Detection automatique du chemin Steam et du jeu.
///
/// Meilleur que le C# : supporte Steam Flatpak Linux, parse VDF a la main,
/// et valide le dossier du jeu (nie.exe + data/).

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace iecode::modding {

/// Resultat de detection du chemin Steam.
struct SteamDetectionResult {
    std::filesystem::path game_path;     // chemin complet vers le dossier du jeu
    std::filesystem::path steam_path;    // racine Steam
    std::string library_folder;          // dossier de bibliotheque contenant le jeu
    bool auto_detected = false;
};

/// Detecte automatiquement le chemin d'installation du jeu Steam.
/// AppID cible : 2799860 (Inazuma Eleven: Victory Road)
/// @param app_id  identifiant Steam de l'application
/// @return chemin detecte, ou nullopt si introuvable
[[nodiscard]] std::optional<SteamDetectionResult> detect_game_path(
    uint32_t app_id = 2799860);

/// Trouve le dossier d'installation de Steam.
/// Windows : lit HKCU\Software\Valve\Steam + HKLM\... + répertoires système de l'hôte
/// Linux : ~/.steam/steam, ~/.local/share/Steam, flatpak paths
[[nodiscard]] std::optional<std::filesystem::path> find_steam_install();

/// Parse libraryfolders.vdf et retourne tous les dossiers de bibliotheque.
/// @param steam_root  racine Steam
/// @return liste des dossiers de bibliotheque (steamapps inclus)
[[nodiscard]] std::vector<std::filesystem::path> get_library_folders(
    const std::filesystem::path& steam_root);

/// Verifie qu'un dossier de jeu est valide (contient nie.exe + data/).
/// @param path  chemin du dossier du jeu
/// @return true si le dossier contient les fichiers attendus
[[nodiscard]] bool validate_game_path(const std::filesystem::path& path);

} // namespace iecode::modding
