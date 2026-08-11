#pragma once

/// @file config_manager.h
/// Configuration persistee de l'application (JSON, write atomique).
///
/// Meilleur que le C# :
///   - Write atomique (temp + rename) evite la corruption
///   - Pas de relecture a chaque save
///   - apply_saved_state() en O(n) au lieu de O(n^2)
///   - Auto-detection Steam au premier lancement

#include "iecode/modding/mod_info.h"

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace iecode::modding {

/// Configuration persistee d'un mod individuel.
struct ModConfig {
    std::string name;
    bool enabled = true;
    int order = 0;
};

/// Configuration persistee de l'application.
struct AppConfig {
    std::filesystem::path game_path;
    std::filesystem::path mods_dir;
    std::filesystem::path temp_dir;
    std::filesystem::path profiles_dir;
    std::string last_applied_profile;
    std::string selected_cpk_name;
    std::vector<ModConfig> mods;            // ordre + etat enabled persistes
    bool show_technical_logs = false;
    std::string last_app_update_check;      // ISO8601 UTC
    std::string last_mod_prefetch;          // ISO8601 UTC
    std::string last_cpk_list_check;        // ISO8601 UTC
    std::string last_known_steam_build_id;
    std::string last_known_packs_signature;
    std::string game_version;               // version detectee du jeu
};

/// Gestionnaire de configuration persistee.
/// Charge/sauvegarde un AppConfig au format JSON.
class ConfigManager {
public:
    /// @param config_path  chemin vers le fichier de configuration JSON
    explicit ConfigManager(std::filesystem::path config_path);

    /// Charge la config depuis le fichier JSON. Cree une config par defaut si absent.
    /// Detecte automatiquement le chemin Steam au premier lancement.
    [[nodiscard]] AppConfig load();

    /// Sauvegarde atomiquement (write temp + rename) — thread-safe.
    /// @return true si la sauvegarde a reussi
    bool save(const AppConfig& config);

    /// Sauvegarde asynchrone non-bloquante (fire-and-forget).
    void save_async(AppConfig config);

    /// Met a jour uniquement les timestamps (sans toucher au reste).
    /// @return true si la sauvegarde a reussi
    bool update_timestamps(
        std::optional<std::string> app_update_check = std::nullopt,
        std::optional<std::string> mod_prefetch = std::nullopt,
        std::optional<std::string> cpk_list_check = std::nullopt);

    /// Applique l'etat enabled/ordre des mods sauvegardes a une liste scannee.
    /// O(n) grace a une unordered_map au lieu de O(n^2).
    static void apply_saved_state(
        std::vector<ModInfo>& mods,
        const std::vector<ModConfig>& saved_mods);

private:
    std::filesystem::path config_path_;

    /// Migration de config si necessaire (ajout de champs manquants).
    [[nodiscard]] static AppConfig migrate(AppConfig config);

    /// Genere un timestamp ISO8601 UTC.
    [[nodiscard]] static std::string now_iso8601();
};

} // namespace iecode::modding
