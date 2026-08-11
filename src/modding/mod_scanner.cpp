/// @file mod_scanner.cpp
/// Implementation du scanner de mods.

#include "iecode/modding/mod_scanner.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <fstream>
#include <future>
#include <string>
#include <unordered_map>

namespace fs = std::filesystem;

namespace iecode::modding {

/// Convertit une chaine en minuscules.
static std::string to_lower(std::string s) {
    for (auto& ch : s) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return s;
}

/// Recherche case-insensitive d'une cle dans un objet JSON.
/// Retourne la valeur en string si trouvee, sinon chaine vide.
static std::string json_get_ci(const nlohmann::json& obj,
                               const std::string& key_lower) {
    for (auto it = obj.begin(); it != obj.end(); ++it) {
        if (to_lower(it.key()) == key_lower && it->is_string()) {
            return it->get<std::string>();
        }
    }
    return {};
}

ModMetadata load_mod_metadata(const fs::path& mod_dir) {
    ModMetadata meta;
    const auto json_path = mod_dir / "mod_data.json";

    if (!fs::exists(json_path)) {
        return meta;
    }

    try {
        std::ifstream file(json_path);
        if (!file) return meta;

        auto j = nlohmann::json::parse(file);
        if (!j.is_object()) return meta;

        meta.display_name = json_get_ci(j, "name");
        meta.author = json_get_ci(j, "author");
        meta.mod_version = json_get_ci(j, "modversion");
        meta.game_version = json_get_ci(j, "gameversion");
        meta.mod_link = json_get_ci(j, "modlink");

        // Lecture des dependances optionnelles
        for (auto it = j.begin(); it != j.end(); ++it) {
            if (to_lower(it.key()) == "dependencies" && it->is_array()) {
                for (const auto& dep_json : *it) {
                    if (!dep_json.is_object()) continue;
                    ModDependency dep;
                    dep.mod_name = json_get_ci(dep_json, "mod_name");
                    if (dep.mod_name.empty()) {
                        dep.mod_name = json_get_ci(dep_json, "name");
                    }
                    if (dep.mod_name.empty()) continue;
                    dep.min_version = json_get_ci(dep_json, "min_version");
                    dep.max_version = json_get_ci(dep_json, "max_version");
                    // Lecture du flag optional (bool)
                    for (auto dit = dep_json.begin(); dit != dep_json.end(); ++dit) {
                        if (to_lower(dit.key()) == "optional" && dit->is_boolean()) {
                            dep.optional = dit->get<bool>();
                        }
                    }
                    meta.dependencies.push_back(std::move(dep));
                }
                break;
            }
        }
    } catch (const nlohmann::json::exception& e) {
        spdlog::warn("mod_scanner: erreur lecture '{}': {}",
                     json_path.string(), e.what());
    } catch (const std::exception& e) {
        spdlog::warn("mod_scanner: erreur lecture '{}': {}",
                     json_path.string(), e.what());
    }

    return meta;
}

std::vector<ModInfo> scan_mods(const fs::path& mods_dir,
                               const ScanOptions& options) {
    std::vector<ModInfo> mods;

    if (!fs::exists(mods_dir) || !fs::is_directory(mods_dir)) {
        spdlog::warn("mod_scanner: dossier inexistant '{}'", mods_dir.string());
        return mods;
    }

    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(mods_dir, ec)) {
        if (!entry.is_directory()) continue;

        if (!options.top_level_dirs_are_mods) continue;

        const auto dir_name = entry.path().filename().string();
        auto metadata = load_mod_metadata(entry.path());

        ModInfo info;
        info.name = dir_name;
        info.path = entry.path();
        info.enabled = true;
        info.metadata = std::move(metadata);

        mods.push_back(std::move(info));
    }

    if (ec) {
        spdlog::warn("mod_scanner: erreur iteration '{}': {}",
                     mods_dir.string(), ec.message());
    }

    // Tri par nom de dossier
    std::sort(mods.begin(), mods.end(),
              [](const ModInfo& a, const ModInfo& b) {
                  return a.name < b.name;
              });

    return mods;
}

bool mod_touches_packs(const ModInfo& mod) {
    const auto data_dir = mod.path / "data";

    if (!fs::exists(data_dir) || !fs::is_directory(data_dir)) {
        return false;
    }

    // Verification rapide : le sous-dossier packs/ existe-t-il ?
    const auto packs_dir = data_dir / "packs";
    if (fs::exists(packs_dir) && fs::is_directory(packs_dir)) {
        // Verifier qu'il contient au moins un fichier
        std::error_code ec;
        for (const auto& entry : fs::directory_iterator(packs_dir, ec)) {
            if (entry.is_regular_file()) return true;
            if (entry.is_directory()) return true; // sous-dossier = contenu
        }
    }

    return false;
}

std::future<std::vector<ModInfo>> scan_mods_async(
    fs::path mods_dir,
    ScanOptions options) {
    return std::async(std::launch::async,
                      [d = std::move(mods_dir), o = std::move(options)]() {
                          return scan_mods(d, o);
                      });
}

ScanDiff diff_scans(const std::vector<ModInfo>& previous,
                    const std::vector<ModInfo>& current) {
    ScanDiff diff;

    // Index les mods precedents par nom pour un lookup rapide
    std::unordered_map<std::string, const ModInfo*> prev_map;
    prev_map.reserve(previous.size());
    for (const auto& mod : previous) {
        prev_map[mod.name] = &mod;
    }

    // Index les mods actuels par nom
    std::unordered_map<std::string, const ModInfo*> curr_map;
    curr_map.reserve(current.size());
    for (const auto& mod : current) {
        curr_map[mod.name] = &mod;
    }

    // Detecter les ajouts et modifications
    for (const auto& mod : current) {
        auto it = prev_map.find(mod.name);
        if (it == prev_map.end()) {
            // Mod ajoute
            diff.added.push_back(mod);
        } else {
            // Mod existant — verifier si les metadonnees ont change
            const auto& prev = *it->second;
            if (prev.metadata.display_name != mod.metadata.display_name ||
                prev.metadata.mod_version != mod.metadata.mod_version ||
                prev.enabled != mod.enabled) {
                diff.modified.push_back(mod);
            }
        }
    }

    // Detecter les suppressions
    for (const auto& mod : previous) {
        if (!curr_map.contains(mod.name)) {
            diff.removed.push_back(mod);
        }
    }

    spdlog::debug("diff_scans: {} ajoute(s), {} supprime(s), {} modifie(s)",
                  diff.added.size(), diff.removed.size(), diff.modified.size());

    return diff;
}

} // namespace iecode::modding
