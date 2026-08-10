#pragma once

/// @file profile_manager.h
/// Gestion des profils de mods (sauvegarde/chargement JSON).

#include "iecode/modding/mod_info.h"

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace iecode::modding {

/// Gestionnaire de profils de mods.
/// Stocke et charge des profils au format JSON dans un dossier dedie.
class ProfileManager {
public:
    /// @param profiles_dir  dossier contenant les fichiers de profils
    explicit ProfileManager(std::filesystem::path profiles_dir);

    /// Liste tous les profils disponibles, tries par date de modification decroissante.
    [[nodiscard]] std::vector<ModProfile> list_profiles() const;

    /// Charge un profil par nom. Retourne nullopt si absent ou invalide.
    [[nodiscard]] std::optional<ModProfile> load_profile(const std::string& name) const;

    /// Sauvegarde un profil (cree ou ecrase).
    /// Met a jour le champ last_modified automatiquement.
    bool save_profile(ModProfile profile);

    /// Supprime un profil par nom. Retourne true si le fichier existait.
    bool delete_profile(const std::string& name);

    /// Verifie si un profil avec ce nom existe.
    [[nodiscard]] bool profile_exists(const std::string& name) const;

private:
    std::filesystem::path profiles_dir_;

    /// Construit le chemin du fichier JSON pour un profil donne.
    [[nodiscard]] std::filesystem::path profile_path(const std::string& name) const;

    /// Nettoie un nom pour l'utiliser comme nom de fichier.
    [[nodiscard]] static std::string sanitize_filename(const std::string& name);
};

} // namespace iecode::modding
