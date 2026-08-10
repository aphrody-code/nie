/// @file eac_service.cpp
/// Implementation du service de bypass EAC.

#include "iecode/services/eac_service.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <fstream>
#include <string>
#include <vector>

namespace iecode::services {

// Ordre d'ecriture des cles dans le fichier INI.
// On preserve cet ordre pour garder un fichier identique a l'original.
static constexpr std::array<const char*, 4> INI_KEY_ORDER = {
    "ApplicationPath",
    "WorkingDirectory",
    "WaitForExit",
    "NoOperation",
};

EacService::EacService(std::filesystem::path game_dir)
    : game_dir_(std::move(game_dir)) {}

std::filesystem::path EacService::ini_path() const {
    return game_dir_ / INI_FILENAME;
}

std::filesystem::path EacService::ini_backup_path() const {
    return game_dir_ / INI_BACKUP_FILENAME;
}

std::filesystem::path EacService::launcher_path() const {
    return game_dir_ / LAUNCHER_FILENAME;
}

std::filesystem::path EacService::launcher_backup_path() const {
    return game_dir_ / LAUNCHER_BACKUP_FILENAME;
}

bool EacService::read_ini(std::unordered_map<std::string, std::string>& out) const {
    const auto path = ini_path();
    std::error_code ec;
    if (!std::filesystem::exists(path, ec)) {
        spdlog::error("EAC: fichier INI introuvable : {}", path.string());
        return false;
    }

    std::ifstream file(path);
    if (!file.is_open()) {
        spdlog::error("EAC: impossible d'ouvrir {} en lecture", path.string());
        return false;
    }

    out.clear();
    std::string line;
    while (std::getline(file, line)) {
        // Ignorer les lignes vides et les commentaires
        if (line.empty() || line[0] == '#' || line[0] == ';') {
            continue;
        }

        // Supprimer le \r eventuel (fichiers Windows)
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        // Couper sur le premier '='
        const auto eq_pos = line.find('=');
        if (eq_pos == std::string::npos) {
            continue; // Ligne sans '=', ignorer
        }

        auto key = line.substr(0, eq_pos);
        auto value = line.substr(eq_pos + 1);
        out[std::move(key)] = std::move(value);
    }

    return true;
}

bool EacService::write_ini(const std::unordered_map<std::string, std::string>& fields) const {
    const auto path = ini_path();

    std::ofstream file(path, std::ios::binary);
    if (!file.is_open()) {
        spdlog::error("EAC: impossible d'ouvrir {} en ecriture", path.string());
        return false;
    }

    // Ecrire les cles dans l'ordre connu
    for (const auto* key : INI_KEY_ORDER) {
        const auto it = fields.find(key);
        if (it != fields.end()) {
            file << it->first << "=" << it->second << "\r\n";
        }
    }

    // Ecrire les cles supplementaires inconnues (ordre non garanti)
    for (const auto& [key, value] : fields) {
        const bool is_known = std::any_of(
            INI_KEY_ORDER.begin(), INI_KEY_ORDER.end(),
            [&key](const char* k) { return key == k; });
        if (!is_known) {
            file << key << "=" << value << "\r\n";
        }
    }

    file.flush();
    if (!file.good()) {
        spdlog::error("EAC: erreur d'ecriture dans {}", path.string());
        return false;
    }

    return true;
}

bool EacService::disable_eac() {
    std::error_code ec;

    // Verifier que le repertoire de jeu existe
    if (!std::filesystem::is_directory(game_dir_, ec)) {
        spdlog::error("EAC: repertoire de jeu invalide : {}", game_dir_.string());
        return false;
    }

    // --- Etape 1 : Modifier GameBootstrapper.ini ---
    std::unordered_map<std::string, std::string> ini_fields;
    if (!read_ini(ini_fields)) {
        return false;
    }

    const auto it = ini_fields.find(APP_PATH_KEY);
    const auto current_app = (it != ini_fields.end()) ? it->second : std::string{};

    if (current_app != GAME_EXE) {
        // Sauvegarder l'ini original si pas deja fait
        if (!std::filesystem::exists(ini_backup_path(), ec)) {
            std::filesystem::copy_file(
                ini_path(), ini_backup_path(),
                std::filesystem::copy_options::overwrite_existing, ec);
            if (ec) {
                spdlog::error("EAC: impossible de sauvegarder l'INI : {}", ec.message());
                return false;
            }
            spdlog::info("EAC: backup INI cree : {}", ini_backup_path().string());
        }

        // Modifier ApplicationPath
        ini_fields[APP_PATH_KEY] = GAME_EXE;
        if (!write_ini(ini_fields)) {
            return false;
        }
        spdlog::info("EAC: INI modifie — ApplicationPath={}", GAME_EXE);
    } else {
        spdlog::info("EAC: INI deja configure pour {}", GAME_EXE);
    }

    // --- Etape 2 : Backup/suppression de EACLauncher.exe ---
    const auto launcher = launcher_path();
    const auto launcher_bak = launcher_backup_path();

    if (std::filesystem::exists(launcher, ec)) {
        if (std::filesystem::exists(launcher_bak, ec)) {
            // Backup existe deja, supprimer le launcher actuel
            std::filesystem::remove(launcher, ec);
            if (ec) {
                spdlog::warn("EAC: impossible de supprimer {} : {}", launcher.string(), ec.message());
                // Pas fatal — l'ini est deja modifie
            } else {
                spdlog::info("EAC: {} supprime (backup existant)", launcher.string());
            }
        } else {
            // Renommer vers .backup
            std::filesystem::rename(launcher, launcher_bak, ec);
            if (ec) {
                spdlog::error("EAC: impossible de renommer {} : {}", launcher.string(), ec.message());
                return false;
            }
            spdlog::info("EAC: {} renomme en {}", launcher.string(), launcher_bak.string());
        }
    } else {
        spdlog::info("EAC: {} absent (deja desactive ou supprime)", LAUNCHER_FILENAME);
    }

    spdlog::info("EAC: bypass active avec succes");
    return true;
}

bool EacService::restore_eac() {
    std::error_code ec;

    // Verifier que le repertoire de jeu existe
    if (!std::filesystem::is_directory(game_dir_, ec)) {
        spdlog::error("EAC: repertoire de jeu invalide : {}", game_dir_.string());
        return false;
    }

    // --- Etape 1 : Restaurer GameBootstrapper.ini ---
    const auto ini_bak = ini_backup_path();

    if (std::filesystem::exists(ini_bak, ec)) {
        // Restaurer depuis le backup
        std::filesystem::copy_file(
            ini_bak, ini_path(),
            std::filesystem::copy_options::overwrite_existing, ec);
        if (ec) {
            spdlog::error("EAC: impossible de restaurer l'INI depuis le backup : {}", ec.message());
            return false;
        }
        // Supprimer le backup apres restauration reussie
        std::filesystem::remove(ini_bak, ec);
        spdlog::info("EAC: INI restaure depuis le backup");
    } else {
        // Pas de backup — remettre ApplicationPath a la valeur originale
        std::unordered_map<std::string, std::string> ini_fields;
        if (!read_ini(ini_fields)) {
            return false;
        }

        ini_fields[APP_PATH_KEY] = LAUNCHER_FILENAME;
        if (!write_ini(ini_fields)) {
            return false;
        }
        spdlog::info("EAC: INI modifie — ApplicationPath={}", LAUNCHER_FILENAME);
    }

    // --- Etape 2 : Restaurer EACLauncher.exe ---
    const auto launcher = launcher_path();
    const auto launcher_bak = launcher_backup_path();

    if (std::filesystem::exists(launcher_bak, ec)) {
        std::filesystem::rename(launcher_bak, launcher, ec);
        if (ec) {
            spdlog::error("EAC: impossible de restaurer {} : {}", launcher.string(), ec.message());
            return false;
        }
        spdlog::info("EAC: {} restaure depuis le backup", LAUNCHER_FILENAME);
    } else {
        spdlog::warn("EAC: pas de backup de {} trouve", LAUNCHER_FILENAME);
    }

    spdlog::info("EAC: EAC restaure avec succes");
    return true;
}

bool EacService::is_eac_disabled() const {
    std::error_code ec;

    // Methode 1 : Verifier l'INI
    std::unordered_map<std::string, std::string> ini_fields;
    if (read_ini(ini_fields)) {
        const auto it = ini_fields.find(APP_PATH_KEY);
        if (it != ini_fields.end() && it->second != LAUNCHER_FILENAME) {
            return true;
        }
    }

    // Methode 2 : Backup du launcher existe
    if (std::filesystem::exists(launcher_backup_path(), ec)) {
        return true;
    }

    return false;
}

EacStatus EacService::get_status() const {
    std::error_code ec;

    // Lire l'INI pour verifier ApplicationPath
    bool ini_modified = false;
    std::unordered_map<std::string, std::string> ini_fields;
    if (read_ini(ini_fields)) {
        const auto it = ini_fields.find(APP_PATH_KEY);
        ini_modified = (it != ini_fields.end() && it->second != LAUNCHER_FILENAME);
    }

    return EacStatus{
        .ini_modified = ini_modified,
        .launcher_backed_up = std::filesystem::exists(launcher_backup_path(), ec),
        .launcher_missing = !std::filesystem::exists(launcher_path(), ec),
    };
}

} // namespace iecode::services
