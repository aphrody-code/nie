#pragma once

/// @file mod_scanner.h
/// Detection et scan de mods dans un dossier.

#include "iecode/modding/mod_info.h"

#include <filesystem>
#include <future>
#include <vector>

namespace iecode::modding {

/// Options de scan de mods.
struct ScanOptions {
    bool top_level_dirs_are_mods = true;
};

/// Resultat d'une comparaison entre deux scans.
struct ScanDiff {
    std::vector<ModInfo> added;     // Mods presents dans current mais pas previous
    std::vector<ModInfo> removed;   // Mods presents dans previous mais pas current
    std::vector<ModInfo> modified;  // Mods dont les metadonnees ont change

    /// Retourne true si au moins un changement a ete detecte.
    [[nodiscard]] bool has_changes() const noexcept {
        return !added.empty() || !removed.empty() || !modified.empty();
    }
};

/// Scanne un dossier pour y trouver les mods (sous-dossiers).
/// @param mods_dir  dossier contenant les mods
/// @param options   options de scan
/// @return liste des mods detectes, tries par nom
[[nodiscard]] std::vector<ModInfo> scan_mods(
    const std::filesystem::path& mods_dir,
    const ScanOptions& options = {});

/// Version asynchrone de scan_mods.
/// @param mods_dir  dossier contenant les mods (copie intentionnelle)
/// @param options   options de scan (copie intentionnelle)
/// @return future sur la liste des mods detectes
[[nodiscard]] std::future<std::vector<ModInfo>> scan_mods_async(
    std::filesystem::path mods_dir,
    ScanOptions options = {});

/// Charge les metadonnees d'un mod depuis mod_data.json.
/// @param mod_dir  dossier racine du mod
/// @return metadonnees (champs vides si le fichier est absent)
[[nodiscard]] ModMetadata load_mod_metadata(const std::filesystem::path& mod_dir);

/// Verifie si un mod contient des fichiers dans le dossier packs/.
/// @param mod  informations du mod
/// @return true si le mod touche au dossier packs/
[[nodiscard]] bool mod_touches_packs(const ModInfo& mod);

/// Compare deux scans et retourne les differences.
/// Detecte les ajouts, suppressions et modifications (display_name ou mod_version change).
/// @param previous  scan precedent
/// @param current   scan actuel
/// @return differences entre les deux scans
[[nodiscard]] ScanDiff diff_scans(
    const std::vector<ModInfo>& previous,
    const std::vector<ModInfo>& current);

} // namespace iecode::modding
