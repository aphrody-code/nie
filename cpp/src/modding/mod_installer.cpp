/// @file mod_installer.cpp
/// Implementation de l'installation de mods, version async et LastInstallManager.

#include "iecode/modding/mod_installer.h"

#include "iecode/viola/merge.h"
#include "iecode/viola/pack.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <future>
#include <iomanip>
#include <sstream>
#include <unordered_set>

namespace fs = std::filesystem;

namespace iecode::modding {

// ── Helpers internes ─────────────────────────────────────────────────

/// Convertit Platform modding -> Platform viola.
static viola::Platform platform_to_viola(Platform p) {
    switch (p) {
        case Platform::Switch: return viola::Platform::Switch;
        default: return viola::Platform::PC;
    }
}

/// Emet un ProgressEvent via le callback s'il est defini.
static void notify(const InstallOptions& opts, const ProgressEvent& evt) {
    if (opts.on_progress) {
        opts.on_progress(evt);
    }
}

/// Verifie si l'operation a ete annulee.
static bool is_cancelled(const InstallOptions& opts) {
    return opts.cancel_token.has_value() && opts.cancel_token->is_cancelled();
}

/// Genere un nom de dossier temporaire unique.
static fs::path make_temp_dir() {
    const auto now = std::chrono::system_clock::now();
    const auto epoch_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()).count();
    return fs::temp_directory_path() / ("iecode_mod_" + std::to_string(epoch_ms));
}

