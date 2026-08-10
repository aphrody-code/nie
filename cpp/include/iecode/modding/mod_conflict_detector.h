#pragma once

/// @file mod_conflict_detector.h
/// Detection de conflits entre mods (fichiers en commun).

#include "iecode/modding/mod_info.h"

#include <future>
#include <string>
#include <unordered_map>
#include <vector>

namespace iecode::modding {

/// Rapport de conflits entre mods.
struct ConflictReport {
    /// Chemin relatif depuis data/ -> liste des noms de mods en conflit.
    std::unordered_map<std::string, std::vector<std::string>> conflicts;

    /// Retourne true s'il y a au moins un conflit.
    [[nodiscard]] bool has_conflicts() const noexcept { return !conflicts.empty(); }

    /// Nombre de fichiers en conflit.
    [[nodiscard]] size_t count() const noexcept { return conflicts.size(); }
};

/// Detecte les conflits entre les mods actives.
/// Un conflit existe quand deux mods ou plus contiennent le meme fichier
/// relatif dans leur sous-dossier data/.
///
/// @param mods        liste des mods a analyser (seuls les enabled sont pris en compte)
/// @param data_subdir nom du sous-dossier de donnees (defaut "data")
/// @return rapport de conflits
[[nodiscard]] ConflictReport detect_conflicts(
    const std::vector<ModInfo>& mods,
    const std::string& data_subdir = "data");

/// Version asynchrone de detect_conflicts.
/// @param mods        liste des mods (copie intentionnelle)
/// @param data_subdir nom du sous-dossier de donnees (copie intentionnelle)
/// @return future sur le rapport de conflits
[[nodiscard]] std::future<ConflictReport> detect_conflicts_async(
    std::vector<ModInfo> mods,
    std::string data_subdir = "data");

} // namespace iecode::modding
