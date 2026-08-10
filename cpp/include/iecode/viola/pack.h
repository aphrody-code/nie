#pragma once

/// @file pack.h
/// Mise a jour de cpk_list.cfg.bin pour le modding (Viola pack).
///
/// Lit le fichier cpk_list.cfg.bin du jeu, met a jour les tailles des fichiers
/// modifies/ajoutes, et re-serialise le fichier avec re-chiffrement si necessaire.
///
/// Equivalent C++ de Viola.Core.Pack.Logic.CPack (C#).

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace iecode::viola {

/// Plateforme cible (affecte les chemins de sortie).
enum class Platform {
    PC,      // data/cpk_list.cfg.bin
    Switch,  // romfs/data/cpk_list.cfg.bin
};

/// Resultat de la mise a jour du cpk_list.
struct PackResult {
    bool success = false;
    size_t files_updated = 0;   // Fichiers existants dont la taille a change
    size_t files_added = 0;     // Nouveaux fichiers ajoutes a la liste
    size_t total_entries = 0;   // Nombre total d'entrees apres mise a jour
    std::string error;          // Message d'erreur si !success
};

/// Met a jour cpk_list.cfg.bin avec les fichiers du dossier de mod.
///
/// Workflow :
///   1. Lire et dechiffrer cpk_list.cfg.bin
///   2. Parser le T2B/RDBN
///   3. Pour chaque fichier dans mod_dir : mettre a jour ou ajouter l'entree
///   4. Re-serialiser + re-chiffrer si necessaire
///   5. Ecrire au bon emplacement selon la plateforme
///
/// @param cpk_list_path  chemin vers cpk_list.cfg.bin du jeu original
/// @param mod_dir        dossier contenant les fichiers moddes
/// @param output_dir     dossier de sortie (optionnel, defaut = mod_dir parent)
/// @param platform       plateforme cible (PC ou Switch)
/// @return resultat de l'operation
[[nodiscard]] PackResult cpk_update_file_list(
    const std::filesystem::path& cpk_list_path,
    const std::filesystem::path& mod_dir,
    const std::filesystem::path& output_dir = {},
    Platform platform = Platform::PC);

} // namespace iecode::viola
