/// @file config_manager.cpp
/// Implementation du gestionnaire de configuration persistee.
///
/// Meilleur que le C# :
///   - Write atomique (temp file + rename) evite la corruption en cas de crash
///   - apply_saved_state() en O(n) au lieu de O(n^2)
///   - Auto-detection Steam au premier lancement via steam_helper

#include "iecode/modding/config_manager.h"
#include "iecode/modding/steam_helper.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <future>
#include <iomanip>
#include <sstream>
#include <unordered_map>

namespace fs = std::filesystem;

namespace iecode::modding {

// ── Serialisation JSON pour ModConfig ────────────────────────────────

static void to_json(nlohmann::json& j, const ModConfig& c) {
    j = nlohmann::json{
        {"name", c.name},
        {"enabled", c.enabled},
        {"order", c.order},
    };
}

static void from_json(const nlohmann::json& j, ModConfig& c) {
    j.at("name").get_to(c.name);
    if (j.contains("enabled")) j.at("enabled").get_to(c.enabled);
    if (j.contains("order")) j.at("order").get_to(c.order);
}

// ── Serialisation JSON pour AppConfig ────────────────────────────────

static void to_json(nlohmann::json& j, const AppConfig& c) {
    j = nlohmann::json{
        {"game_path", c.game_path.generic_string()},
        {"mods_dir", c.mods_dir.generic_string()},
        {"temp_dir", c.temp_dir.generic_string()},
        {"profiles_dir", c.profiles_dir.generic_string()},
        {"last_applied_profile", c.last_applied_profile},
        {"selected_cpk_name", c.selected_cpk_name},
        {"mods", c.mods},
        {"show_technical_logs", c.show_technical_logs},
        {"last_app_update_check", c.last_app_update_check},
        {"last_mod_prefetch", c.last_mod_prefetch},
        {"last_cpk_list_check", c.last_cpk_list_check},
        {"last_known_steam_build_id", c.last_known_steam_build_id},
        {"last_known_packs_signature", c.last_known_packs_signature},
        {"game_version", c.game_version},
    };
}

static void from_json(const nlohmann::json& j, AppConfig& c) {
    auto get_opt = [&](const char* key, auto& target) {
        if (j.contains(key)) {
            using T = std::decay_t<decltype(target)>;
            target = j.at(key).get<T>();
        }
    };

    // Chemins
    if (j.contains("game_path"))
        c.game_path = fs::path(j["game_path"].get<std::string>());
    if (j.contains("mods_dir"))
        c.mods_dir = fs::path(j["mods_dir"].get<std::string>());
    if (j.contains("temp_dir"))
        c.temp_dir = fs::path(j["temp_dir"].get<std::string>());
    if (j.contains("profiles_dir"))
        c.profiles_dir = fs::path(j["profiles_dir"].get<std::string>());

    // Champs string simples
    get_opt("last_applied_profile", c.last_applied_profile);
    get_opt("selected_cpk_name", c.selected_cpk_name);
    get_opt("last_app_update_check", c.last_app_update_check);
    get_opt("last_mod_prefetch", c.last_mod_prefetch);
    get_opt("last_cpk_list_check", c.last_cpk_list_check);
    get_opt("last_known_steam_build_id", c.last_known_steam_build_id);
    get_opt("last_known_packs_signature", c.last_known_packs_signature);
    get_opt("game_version", c.game_version);

    // Bool
    get_opt("show_technical_logs", c.show_technical_logs);

    // Mods
    if (j.contains("mods")) {
        c.mods = j["mods"].get<std::vector<ModConfig>>();
    }
}

// ── ConfigManager ────────────────────────────────────────────────────

ConfigManager::ConfigManager(fs::path config_path)
    : config_path_(std::move(config_path)) {
}

std::string ConfigManager::now_iso8601() {
    const auto now = std::chrono::system_clock::now();
    const auto time_t = std::chrono::system_clock::to_time_t(now);
    std::tm tm_buf{};
#ifdef _WIN32
    gmtime_s(&tm_buf, &time_t);
#else
    gmtime_r(&time_t, &tm_buf);
#endif
    std::ostringstream oss;
    oss << std::put_time(&tm_buf, "%Y-%m-%dT%H:%M:%SZ");
    return oss.str();
}

AppConfig ConfigManager::load() {
    if (!fs::exists(config_path_)) {
        spdlog::info("config_manager: fichier absent, creation config par defaut");

        AppConfig config;
        config.mods_dir = "mods";
        config.profiles_dir = "profiles";

        // Auto-detection Steam au premier lancement
        auto detection = detect_game_path();
        if (detection) {
            config.game_path = detection->game_path;
            spdlog::info("config_manager: jeu auto-detecte dans '{}'",
                         config.game_path.string());
        }

        // Sauvegarder la config par defaut
        save(config);
        return config;
    }

    try {
        std::ifstream file(config_path_);
        if (!file) {
            spdlog::error("config_manager: impossible de lire '{}'",
                          config_path_.string());
            return {};
        }

        auto j = nlohmann::json::parse(file);
        auto config = j.get<AppConfig>();
        return migrate(std::move(config));
    } catch (const std::exception& e) {
        spdlog::error("config_manager: erreur chargement '{}': {}",
                      config_path_.string(), e.what());
        return {};
    }
}

bool ConfigManager::save(const AppConfig& config) {
    try {
        // Creer le dossier parent si necessaire
        const auto parent = config_path_.parent_path();
        if (!parent.empty()) {
            std::error_code ec;
            fs::create_directories(parent, ec);
            if (ec) {
                spdlog::error("config_manager: impossible de creer '{}': {}",
                              parent.string(), ec.message());
                return false;
            }
        }

        // Serialiser en JSON
        nlohmann::json j = config;
        const auto json_str = j.dump(2);

        // Write atomique : ecrire dans un fichier temporaire puis renommer
        const auto temp_path = fs::path(config_path_.string() + ".tmp");

        {
            std::ofstream file(temp_path, std::ios::trunc);
            if (!file) {
                spdlog::error("config_manager: impossible d'ecrire '{}'",
                              temp_path.string());
                return false;
            }
            file << json_str;
            if (!file.good()) {
                spdlog::error("config_manager: erreur ecriture '{}'",
                              temp_path.string());
                return false;
            }
        }

        // Renommage atomique (sur la plupart des OS)
        std::error_code ec;
        fs::rename(temp_path, config_path_, ec);
        if (ec) {
            // Fallback : copie + suppression si rename echoue (cross-device)
            fs::copy_file(temp_path, config_path_,
                          fs::copy_options::overwrite_existing, ec);
            fs::remove(temp_path, ec);
            if (ec) {
                spdlog::error("config_manager: erreur rename/copy: {}",
                              ec.message());
                return false;
            }
        }

        return true;
    } catch (const std::exception& e) {
        spdlog::error("config_manager: erreur sauvegarde: {}", e.what());
        return false;
    }
}

void ConfigManager::save_async(AppConfig config) {
    // Fire-and-forget : lance la sauvegarde dans un thread detache
    auto path = config_path_;
    std::thread([cfg = std::move(config), p = std::move(path)]() {
        ConfigManager mgr(p);
        if (!mgr.save(cfg)) {
            spdlog::error("config_manager: echec save_async vers '{}'",
                          p.string());
        }
    }).detach();
}

bool ConfigManager::update_timestamps(
    std::optional<std::string> app_update_check,
    std::optional<std::string> mod_prefetch,
    std::optional<std::string> cpk_list_check) {

    auto config = load();

    if (app_update_check) config.last_app_update_check = *app_update_check;
    if (mod_prefetch)     config.last_mod_prefetch = *mod_prefetch;
    if (cpk_list_check)   config.last_cpk_list_check = *cpk_list_check;

    return save(config);
}

void ConfigManager::apply_saved_state(
    std::vector<ModInfo>& mods,
    const std::vector<ModConfig>& saved_mods) {

    // Construire une map name -> (enabled, order) pour lookup O(1)
    std::unordered_map<std::string, std::pair<bool, int>> state_map;
    state_map.reserve(saved_mods.size());
    for (const auto& saved : saved_mods) {
        state_map[saved.name] = {saved.enabled, saved.order};
    }

    // Appliquer l'etat sauvegarde ; les nouveaux mods ont un ordre eleve
    const int max_order = saved_mods.empty() ? 0 :
        std::max_element(saved_mods.begin(), saved_mods.end(),
            [](const ModConfig& a, const ModConfig& b) {
                return a.order < b.order;
            })->order;

    int next_order = max_order + 1;

    // Stocker l'ordre pour le tri final
    std::unordered_map<std::string, int> order_map;
    order_map.reserve(mods.size());

    for (auto& mod : mods) {
        auto it = state_map.find(mod.name);
        if (it != state_map.end()) {
            mod.enabled = it->second.first;
            order_map[mod.name] = it->second.second;
        } else {
            // Nouveau mod : enabled par defaut, ordre a la fin
            order_map[mod.name] = next_order++;
        }
    }

    // Trier par ordre croissant
    std::sort(mods.begin(), mods.end(),
              [&order_map](const ModInfo& a, const ModInfo& b) {
                  return order_map[a.name] < order_map[b.name];
              });
}

AppConfig ConfigManager::migrate(AppConfig config) {
    // Migration : ajouter les champs par defaut si absents
    if (config.mods_dir.empty()) config.mods_dir = "mods";
    if (config.profiles_dir.empty()) config.profiles_dir = "profiles";
    return config;
}

} // namespace iecode::modding
