/// @file steam_helper.cpp
/// Implementation de la detection automatique du chemin Steam.
///
/// Meilleur que le C# :
///   - Supporte Steam Flatpak sur Linux
///   - Parse VDF a la main sans dependance externe
///   - Valide nie.exe OU nie1v2.exe + data/

#include "iecode/modding/steam_helper.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <fstream>
#include <string>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace fs = std::filesystem;

namespace iecode::modding {

// ── Constantes ───────────────────────────────────────────────────────

static constexpr uint32_t DEFAULT_APP_ID = 2799860;
static constexpr const char* GAME_FOLDER_NAME = "INAZUMA ELEVEN Victory Road";

// ── Helpers internes ─────────────────────────────────────────────────

/// Lit une valeur simple depuis un fichier VDF/ACF (format Valve Key-Value).
/// Recherche une ligne contenant la cle et retourne la valeur associee.
static std::string read_vdf_value(const fs::path& vdf_path,
                                  const std::string& key) {
    std::ifstream file(vdf_path);
    if (!file) return {};

    const std::string search_key = "\"" + key + "\"";
    std::string line;
    while (std::getline(file, line)) {
        auto pos = line.find(search_key);
        if (pos == std::string::npos) continue;

        // Trouver la valeur apres la cle : "key"    "value"
        auto value_start = line.find('"', pos + search_key.size());
        if (value_start == std::string::npos) continue;

        auto value_end = line.find('"', value_start + 1);
        if (value_end == std::string::npos) continue;

        return line.substr(value_start + 1, value_end - value_start - 1);
    }
    return {};
}

// ── find_steam_install ───────────────────────────────────────────────

#ifdef _WIN32

/// Lit une valeur string depuis une cle de registre Windows.
static std::optional<fs::path> read_registry_string(
    HKEY root_key, const wchar_t* subkey, const wchar_t* value_name) {
    HKEY key_handle = nullptr;
    auto status = RegOpenKeyExW(root_key, subkey, 0, KEY_READ, &key_handle);
    if (status != ERROR_SUCCESS) return std::nullopt;

    wchar_t buffer[MAX_PATH] = {};
    DWORD buffer_size = sizeof(buffer);
    DWORD type = 0;
    status = RegQueryValueExW(key_handle, value_name, nullptr, &type,
                              reinterpret_cast<BYTE*>(buffer), &buffer_size);
    RegCloseKey(key_handle);

    if (status != ERROR_SUCCESS || type != REG_SZ) return std::nullopt;

    return fs::path(buffer);
}

std::optional<fs::path> find_steam_install() {
    // 1. HKEY_CURRENT_USER\Software\Valve\Steam -> SteamPath
    if (auto path = read_registry_string(
            HKEY_CURRENT_USER, L"Software\\Valve\\Steam", L"SteamPath")) {
        if (fs::exists(*path)) {
            spdlog::debug("steam_helper: trouve via HKCU: {}", path->string());
            return path;
        }
    }

    // 2. HKEY_LOCAL_MACHINE (32 bits sur 64 bits)
    if (auto path = read_registry_string(
            HKEY_LOCAL_MACHINE,
            L"SOFTWARE\\WOW6432Node\\Valve\\Steam", L"InstallPath")) {
        if (fs::exists(*path)) {
            spdlog::debug("steam_helper: trouve via HKLM WOW6432: {}", path->string());
            return path;
        }
    }

    // 3. HKEY_LOCAL_MACHINE (natif)
    if (auto path = read_registry_string(
            HKEY_LOCAL_MACHINE, L"SOFTWARE\\Valve\\Steam", L"InstallPath")) {
        if (fs::exists(*path)) {
            spdlog::debug("steam_helper: trouve via HKLM: {}", path->string());
            return path;
        }
    }

    // 4. Fallback chemins connus
    const fs::path fallbacks[] = {
        "C:/Program Files (x86)/Steam",
        "C:/Program Files/Steam",
        "D:/Steam",
        "D:/Program Files (x86)/Steam",
    };
    for (const auto& fb : fallbacks) {
        if (fs::exists(fb / "steam.exe")) {
            spdlog::debug("steam_helper: trouve via fallback: {}", fb.string());
            return fb;
        }
    }

    spdlog::warn("steam_helper: installation Steam introuvable");
    return std::nullopt;
}

#else // Linux

std::optional<fs::path> find_steam_install() {
    const char* home = std::getenv("HOME");
    if (!home) return std::nullopt;

    const fs::path home_path(home);

    // Chemins Linux connus (inclut Flatpak)
    const fs::path candidates[] = {
        home_path / ".steam/steam",
        home_path / ".local/share/Steam",
        "/usr/share/steam",
        home_path / ".var/app/com.valvesoftware.Steam/.local/share/Steam",
        home_path / ".var/app/com.valvesoftware.Steam/.steam/steam",
    };

    for (const auto& candidate : candidates) {
        if (fs::exists(candidate / "steamapps")) {
            spdlog::debug("steam_helper: trouve: {}", candidate.string());
            return candidate;
        }
    }

    spdlog::warn("steam_helper: installation Steam introuvable");
    return std::nullopt;
}

#endif // _WIN32

// ── get_library_folders ──────────────────────────────────────────────

std::vector<fs::path> get_library_folders(const fs::path& steam_root) {
    std::vector<fs::path> folders;

    // Le dossier steamapps de la racine Steam est toujours inclus
    const auto root_steamapps = steam_root / "steamapps";
    if (fs::exists(root_steamapps)) {
        folders.push_back(root_steamapps);
    }

    // Parser libraryfolders.vdf
    const auto vdf_path = root_steamapps / "libraryfolders.vdf";
    if (!fs::exists(vdf_path)) {
        spdlog::debug("steam_helper: libraryfolders.vdf introuvable");
        return folders;
    }

    std::ifstream file(vdf_path);
    if (!file) return folders;

    std::string line;
    while (std::getline(file, line)) {
        // Chercher les lignes avec "path"
        auto pos = line.find("\"path\"");
        if (pos == std::string::npos) continue;

        // Extraire la valeur
        auto value_start = line.find('"', pos + 6);
        if (value_start == std::string::npos) continue;
        auto value_end = line.find('"', value_start + 1);
        if (value_end == std::string::npos) continue;

        auto path_str = line.substr(value_start + 1, value_end - value_start - 1);

        // Remplacer les doubles backslashes VDF
        std::string clean_path;
        clean_path.reserve(path_str.size());
        for (size_t i = 0; i < path_str.size(); ++i) {
            if (path_str[i] == '\\' && i + 1 < path_str.size() && path_str[i + 1] == '\\') {
                clean_path += '/';
                ++i; // sauter le second backslash
            } else {
                clean_path += path_str[i];
            }
        }

        const auto lib_steamapps = fs::path(clean_path) / "steamapps";
        if (fs::exists(lib_steamapps)) {
            // Eviter les doublons avec la racine
            bool already_added = false;
            for (const auto& existing : folders) {
                std::error_code ec;
                if (fs::equivalent(existing, lib_steamapps, ec)) {
                    already_added = true;
                    break;
                }
            }
            if (!already_added) {
                folders.push_back(lib_steamapps);
            }
        }
    }

    spdlog::debug("steam_helper: {} dossiers de bibliotheque trouves", folders.size());
    return folders;
}

// ── validate_game_path ───────────────────────────────────────────────

bool validate_game_path(const fs::path& path) {
    if (!fs::exists(path) || !fs::is_directory(path)) {
        return false;
    }

    // Verifier la presence de l'executable (nie.exe ou nie1v2.exe)
    const bool has_exe = fs::exists(path / "nie.exe") ||
                         fs::exists(path / "nie1v2.exe");

    // Verifier la presence du dossier data/
    const bool has_data = fs::exists(path / "data") &&
                          fs::is_directory(path / "data");

    return has_exe && has_data;
}

// ── detect_game_path ─────────────────────────────────────────────────

std::optional<SteamDetectionResult> detect_game_path(uint32_t app_id) {
    auto steam_root = find_steam_install();
    if (!steam_root) {
        return std::nullopt;
    }

    auto library_folders = get_library_folders(*steam_root);

    const std::string manifest_name = "appmanifest_" + std::to_string(app_id) + ".acf";

    for (const auto& lib_steamapps : library_folders) {
        const auto manifest_path = lib_steamapps / manifest_name;
        if (!fs::exists(manifest_path)) continue;

        // Lire installdir depuis le manifest ACF
        auto install_dir = read_vdf_value(manifest_path, "installdir");
        if (install_dir.empty()) {
            // Fallback : nom de dossier par defaut
            install_dir = GAME_FOLDER_NAME;
        }

        const auto game_path = lib_steamapps / "common" / install_dir;

        if (validate_game_path(game_path)) {
            spdlog::info("steam_helper: jeu detecte dans '{}'", game_path.string());

            return SteamDetectionResult{
                .game_path = game_path,
                .steam_path = *steam_root,
                .library_folder = lib_steamapps.parent_path().string(),
                .auto_detected = true,
            };
        }

        spdlog::debug("steam_helper: manifest trouve mais dossier invalide: {}",
                       game_path.string());
    }

    spdlog::warn("steam_helper: jeu non trouve (app_id={})", app_id);
    return std::nullopt;
}

} // namespace iecode::modding
