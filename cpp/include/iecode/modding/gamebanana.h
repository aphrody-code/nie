#pragma once

/// @file gamebanana.h
/// Client API GameBanana pour la recherche et le telechargement de mods.
///
/// Endpoints utilises :
///   - apiv11/Game/20069/Subfeed  — liste paginee des mods recents
///   - Core/List/Section          — fallback par nombre de telechargements
///   - Core/Item/Data             — details d'un mod (nom, URL, telechargements)
///
/// Toutes les fonctions reseau retournent std::optional en cas d'erreur
/// (pas d'exception, compatible avec le pattern du projet).

#include <cstdint>
#include <filesystem>
#include <future>
#include <optional>
#include <string>
#include <vector>

namespace iecode::modding {

/// ID du jeu Inazuma Eleven: Victory Road sur GameBanana.
inline constexpr int GAMEBANANA_GAME_ID = 20069;

/// Nombre de mods par page par defaut.
inline constexpr int GAMEBANANA_DEFAULT_PAGE_SIZE = 50;

/// Informations d'un mod GameBanana.
struct GameBananaMod {
    int id = 0;
    std::string name;
    std::string page_url;
    std::string download_url;
    std::string thumbnail_url;
    int downloads = 0;
    std::string date_added;       // ISO8601 si disponible
    std::string date_modified;    // ISO8601 si disponible
    std::string submitter;        // nom de l'auteur
    std::string description;      // texte court
};

/// Fichier telechargeable d'un mod GameBanana.
struct GameBananaFile {
    int id = 0;
    std::string filename;
    std::string download_url;
    int64_t file_size = 0;        // en bytes
    std::string description;
    int downloads = 0;
    std::string date_added;
};

/// Resultat d'une recherche paginee.
struct GameBananaSearchResult {
    std::vector<GameBananaMod> mods;
    int page = 1;
    int page_size = GAMEBANANA_DEFAULT_PAGE_SIZE;
    bool has_more = false;        // true si page suivante probable
};

/// Resultat du telechargement d'un mod.
struct DownloadResult {
    bool success = false;
    std::filesystem::path output_path;  // dossier ou fichier extrait
    std::string error;
    size_t bytes_downloaded = 0;
};

/// Liste les mods recents du jeu (Subfeed API v11).
/// @param page       numero de page (1-based)
/// @param page_size  nombre de mods par page
/// @return resultat de recherche, ou nullopt en cas d'erreur reseau
[[nodiscard]] std::optional<GameBananaSearchResult> gamebanana_list_mods(
    int page = 1,
    int page_size = GAMEBANANA_DEFAULT_PAGE_SIZE);

/// Recherche des mods par mot-cle (filtrage local sur le Subfeed).
/// @param query      terme de recherche (case-insensitive)
/// @param page       numero de page
/// @param page_size  nombre de mods par page
/// @return resultat filtre, ou nullopt en cas d'erreur reseau
[[nodiscard]] std::optional<GameBananaSearchResult> gamebanana_search_mods(
    const std::string& query,
    int page = 1,
    int page_size = GAMEBANANA_DEFAULT_PAGE_SIZE);

/// Recupere les details d'un mod par son ID.
/// @param mod_id  identifiant GameBanana du mod
/// @return informations du mod, ou nullopt si introuvable/erreur
[[nodiscard]] std::optional<GameBananaMod> gamebanana_get_mod(int mod_id);

/// Recupere la liste des fichiers telechargeables d'un mod.
/// @param mod_id  identifiant GameBanana du mod
/// @return liste des fichiers, ou nullopt en cas d'erreur
[[nodiscard]] std::optional<std::vector<GameBananaFile>> gamebanana_get_files(
    int mod_id);

/// Telecharge un mod et l'extrait dans un dossier.
/// Si le fichier est un .zip, il est automatiquement extrait.
/// @param download_url  URL directe du fichier a telecharger
/// @param output_dir    dossier de destination
/// @param mod_name      nom du mod (utilise pour creer le sous-dossier)
/// @return resultat du telechargement
[[nodiscard]] DownloadResult gamebanana_download_mod(
    const std::string& download_url,
    const std::filesystem::path& output_dir,
    const std::string& mod_name);

/// Telecharge le premier fichier disponible d'un mod par son ID.
/// Recupere la liste des fichiers puis telecharge le premier.
/// @param mod_id      identifiant GameBanana du mod
/// @param output_dir  dossier de destination
/// @return resultat du telechargement
[[nodiscard]] DownloadResult gamebanana_download_mod_by_id(
    int mod_id,
    const std::filesystem::path& output_dir);

// ── Versions asynchrones ────────────────────────────────────────────

/// Version asynchrone de gamebanana_list_mods.
[[nodiscard]] std::future<std::optional<GameBananaSearchResult>>
gamebanana_list_mods_async(int page = 1,
                           int page_size = GAMEBANANA_DEFAULT_PAGE_SIZE);

/// Version asynchrone de gamebanana_search_mods.
[[nodiscard]] std::future<std::optional<GameBananaSearchResult>>
gamebanana_search_mods_async(std::string query,
                             int page = 1,
                             int page_size = GAMEBANANA_DEFAULT_PAGE_SIZE);

/// Version asynchrone de gamebanana_get_mod.
[[nodiscard]] std::future<std::optional<GameBananaMod>>
gamebanana_get_mod_async(int mod_id);

} // namespace iecode::modding
