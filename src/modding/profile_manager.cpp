/// @file profile_manager.cpp
/// Implementation du gestionnaire de profils de mods.

#include "iecode/modding/profile_manager.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <chrono>
#include <fstream>
#include <iomanip>
#include <sstream>

namespace fs = std::filesystem;

namespace iecode::modding {

// Serialisation JSON manuelle pour ModProfileEntry
inline void to_json(nlohmann::json& j, const ModProfileEntry& e) {
    j = nlohmann::json{
        {"name", e.name},
        {"enabled", e.enabled},
        {"mod_link", e.mod_link}
    };
}

inline void from_json(const nlohmann::json& j, ModProfileEntry& e) {
    j.at("name").get_to(e.name);
    if (j.contains("enabled")) j.at("enabled").get_to(e.enabled);
    if (j.contains("mod_link")) j.at("mod_link").get_to(e.mod_link);
}

// Serialisation JSON manuelle pour ModProfile
inline void to_json(nlohmann::json& j, const ModProfile& p) {
    j = nlohmann::json{
        {"name", p.name},
        {"created_at", p.created_at},
        {"last_modified", p.last_modified},
        {"mods", p.mods},
        {"selected_cpk_name", p.selected_cpk_name}
    };
}

inline void from_json(const nlohmann::json& j, ModProfile& p) {
    j.at("name").get_to(p.name);
    if (j.contains("created_at")) j.at("created_at").get_to(p.created_at);
    if (j.contains("last_modified")) j.at("last_modified").get_to(p.last_modified);
    if (j.contains("mods")) j.at("mods").get_to(p.mods);
    if (j.contains("selected_cpk_name")) j.at("selected_cpk_name").get_to(p.selected_cpk_name);
}


/// Genere un timestamp ISO8601 UTC.
static std::string now_iso8601() {
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

ProfileManager::ProfileManager(fs::path profiles_dir)
    : profiles_dir_(std::move(profiles_dir)) {
}

std::string ProfileManager::sanitize_filename(const std::string& name) {
    std::string result;
    result.reserve(name.size());

    for (const char ch : name) {
        if (ch == '<' || ch == '>' || ch == ':' || ch == '"' ||
            ch == '/' || ch == '\\' || ch == '|' || ch == '?' ||
            ch == '*' || static_cast<unsigned char>(ch) < 32) {
            result += '_';
        } else {
            result += ch;
        }
    }

    // Tronquer a 100 caracteres
    if (result.size() > 100) {
        result.resize(100);
    }

    return result;
}

fs::path ProfileManager::profile_path(const std::string& name) const {
    return profiles_dir_ / (sanitize_filename(name) + ".json");
}

std::vector<ModProfile> ProfileManager::list_profiles() const {
    std::vector<ModProfile> profiles;

    if (!fs::exists(profiles_dir_) || !fs::is_directory(profiles_dir_)) {
        return profiles;
    }

    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(profiles_dir_, ec)) {
        if (!entry.is_regular_file()) continue;
        if (entry.path().extension() != ".json") continue;

        try {
            std::ifstream file(entry.path());
            if (!file) continue;

            auto j = nlohmann::json::parse(file);
            auto profile = j.get<ModProfile>();
            profiles.push_back(std::move(profile));
        } catch (const std::exception& e) {
            spdlog::warn("profile_manager: erreur lecture '{}': {}",
                         entry.path().string(), e.what());
        }
    }

    // Tri par date de modification decroissante
    std::sort(profiles.begin(), profiles.end(),
              [](const ModProfile& a, const ModProfile& b) {
                  return a.last_modified > b.last_modified;
              });

    return profiles;
}

std::optional<ModProfile> ProfileManager::load_profile(const std::string& name) const {
    const auto path = profile_path(name);

    if (!fs::exists(path)) {
        return std::nullopt;
    }

    try {
        std::ifstream file(path);
        if (!file) return std::nullopt;

        auto j = nlohmann::json::parse(file);
        return j.get<ModProfile>();
    } catch (const std::exception& e) {
        spdlog::warn("profile_manager: erreur chargement profil '{}': {}",
                     name, e.what());
        return std::nullopt;
    }
}

bool ProfileManager::save_profile(ModProfile profile) {
    // Mettre a jour last_modified
    profile.last_modified = now_iso8601();

    // Creer le dossier si necessaire
    std::error_code ec;
    fs::create_directories(profiles_dir_, ec);
    if (ec) {
        spdlog::error("profile_manager: impossible de creer '{}': {}",
                      profiles_dir_.string(), ec.message());
        return false;
    }

    const auto path = profile_path(profile.name);

    try {
        nlohmann::json j = profile;
        const auto json_str = j.dump(2);

        // Write atomique : temp + rename (evite la corruption si crash)
        const auto temp_path = fs::path(path.string() + ".tmp");

        {
            std::ofstream file(temp_path, std::ios::trunc);
            if (!file) {
                spdlog::error("profile_manager: impossible d'ecrire '{}'",
                              temp_path.string());
                return false;
            }
            file << json_str;
            if (!file.good()) {
                spdlog::error("profile_manager: erreur ecriture '{}'",
                              temp_path.string());
                std::error_code rm_ec;
                fs::remove(temp_path, rm_ec);
                return false;
            }
        }

        std::error_code rename_ec;
        fs::rename(temp_path, path, rename_ec);
        if (rename_ec) {
            // Fallback : copie + suppression si rename echoue (cross-device)
            fs::copy_file(temp_path, path,
                          fs::copy_options::overwrite_existing, rename_ec);
            std::error_code rm_ec;
            fs::remove(temp_path, rm_ec);
            if (rename_ec) {
                spdlog::error("profile_manager: erreur rename/copy: {}",
                              rename_ec.message());
                return false;
            }
        }

        return true;
    } catch (const std::exception& e) {
        spdlog::error("profile_manager: erreur sauvegarde '{}': {}",
                      profile.name, e.what());
        return false;
    }
}

bool ProfileManager::delete_profile(const std::string& name) {
    const auto path = profile_path(name);
    std::error_code ec;
    return fs::remove(path, ec);
}

bool ProfileManager::profile_exists(const std::string& name) const {
    return fs::exists(profile_path(name));
}

} // namespace iecode::modding
