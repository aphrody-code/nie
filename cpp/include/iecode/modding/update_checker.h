#pragma once

/// @file update_checker.h
/// Verification des mises a jour (app via GitHub, mods via GameBanana).
///
/// - App : compare la version locale avec le tag de la derniere release GitHub.
/// - Mods : compare la version installee (mod_data.json) avec la date de
///   modification GameBanana (si mod_link contient un ID).

#include "iecode/modding/mod_info.h"

#include <cstdint>
#include <filesystem>
#include <future>
#include <optional>
#include <string>
#include <vector>

namespace iecode::modding {

/// URL de l'API GitHub pour verifier les releases.
/// Pointe vers le repo iecode (modifiable pour d'autres repos).
inline constexpr const char* GITHUB_API_RELEASES_LATEST =
    "https://api.github.com/repos/Adr1GR/IEVR_Mod_Manager/releases/latest";

/// Asset telechargeable d'une release GitHub.
struct GitHubAsset {
    std::string name;
    std::string download_url;   // browser_download_url
    int64_t size = 0;           // en bytes
    std::string content_type;
};

/// Informations d'une release GitHub.
struct GitHubRelease {
    std::string tag_name;       // ex: "v1.8.0"
    std::string name;           // titre de la release
    std::string body;           // notes de release (markdown)
    std::string published_at;   // ISO8601
    std::string html_url;       // lien vers la page
    std::vector<GitHubAsset> assets;
};

/// Resultat de la verification de mise a jour app.
struct AppUpdateResult {
    bool update_available = false;
    std::string current_version;
    std::string latest_version;
    std::optional<GitHubRelease> release;
    std::string error;          // non-vide si erreur reseau
};

/// Resultat de la verification de mise a jour d'un mod.
struct ModUpdateResult {
    std::string mod_name;
    int gamebanana_id = 0;
    bool update_available = false;
    std::string installed_version;
    std::string latest_date_modified;   // date de derniere modif GameBanana
    std::string page_url;
};

/// Resultat de la verification de mises a jour de tous les mods.
struct ModsUpdateResult {
    std::vector<ModUpdateResult> results;
    int checked = 0;
    int updates_available = 0;
    std::string error;
};

/// Compare deux chaines de version semver (ex: "1.7.0" vs "1.8.0").
/// Supprime le prefixe 'v'/'V' et les suffixes '+hash' / '-prerelease'.
/// @return true si latest_version est strictement plus recente que current_version
[[nodiscard]] bool is_newer_version(const std::string& current_version,
                                    const std::string& latest_version);

/// Recupere la derniere release GitHub.
/// @param api_url  URL de l'API GitHub (defaut : GITHUB_API_RELEASES_LATEST)
/// @return release info, ou nullopt en cas d'erreur
[[nodiscard]] std::optional<GitHubRelease> fetch_latest_release(
    const std::string& api_url = GITHUB_API_RELEASES_LATEST);

/// Verifie si une mise a jour de l'application est disponible.
/// @param current_version  version actuelle (ex: "1.7.0")
/// @param api_url          URL de l'API GitHub
/// @return resultat de la verification
[[nodiscard]] AppUpdateResult check_app_update(
    const std::string& current_version,
    const std::string& api_url = GITHUB_API_RELEASES_LATEST);

/// Verifie les mises a jour pour une liste de mods installes.
/// Seuls les mods avec un mod_link contenant un ID GameBanana sont verifies.
/// @param mods  liste des mods installes
/// @return resultat de la verification
[[nodiscard]] ModsUpdateResult check_mod_updates(
    const std::vector<ModInfo>& mods);

// ── Versions asynchrones ────────────────────────────────────────────

/// Version asynchrone de check_app_update.
[[nodiscard]] std::future<AppUpdateResult> check_app_update_async(
    std::string current_version,
    std::string api_url = GITHUB_API_RELEASES_LATEST);

/// Version asynchrone de check_mod_updates.
[[nodiscard]] std::future<ModsUpdateResult> check_mod_updates_async(
    std::vector<ModInfo> mods);

/// Extrait un ID GameBanana d'un lien mod_link.
/// Supporte les formats :
///   - "https://gamebanana.com/mods/12345"
///   - "gamebanana.com/mods/12345"
///   - "12345" (ID direct)
/// @return ID du mod, ou 0 si extraction impossible
[[nodiscard]] int extract_gamebanana_id(const std::string& mod_link);

} // namespace iecode::modding
