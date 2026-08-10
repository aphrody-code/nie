#pragma once

/// @file mod_dependency.h
/// Resolution de dependances entre mods et tri topologique.

#include "iecode/modding/mod_info.h"

#include <string>
#include <vector>

namespace iecode::modding {

/// Version semantique simplifiee (major.minor.patch).
struct SemVer {
    int major = 0;
    int minor = 0;
    int patch = 0;

    /// Parse une chaine "X.Y.Z" ou "X.Y" ou "X". Retourne {0,0,0} si invalide.
    [[nodiscard]] static SemVer parse(const std::string& str);

    /// Comparaison lexicographique standard.
    [[nodiscard]] auto operator<=>(const SemVer&) const = default;

    /// Retourne true si la version est valide (au moins major > 0 ou chaine non vide).
    [[nodiscard]] bool valid() const noexcept {
        return major > 0 || minor > 0 || patch > 0;
    }
};

/// Resultat de la verification des dependances.
struct DependencyCheckResult {
    bool satisfied = true;                          // toutes les deps requises OK
    std::vector<std::string> missing;               // deps requises non trouvees
    std::vector<std::string> version_mismatch;      // trouvees mais mauvaise version
    std::vector<std::string> optional_missing;      // deps optionnelles absentes
    std::vector<std::string> install_order;          // tri topologique des noms de mods
    std::vector<std::string> circular_dependencies;  // cycles detectes
};

/// Verifie les dependances de tous les mods.
/// @param mods  liste des mods a verifier (seuls les enabled sont pris en compte)
/// @return resultat complet avec deps manquantes, erreurs de version, et ordre d'install
[[nodiscard]] DependencyCheckResult check_dependencies(
    const std::vector<ModInfo>& mods);

/// Resoud l'ordre d'installation par tri topologique.
/// Les mods sans dependances viennent en premier. Detecte les cycles.
/// @param mods  liste des mods
/// @return mods tries dans l'ordre d'installation, ou vide si cycle detecte
[[nodiscard]] std::vector<ModInfo> resolve_install_order(
    const std::vector<ModInfo>& mods);

/// Verifie si une version est dans la plage [min_version, max_version].
/// Les bornes vides sont ignorees (pas de contrainte).
/// @param version      version a verifier
/// @param min_version  version minimum (vide = pas de minimum)
/// @param max_version  version maximum (vide = pas de maximum)
/// @return true si la version est dans la plage
[[nodiscard]] bool version_in_range(
    const std::string& version,
    const std::string& min_version,
    const std::string& max_version);

} // namespace iecode::modding