/// Genere un timestamp ISO8601 UTC.
static std::string installer_now_iso8601() {
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

/// Collecte recursivement tous les fichiers relatifs dans un dossier.
static std::vector<fs::path> collect_relative_files(const fs::path& root) {
    std::vector<fs::path> files;
    if (!fs::exists(root) || !fs::is_directory(root)) return files;

    std::error_code ec;
    for (const auto& entry : fs::recursive_directory_iterator(root, ec)) {
        if (!entry.is_regular_file()) continue;
        auto rel = fs::relative(entry.path(), root, ec);
        if (!ec) {
            files.push_back(std::move(rel));
        }
    }
    return files;
}

// ── install_mods ─────────────────────────────────────────────────────

InstallResult install_mods(const std::vector<ModInfo>& mods,
                           const InstallOptions& options) {
    InstallResult result;

    try {
        // Verification acces ecriture dans game_path (meilleur que C#)
        if (!options.game_path.empty()) {
            auto test_file = options.game_path / ".iecode_write_test";
            std::error_code write_ec;
            {
                std::ofstream f(test_file);
                if (!f) {
                    result.error = "Pas d'acces en ecriture dans " +
                                   options.game_path.string();
                    return result;
                }
            }
            fs::remove(test_file, write_ec);
        }

        // Backup cpk_list.cfg.bin vanilla si pas deja backupe (meilleur que C#)
        if (!options.cpklist_path.empty() && fs::exists(options.cpklist_path)) {
            auto backup = options.cpklist_path.parent_path() /
                          (options.cpklist_path.stem().string() + ".vanilla.bak");
            if (!fs::exists(backup)) {
                std::error_code bak_ec;
                fs::copy_file(options.cpklist_path, backup,
                              fs::copy_options::skip_existing, bak_ec);
                if (!bak_ec) {
                    spdlog::info("mod_installer: backup vanilla cree: {}",
                                 backup.string());
                }
            }
        }

        // Cas 0 mods actives : restaurer le vanilla (meilleur que C#)
        {
            auto enabled_count_check = static_cast<size_t>(
                std::count_if(mods.begin(), mods.end(),
                              [](const ModInfo& m) { return m.enabled; }));
            if (enabled_count_check == 0) {
                // Restaurer cpk_list.cfg.bin vanilla si backup existe
                if (!options.cpklist_path.empty()) {
                    auto backup = options.cpklist_path.parent_path() /
                                  (options.cpklist_path.stem().string() + ".vanilla.bak");
                    if (fs::exists(backup)) {
                        std::error_code restore_ec;
                        fs::copy_file(backup, options.cpklist_path,
                                      fs::copy_options::overwrite_existing, restore_ec);
                        if (!restore_ec) {
                            spdlog::info("mod_installer: cpk_list.cfg.bin vanilla restaure");
                        }
                    }
                }

                // Nettoyer les fichiers obsoletes si un manager est fourni
                if (options.last_install_mgr != nullptr) {
                    options.last_install_mgr->cleanup_obsolete_files(
                        {}, options.game_path);
                    options.last_install_mgr->clear();
                }

                result.success = true;
                return result;
            }
        }

        // Determiner le dossier temporaire
        const fs::path temp = options.temp_dir.empty()
            ? make_temp_dir()
            : options.temp_dir;

        std::error_code ec;
        fs::create_directories(temp, ec);
        if (ec) {
            result.error = "impossible de creer le dossier temporaire: " + ec.message();
            return result;
        }

        // Compter les mods actifs pour le calcul de progression
        const size_t enabled_count = static_cast<size_t>(
            std::count_if(mods.begin(), mods.end(),
                          [](const ModInfo& m) { return m.enabled; }));

        // Etape 1 : merge sequentiel des mods (0-50%)
        size_t mods_applied = 0;
        size_t total_files = 0;

        for (const auto& mod : mods) {
            if (!mod.enabled) continue;

            // Verification annulation avant chaque merge
            if (is_cancelled(options)) {
                result.error = "Cancelled";
                return result;
            }

            // Notification avant merge
            notify(options, ProgressEvent{
                .stage = InstallStage::Merging,
                .percent = static_cast<int>(
                    50.0 * static_cast<double>(mods_applied) /
                    static_cast<double>(std::max(enabled_count, size_t{1}))),
                .current_mod = mod.name,
                .files_done = mods_applied,
                .files_total = enabled_count,
            });

            // Merger le dossier du mod dans le temp
            auto merge_result = viola::merge_directories(mod.path, temp, true);

            if (merge_result.success) {
                ++mods_applied;
                total_files += merge_result.files_copied;
                spdlog::info("mod_installer: merge '{}' -> {} fichiers",
                             mod.name, merge_result.files_copied);
            } else {
                spdlog::warn("mod_installer: echec merge '{}': {}",
                             mod.name, merge_result.error);
            }
        }

        result.mods_applied = mods_applied;
        result.files_merged = total_files;

        // Verification annulation apres merge
        if (is_cancelled(options)) {
            result.error = "Cancelled";
            return result;
        }

        // Etape 2 : pack cpk_list.cfg.bin (50-60%)
        if (options.do_pack && !options.cpklist_path.empty()) {
            notify(options, ProgressEvent{
                .stage = InstallStage::Packing,
                .percent = 60,
            });

            auto pack_result = viola::cpk_update_file_list(
                options.cpklist_path,
                temp,
                temp,
                platform_to_viola(options.platform));

            if (!pack_result.success) {
                spdlog::warn("mod_installer: erreur pack: {}", pack_result.error);
            }
        }

        // Verification annulation apres pack
        if (is_cancelled(options)) {
            result.error = "Cancelled";
            return result;
        }

        // Collecter les fichiers du temp une seule fois (reutilise pour copie + record)
        auto temp_files = collect_relative_files(temp);
        const size_t copy_total = temp_files.size();

        // Etape 3 : copie vers le jeu (60-90%)
        if (!options.game_path.empty()) {
            // Nettoyage des fichiers obsoletes avant copie (meilleur que C#)
            if (options.last_install_mgr != nullptr) {
                auto cleaned = options.last_install_mgr->cleanup_obsolete_files(
                    temp_files, options.game_path);
                if (cleaned > 0) {
                    spdlog::info("mod_installer: {} fichier(s) obsolete(s) nettoye(s)",
                                 cleaned);
                }
            }

            notify(options, ProgressEvent{
                .stage = InstallStage::Copying,
                .percent = 70,
                .files_total = copy_total,
            });

            auto copy_result = viola::merge_directories(temp, options.game_path, true);

            if (copy_result.success) {
                result.files_installed = copy_result.files_copied;
                spdlog::info("mod_installer: {} fichiers installes dans '{}'",
                             copy_result.files_copied, options.game_path.string());
            } else {
                result.error = "erreur copie vers le jeu: " + copy_result.error;
                return result;
            }

            notify(options, ProgressEvent{
                .stage = InstallStage::Copying,
                .percent = 90,
                .files_done = copy_total,
                .files_total = copy_total,
            });
        }

        // Etape 4 : sauvegarde LastInstallRecord si un manager est fourni
        if (options.last_install_mgr != nullptr) {
            LastInstallRecord record;
            record.game_path = options.game_path;
            record.applied_at = installer_now_iso8601();

            for (const auto& mod : mods) {
                if (mod.enabled) {
                    record.installed_mods.push_back(mod.name);
                }
            }
            record.installed_files.reserve(temp_files.size());
            for (const auto& f : temp_files) {
                record.installed_files.push_back(f.generic_string());
            }

            if (!options.last_install_mgr->save(record)) {
                spdlog::warn("mod_installer: echec sauvegarde du last_install record");
            }
        }

        // Etape 5 : nettoyage (90-100%)
        if (options.cleanup_temp && options.temp_dir.empty()) {
            // Ne nettoyer que si le temp a ete auto-genere
            notify(options, ProgressEvent{
                .stage = InstallStage::Cleanup,
                .percent = 95,
            });
            fs::remove_all(temp, ec);
            if (ec) {
                spdlog::warn("mod_installer: impossible de supprimer '{}': {}",
                             temp.string(), ec.message());
            }
        }

        notify(options, ProgressEvent{
            .stage = InstallStage::Done,
            .percent = 100,
        });
        result.success = true;

    } catch (const std::exception& e) {
        result.error = e.what();
        spdlog::error("mod_installer: exception: {}", e.what());
    }

    return result;
}

// ── install_mods_async ───────────────────────────────────────────────

std::future<InstallResult> install_mods_async(
    std::vector<ModInfo> mods,
    InstallOptions options) {
    return std::async(std::launch::async,
                      [m = std::move(mods), o = std::move(options)]() {
                          return install_mods(m, o);
                      });
}

// ── LastInstallManager ───────────────────────────────────────────────

LastInstallManager::LastInstallManager(fs::path data_dir)
    : data_dir_(std::move(data_dir)) {
}

fs::path LastInstallManager::json_path() const {
    return data_dir_ / kFilename;
}

bool LastInstallManager::save(const LastInstallRecord& record) {
    std::error_code ec;
    fs::create_directories(data_dir_, ec);
    if (ec) {
        spdlog::error("last_install: impossible de creer '{}': {}",
                      data_dir_.string(), ec.message());
        return false;
    }

    try {
        nlohmann::json j;
        j["game_path"] = record.game_path.generic_string();
        j["installed_mods"] = record.installed_mods;
        j["installed_files"] = record.installed_files;
        j["applied_at"] = record.applied_at;
        j["selected_cpk_name"] = record.selected_cpk_name;

        const auto target = json_path();
        const auto temp_path = fs::path(target.string() + ".tmp");

        // Write atomique : temp + rename (evite la corruption si crash)
        {
            std::ofstream file(temp_path, std::ios::trunc);
            if (!file) {
                spdlog::error("last_install: impossible d'ecrire '{}'",
                              temp_path.string());
                return false;
            }
            file << j.dump(2);
            if (!file.good()) {
                spdlog::error("last_install: erreur ecriture '{}'",
                              temp_path.string());
                fs::remove(temp_path, ec);
                return false;
            }
        }

        fs::rename(temp_path, target, ec);
        if (ec) {
            // Fallback : copie + suppression si rename echoue (cross-device)
            fs::copy_file(temp_path, target,
                          fs::copy_options::overwrite_existing, ec);
            fs::remove(temp_path, ec);
            if (ec) {
                spdlog::error("last_install: erreur rename/copy: {}", ec.message());
                return false;
            }
        }

        return true;
    } catch (const std::exception& e) {
        spdlog::error("last_install: erreur sauvegarde: {}", e.what());
        return false;
    }
}

std::optional<LastInstallRecord> LastInstallManager::load() const {
    const auto path = json_path();
    if (!fs::exists(path)) {
        return std::nullopt;
    }

    try {
        std::ifstream file(path);
        if (!file) return std::nullopt;

        auto j = nlohmann::json::parse(file);

        LastInstallRecord record;
        if (j.contains("game_path")) {
            record.game_path = fs::path(j["game_path"].get<std::string>());
        }
        if (j.contains("installed_mods")) {
            record.installed_mods = j["installed_mods"].get<std::vector<std::string>>();
        }
        if (j.contains("installed_files")) {
            record.installed_files = j["installed_files"].get<std::vector<std::string>>();
        }
        if (j.contains("applied_at")) {
            record.applied_at = j["applied_at"].get<std::string>();
        }
        if (j.contains("selected_cpk_name")) {
            record.selected_cpk_name = j["selected_cpk_name"].get<std::string>();
        }

        return record;
    } catch (const std::exception& e) {
        spdlog::warn("last_install: erreur chargement: {}", e.what());
        return std::nullopt;
    }
}

std::vector<fs::path> LastInstallManager::get_installed_files() const {
    auto record = load();
    if (!record) return {};

    std::vector<fs::path> files;
    files.reserve(record->installed_files.size());
    for (const auto& f : record->installed_files) {
        files.emplace_back(f);
    }
    return files;
}

size_t LastInstallManager::cleanup_obsolete_files(
    const std::vector<fs::path>& current_files,
    const fs::path& game_path) {
    auto prev_files = get_installed_files();
    if (prev_files.empty()) return 0;

    // Construire un set des fichiers actuels (chemins generiques normalises)
    std::unordered_set<std::string> current_set;
    current_set.reserve(current_files.size());
    for (const auto& f : current_files) {
        current_set.insert(f.generic_string());
    }

    // Supprimer les fichiers obsoletes (dans l'ancien mais pas le nouveau)
    size_t removed = 0;
    std::error_code ec;
    std::vector<fs::path> deleted_files;

    for (const auto& prev_file : prev_files) {
        const auto prev_str = prev_file.generic_string();
        if (current_set.contains(prev_str)) continue;

        const auto full_path = game_path / prev_file;
        if (fs::exists(full_path, ec) && fs::remove(full_path, ec)) {
            ++removed;
            deleted_files.push_back(full_path);
            spdlog::debug("last_install: fichier obsolete supprime: {}",
                          full_path.string());
        }
    }

    // Supprimer les dossiers parents vides apres cleanup (meilleur que C#)
    for (const auto& deleted_file : deleted_files) {
        auto parent = deleted_file.parent_path();
        while (parent != game_path && fs::is_directory(parent, ec) &&
               fs::is_empty(parent, ec)) {
            fs::remove(parent, ec);
            if (ec) break;
            spdlog::debug("last_install: dossier vide supprime: {}",
                          parent.string());
            parent = parent.parent_path();
        }
    }

    if (removed > 0) {
        spdlog::info("last_install: {} fichier(s) obsolete(s) supprime(s)", removed);
    }

    return removed;
}

bool LastInstallManager::clear() {
    const auto path = json_path();
    std::error_code ec;
    if (fs::exists(path, ec)) {
        return fs::remove(path, ec);
    }
    return true; // Rien a supprimer = succes
}

bool LastInstallManager::mods_match_last_install(
    const std::vector<ModInfo>& mods) const {
    auto record = load();
    if (!record) return false;

    // Construire un set des mods actifs
    std::vector<std::string> current_names;
    for (const auto& mod : mods) {
        if (mod.enabled) {
            current_names.push_back(mod.name);
        }
    }

    // Comparer (taille + contenu)
    if (current_names.size() != record->installed_mods.size()) return false;

    std::unordered_set<std::string> installed_set(
        record->installed_mods.begin(), record->installed_mods.end());

    for (const auto& name : current_names) {
        if (!installed_set.contains(name)) return false;
    }

    return true;
}

bool LastInstallManager::cpk_matches_last_install(
    const std::string& cpk_name) const {
    auto record = load();
    if (!record) return false;
    return record->selected_cpk_name == cpk_name;
}

} // namespace iecode::modding
