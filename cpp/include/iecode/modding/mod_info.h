#pragma once

/// @file mod_info.h
/// Structures partagees pour le systeme de modding.

#include <atomic>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace iecode::modding {

/// Dependance d'un mod vers un autre mod.
struct ModDependency {
    std::string mod_name;       // nom du mod requis
    std::string min_version;    // version minimum (semver), optionnel
    std::string max_version;    // version maximum (semver), optionnel
    bool optional = false;      // dependance souple (avertissement uniquement)
};

/// Metadonnees d'un mod (lues depuis mod_data.json).
struct ModMetadata {
    std::string display_name;
    std::string author;
    std::string mod_version;
    std::string game_version;
    std::string mod_link;
    std::vector<ModDependency> dependencies;    // dependances vers d'autres mods
};

/// Informations sur un mod detecte dans un dossier.
struct ModInfo {
    std::string name;
    std::filesystem::path path;
    bool enabled = true;
    ModMetadata metadata;

    /// Retourne le chemin complet du mod.
    [[nodiscard]] const std::filesystem::path& full_path() const noexcept { return path; }
};

/// Entree d'un mod dans un profil.
struct ModProfileEntry {
    std::string name;
    bool enabled = true;
    std::string mod_link;
};

/// Profil de configuration de mods.
struct ModProfile {
    std::string name;
    std::string created_at;
    std::string last_modified;
    std::vector<ModProfileEntry> mods;
    std::string selected_cpk_name;
};

/// Enregistrement de la derniere installation de mods.
struct LastInstallRecord {
    std::filesystem::path game_path;
    std::vector<std::string> installed_mods;
    std::vector<std::string> installed_files;
    std::string applied_at;
    std::string selected_cpk_name;
};

/// Token d'annulation partage entre le thread principal et les operations async.
struct CancellationToken {
    std::shared_ptr<std::atomic<bool>> cancelled =
        std::make_shared<std::atomic<bool>>(false);

    void cancel() noexcept { cancelled->store(true, std::memory_order_relaxed); }
    [[nodiscard]] bool is_cancelled() const noexcept {
        return cancelled->load(std::memory_order_relaxed);
    }
};

/// Etape d'installation en cours.
enum class InstallStage {
    Merging,   // fusion des mods
    Packing,   // mise a jour cpk_list.cfg.bin
    Copying,   // copie vers game_path
    Cleanup,   // nettoyage temp
    Done,
    Error
};

/// Evenement de progression structure pour l'installation.
struct ProgressEvent {
    InstallStage stage = InstallStage::Merging;
    int percent = 0;             // 0-100 global
    std::string current_file;    // fichier en cours (peut etre vide)
    std::string current_mod;     // mod en cours de merge (peut etre vide)
    size_t files_done = 0;
    size_t files_total = 0;
};

} // namespace iecode::modding
