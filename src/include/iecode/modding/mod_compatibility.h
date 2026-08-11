#pragma once

/// @file mod_compatibility.h
/// Verification de compatibilite des mods avec la version du jeu.

#include "iecode/modding/mod_info.h"

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace iecode::modding {

/// Resultat de compatibilite pour un mod.
struct CompatibilityResult {
    bool compatible = true;
    std::string mod_name;
    std::string mod_game_version;       // version du jeu ciblee par le mod
    std::string current_game_version;   // version installee du jeu
    std::string reason;                 // explication lisible
};

/// Verifie la compatibilite de chaque mod avec la version du jeu.
/// Un mod sans game_version est considere compatible (pas de contrainte).
///
/// Supporte les formats de version :
///   - exact : "5.00.24.00"
///   - prefixe wildcard : "5.00.x", "5.x"
///   - operateur : ">=5.00.24.00", "<=5.00.24.00"
///
/// @param mods          liste des mods a verifier (seuls les enabled)
/// @param game_version  version installee du jeu
/// @return un resultat par mod
[[nodiscard]] std::vector<CompatibilityResult> check_compatibility(
    const std::vector<ModInfo>& mods,
    const std::string& game_version);

/// Detecte la version du jeu depuis le dossier d'installation.
/// Tente dans l'ordre :
///   1. Lire la version depuis Steam appmanifest_2799860.acf
///   2. Lire le version info de nie.exe (Windows PE)
///   3. Retourner la version connue par defaut ("5.00.24.00")
///
/// @param game_path  chemin du dossier du jeu
/// @return version detectee, ou nullopt si tout echoue
[[nodiscard]] std::optional<std::string> detect_game_version(
    const std::filesystem::path& game_path);

} // namespace iecode::modding
