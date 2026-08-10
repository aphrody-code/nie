#pragma once

/// @file mod_installer.h
/// Installation de mods (merge + pack + copie vers le jeu).

#include "iecode/modding/mod_info.h"

#include <filesystem>
#include <functional>
#include <future>
#include <optional>
#include <string>
#include <vector>

namespace iecode::modding {

/// Plateforme cible pour l'installation.
enum class Platform { PC, Switch };

/// Options d'installation de mods.
struct InstallOptions {
    std::filesystem::path game_path;        // Dossier du jeu
    std::filesystem::path cpklist_path;     // Chemin vers cpk_list.cfg.bin
    std::filesystem::path temp_dir;         // Dossier temporaire (vide = auto)
    Platform platform = Platform::PC;
    bool do_pack = true;                    // Mettre a jour cpk_list.cfg.bin
    bool cleanup_temp = true;               // Supprimer le dossier temp apres

    /// Callback de progression structure.
    std::function<void(const ProgressEvent&)> on_progress;

    /// Token d'annulation optionnel pour interrompre l'installation.
    std::optional<CancellationToken> cancel_token;

    /// Gestionnaire de derniere installation (optionnel, non possede).
    class LastInstallManager* last_install_mgr = nullptr;
};

/// Resultat d'une installation de mods.
struct InstallResult {
    bool success = false;
    size_t mods_applied = 0;
    size_t files_merged = 0;
    size_t files_installed = 0;
    std::string error;
};

/// Installe une liste de mods dans le dossier du jeu.
///
/// Pipeline :
///   1. Merge sequentiel des mods actives dans un dossier temporaire
///   2. Pack cpk_list.cfg.bin si demande
///   3. Copie recursive du dossier temporaire vers game_path
///   4. Nettoyage du dossier temporaire
///
/// Verifie le token d'annulation entre chaque etape et retourne
/// immediatement si l'operation est annulee.
///
/// @param mods     liste des mods a installer (seuls les enabled sont traites)
/// @param options  options d'installation
/// @return resultat de l'installation
[[nodiscard]] InstallResult install_mods(
    const std::vector<ModInfo>& mods,
    const InstallOptions& options);

/// Version asynchrone de install_mods.
/// Lance l'installation dans un thread dedie.
/// @param mods     liste des mods a installer (copie intentionnelle)
/// @param options  options d'installation (copie intentionnelle)
/// @return future sur le resultat — appeler .get() pour attendre
[[nodiscard]] std::future<InstallResult> install_mods_async(
    std::vector<ModInfo> mods,
    InstallOptions options);

/// Gestionnaire de persistance de la derniere installation.
/// Sauvegarde/charge un LastInstallRecord au format JSON.
class LastInstallManager {
public:
    /// @param data_dir  dossier de stockage des donnees iecode
    explicit LastInstallManager(std::filesystem::path data_dir);

    /// Sauvegarde le dernier enregistrement d'installation.
    bool save(const LastInstallRecord& record);

    /// Charge le dernier enregistrement. Retourne nullopt si absent.
    [[nodiscard]] std::optional<LastInstallRecord> load() const;

    /// Retourne la liste des fichiers installes lors du dernier install.
    /// Utile pour nettoyer les fichiers obsoletes.
    [[nodiscard]] std::vector<std::filesystem::path> get_installed_files() const;

    /// Supprime les fichiers du dernier install qui ne sont plus dans le mod actuel.
    /// Remonte l'arborescence et supprime les dossiers vides (meilleur que C#).
    /// @param current_files  fichiers du merge actuel (chemins relatifs)
    /// @param game_path      dossier du jeu
    /// @return nombre de fichiers supprimes
    size_t cleanup_obsolete_files(
        const std::vector<std::filesystem::path>& current_files,
        const std::filesystem::path& game_path);

    /// Supprime l'enregistrement du dernier install (cas retour vanilla).
    bool clear();

    /// Verifie si la liste de mods correspond au dernier install.
    [[nodiscard]] bool mods_match_last_install(
        const std::vector<ModInfo>& mods) const;

    /// Verifie si le CPK selectionne correspond au dernier install.
    [[nodiscard]] bool cpk_matches_last_install(
        const std::string& cpk_name) const;

private:
    std::filesystem::path data_dir_;
    static constexpr const char* kFilename = "last_install.json";

    /// Chemin complet du fichier JSON.
    [[nodiscard]] std::filesystem::path json_path() const;
};

} // namespace iecode::modding
