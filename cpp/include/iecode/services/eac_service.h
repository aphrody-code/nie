#pragma once

/// @file eac_service.h
/// Service de bypass EAC (Easy Anti-Cheat) pour le modding offline single-player.
///
/// Chaine de lancement du jeu :
///   Steam -> GameBootstrapper.exe -> GameBootstrapper.ini -> EACLauncher.exe -> nie.exe
///
/// Strategie de bypass (double approche) :
///   1. Modifier GameBootstrapper.ini : ApplicationPath=EACLauncher.exe -> nie.exe
///   2. Renommer EACLauncher.exe en .backup (stub optionnel)
///
/// Toutes les operations sont reversibles via restore_eac().

#include <filesystem>
#include <string>
#include <unordered_map>

namespace iecode::services {

/// Statut detaille de l'etat EAC.
struct EacStatus {
    bool ini_modified;       ///< GameBootstrapper.ini pointe vers nie.exe (pas EACLauncher.exe)
    bool launcher_backed_up; ///< EACLauncher.exe.backup existe sur disque
    bool launcher_missing;   ///< EACLauncher.exe n'existe pas sur disque
};

/// Service de gestion du bypass EAC pour Inazuma Eleven: Victory Road.
///
/// Utilise uniquement std::filesystem pour les operations fichier.
/// Pas d'exceptions dans les chemins critiques — retourne bool.
class EacService {
public:
    /// Construit le service pour le repertoire de jeu donne.
    /// @param game_dir chemin vers le dossier d'installation du jeu (contient GameBootstrapper.exe)
    explicit EacService(std::filesystem::path game_dir);

    /// Desactive EAC : modifie l'ini + backup/renomme EACLauncher.exe si present.
    /// @return false si game_dir invalide ou ecriture echouee
    [[nodiscard]] bool disable_eac();

    /// Restaure EAC : revert l'ini + restaure EACLauncher.exe depuis le backup.
    /// @return false si restauration echouee
    [[nodiscard]] bool restore_eac();

    /// Verification rapide — true si EAC est actuellement desactive.
    [[nodiscard]] bool is_eac_disabled() const;

    /// Statut complet avec details.
    [[nodiscard]] EacStatus get_status() const;

    /// Chemin du repertoire de jeu.
    [[nodiscard]] const std::filesystem::path& game_dir() const { return game_dir_; }

private:
    std::filesystem::path game_dir_;

    // Noms de fichiers constants
    static constexpr const char* INI_FILENAME = "GameBootstrapper.ini";
    static constexpr const char* INI_BACKUP_FILENAME = "GameBootstrapper.ini.bak";
    static constexpr const char* LAUNCHER_FILENAME = "EACLauncher.exe";
    static constexpr const char* LAUNCHER_BACKUP_FILENAME = "EACLauncher.exe.backup";
    static constexpr const char* GAME_EXE = "nie.exe";
    static constexpr const char* APP_PATH_KEY = "ApplicationPath";

    /// Chemin complet vers GameBootstrapper.ini.
    [[nodiscard]] std::filesystem::path ini_path() const;

    /// Chemin complet vers GameBootstrapper.ini.bak.
    [[nodiscard]] std::filesystem::path ini_backup_path() const;

    /// Chemin complet vers EACLauncher.exe.
    [[nodiscard]] std::filesystem::path launcher_path() const;

    /// Chemin complet vers EACLauncher.exe.backup.
    [[nodiscard]] std::filesystem::path launcher_backup_path() const;

    /// Lit le fichier INI (format cle=valeur sans sections).
    /// @param out map cle->valeur, preservant les cles originales
    /// @return false si lecture echouee
    [[nodiscard]] bool read_ini(std::unordered_map<std::string, std::string>& out) const;

    /// Ecrit le fichier INI en preservant l'ordre des cles connues.
    /// @param fields map cle->valeur a ecrire
    /// @return false si ecriture echouee
    [[nodiscard]] bool write_ini(const std::unordered_map<std::string, std::string>& fields) const;
};

} // namespace iecode::services
