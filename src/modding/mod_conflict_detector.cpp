/// @file mod_conflict_detector.cpp
/// Implementation de la detection de conflits entre mods.

#include "iecode/modding/mod_conflict_detector.h"

#include <spdlog/spdlog.h>

#include <filesystem>
#include <future>

namespace fs = std::filesystem;

namespace iecode::modding {

ConflictReport detect_conflicts(const std::vector<ModInfo>& mods,
                                const std::string& data_subdir) {
    // Map : chemin relatif -> liste des noms de mods qui le contiennent
    std::unordered_map<std::string, std::vector<std::string>> file_owners;

    for (const auto& mod : mods) {
        if (!mod.enabled) continue;

        const auto data_dir = mod.path / data_subdir;
        if (!fs::exists(data_dir) || !fs::is_directory(data_dir)) {
            continue;
        }

        std::error_code ec;
        for (const auto& entry : fs::recursive_directory_iterator(data_dir, ec)) {
            if (!entry.is_regular_file()) continue;

            const auto rel = fs::relative(entry.path(), data_dir, ec);
            if (ec) continue;

            const auto rel_str = rel.generic_string();

            // Exclure cpk_list.cfg.bin (fichier genere automatiquement)
            if (rel_str == "cpk_list.cfg.bin") continue;

            file_owners[rel_str].push_back(mod.name);
        }

        if (ec) {
            spdlog::warn("conflict_detector: erreur iteration '{}': {}",
                         data_dir.string(), ec.message());
        }
    }

    // Filtrer : ne garder que les fichiers avec >= 2 proprietaires
    ConflictReport report;
    for (auto& [path, owners] : file_owners) {
        if (owners.size() >= 2) {
            report.conflicts[path] = std::move(owners);
        }
    }

    return report;
}

std::future<ConflictReport> detect_conflicts_async(
    std::vector<ModInfo> mods,
    std::string data_subdir) {
    return std::async(std::launch::async,
                      [m = std::move(mods), d = std::move(data_subdir)]() {
                          return detect_conflicts(m, d);
                      });
}

} // namespace iecode::modding
