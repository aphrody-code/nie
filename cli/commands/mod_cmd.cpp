/// @file mod_cmd.cpp
/// Commande CLI 'mod' — gestion complete des mods (merge, install, pack, unpack,
/// dump, conflicts, profiles).
///
/// Usage :
///   iecode mod merge <mods...> -o <output> [--pack] [--cpklist <file>]
///   iecode mod install <mods...> --game <path> [--cpklist <file>] [--data-dir <dir>]
///   iecode mod pack --input <dir> --cpklist <file> -o <output>
///   iecode mod unpack <cpk> -o <output>
///   iecode mod dump --game <path> -o <output> [--threads N]
///   iecode mod conflicts <mods...> [--json]
///   iecode mod profile list|create|apply|delete [options] [--json]

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/modding/mod_scanner.h"
#include "iecode/modding/mod_conflict_detector.h"
#include "iecode/modding/mod_dependency.h"
#include "iecode/modding/mod_compatibility.h"
#include "iecode/modding/mod_packager.h"
#include "iecode/modding/mod_installer.h"
#include "iecode/modding/profile_manager.h"
#include "iecode/modding/config_manager.h"
#include "iecode/modding/steam_helper.h"
#include "iecode/modding/gamebanana.h"
#include "iecode/modding/update_checker.h"

#include "iecode/viola/merge.h"
#include "iecode/viola/pack.h"
#include "iecode/viola/dump.h"
#include "iecode/formats/criware/cpk_reader.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Helpers ───────────────────────────────────────────────────────────

/// Cree des ModInfo a partir de chemins de dossiers.
static std::vector<modding::ModInfo> mods_from_paths(
    const std::vector<std::string>& paths) {
    std::vector<modding::ModInfo> all_mods;
    for (const auto& p : paths) {
        const fs::path dir(p);
        if (!fs::is_directory(dir)) {
            spdlog::warn("mod: dossier ignore (inexistant) : '{}'", p);
            continue;
        }

        // Essayer de scanner comme dossier de mods (sous-dossiers = mods)
        auto scanned = modding::scan_mods(dir);
        if (!scanned.empty()) {
            for (auto& m : scanned) {
                all_mods.push_back(std::move(m));
            }
        } else {
            // Traiter le dossier lui-meme comme un mod unique
            modding::ModInfo info;
            info.name = dir.filename().string();
            info.path = dir;
            info.enabled = true;
            info.metadata = modding::load_mod_metadata(dir);
            all_mods.push_back(std::move(info));
        }
    }
    return all_mods;
}

/// Retourne le dossier de profils (option > env > defaut).
static fs::path resolve_profiles_dir(const std::string& opt) {
    if (!opt.empty()) return fs::path(opt);
    if (const char* env = std::getenv("IECODE_PROFILES_DIR")) {
        return fs::path(env);
    }
    return fs::path("profiles");
}

// ── mod merge ─────────────────────────────────────────────────────────

static void cmd_mod_merge(const std::vector<std::string>& sources,
                          const std::string& output_dir,
                          bool do_pack,
                          const std::string& cpklist_path,
                          const std::string& platform) {
    if (sources.empty()) {
        emit_error("au moins un dossier source est requis");
        return;
    }

    auto t0 = std::chrono::steady_clock::now();

    const fs::path target(output_dir);
    size_t total_copied = 0;
    size_t total_skipped = 0;

    for (const auto& src : sources) {
        if (!fs::is_directory(src)) {
            spdlog::warn("mod merge: dossier ignore (inexistant) : '{}'", src);
            continue;
        }

        auto result = viola::merge_directories(fs::path(src), target, true);
        if (result.success) {
            total_copied += result.files_copied;
            total_skipped += result.files_skipped;
        } else {
            spdlog::error("mod merge: erreur pour '{}': {}", src, result.error);
        }
    }

    // Pack automatique si demande
    json pack_json;
    if (do_pack && !cpklist_path.empty()) {
        const bool is_switch = (platform == "switch" || platform == "SWITCH");
        auto pack_result = viola::cpk_update_file_list(
            fs::path(cpklist_path), target, target,
            is_switch ? viola::Platform::Switch : viola::Platform::PC);

        pack_json = json{
            {"ok", pack_result.success},
            {"files_updated", pack_result.files_updated},
            {"files_added", pack_result.files_added}
        };
        if (!pack_result.success) {
            pack_json["error"] = pack_result.error;
        }
    }

    auto t1 = std::chrono::steady_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    json out = {
        {"ok", true},
        {"files_copied", total_copied},
        {"files_skipped", total_skipped},
        {"output", output_dir},
        {"elapsed_ms", ms}
    };
    if (!pack_json.is_null()) {
        out["pack"] = pack_json;
    }
    emit(out);
}

// ── mod install ───────────────────────────────────────────────────────

static void cmd_mod_install(const std::vector<std::string>& sources,
                            const std::string& game_path,
                            const std::string& cpklist_path,
                            bool no_pack,
                            const std::string& platform,
                            const std::string& data_dir_str,
                            bool json_output) {
    if (game_path.empty()) {
        emit_error("--game est requis");
        return;
    }

    auto t0 = std::chrono::steady_clock::now();

    auto mods = mods_from_paths(sources);
    if (mods.empty()) {
        emit_error("aucun mod trouve dans les dossiers fournis");
        return;
    }

    const bool is_switch = (platform == "switch" || platform == "SWITCH");

    // Creer le LastInstallManager si un data-dir est fourni
    const fs::path data_dir = data_dir_str.empty()
        ? fs::path("./iecode_data")
        : fs::path(data_dir_str);
    modding::LastInstallManager last_mgr(data_dir);

    modding::InstallOptions opts;
    opts.game_path = fs::path(game_path);
    opts.cpklist_path = cpklist_path.empty() ? fs::path{} : fs::path(cpklist_path);
    opts.platform = is_switch ? modding::Platform::Switch : modding::Platform::PC;
    opts.do_pack = !no_pack;
    opts.cleanup_temp = true;
    opts.last_install_mgr = &last_mgr;
    opts.on_progress = [json_output](const modding::ProgressEvent& evt) {
        if (!json_output) {
            // Affichage texte lisible dans le log
            const char* stage_name = "unknown";
            switch (evt.stage) {
                case modding::InstallStage::Merging:  stage_name = "merge";   break;
                case modding::InstallStage::Packing:  stage_name = "pack";    break;
                case modding::InstallStage::Copying:  stage_name = "copy";    break;
                case modding::InstallStage::Cleanup:  stage_name = "cleanup"; break;
                case modding::InstallStage::Done:     stage_name = "done";    break;
                case modding::InstallStage::Error:    stage_name = "error";   break;
            }
            spdlog::info("mod install: [{}] {}%{}", stage_name, evt.percent,
                         evt.current_mod.empty() ? "" : " — " + evt.current_mod);
        }
    };

    auto result = modding::install_mods(mods, opts);

    // Nettoyage des fichiers obsoletes apres install reussi
    // Note : le cleanup se fait via LastInstallManager dans install_mods
    // qui compare avec le record precedent avant de sauvegarder le nouveau.

    auto t1 = std::chrono::steady_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    if (json_output) {
        json out = {
            {"success", result.success},
            {"mods_applied", result.mods_applied},
            {"files_merged", result.files_merged},
            {"files_installed", result.files_installed},
        };
        if (!result.error.empty()) {
            out["error"] = result.error;
        }
        emit(out);
    } else {
        json out = {
            {"ok", result.success},
            {"mods_applied", result.mods_applied},
            {"files_merged", result.files_merged},
            {"files_installed", result.files_installed},
            {"elapsed_ms", ms}
        };
        if (!result.error.empty()) {
            out["error"] = result.error;
        }
        emit(out);
    }
}

// ── mod pack ──────────────────────────────────────────────────────────

static void cmd_mod_pack(const std::string& input_dir,
                         const std::string& cpklist_path,
                         const std::string& output_dir,
                         const std::string& platform) {
    if (!fs::is_directory(input_dir)) {
        emit_error("dossier d'entree inexistant: " + input_dir);
        return;
    }
    if (!fs::exists(cpklist_path)) {
        emit_error("cpk_list introuvable: " + cpklist_path);
        return;
    }

    auto t0 = std::chrono::steady_clock::now();

    const bool is_switch = (platform == "switch" || platform == "SWITCH");
    auto result = viola::cpk_update_file_list(
        fs::path(cpklist_path),
        fs::path(input_dir),
        fs::path(output_dir),
        is_switch ? viola::Platform::Switch : viola::Platform::PC);

    auto t1 = std::chrono::steady_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    json out = {
        {"ok", result.success},
        {"files_updated", result.files_updated},
        {"files_added", result.files_added},
        {"total_entries", result.total_entries},
        {"elapsed_ms", ms}
    };
    if (!result.success) {
        out["error"] = result.error;
    }
    emit(out);
}

// ── mod unpack ────────────────────────────────────────────────────────

static void cmd_mod_unpack(const std::string& cpk_path,
                           const std::string& output_dir) {
    if (!fs::exists(cpk_path)) {
        emit_error("fichier CPK introuvable: " + cpk_path);
        return;
    }

    auto t0 = std::chrono::steady_clock::now();

    criware::CpkReader reader;
    if (!reader.open(fs::path(cpk_path))) {
        emit_error("impossible d'ouvrir le CPK: " + cpk_path);
        return;
    }

    const auto& entries = reader.list();
    const fs::path out_root(output_dir);
    size_t extracted = 0;
    size_t errors = 0;

    for (const auto& entry : entries) {
        fs::path out_path = out_root;
        if (!entry.directory.empty()) {
            out_path /= entry.directory;
        }
        out_path /= entry.filename;

        auto data = reader.extract(entry);
        if (data.empty() && entry.size > 0) {
            ++errors;
            continue;
        }
        if (write_file(out_path, data)) {
            ++extracted;
        } else {
            ++errors;
        }
    }

    auto t1 = std::chrono::steady_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    emit(json{
        {"ok", errors == 0},
        {"entries", entries.size()},
        {"extracted", extracted},
        {"errors", errors},
        {"output", output_dir},
        {"elapsed_ms", ms}
    });
}

// ── mod dump ──────────────────────────────────────────────────────────

static void cmd_mod_dump(const std::string& game_path,
                         const std::string& output_dir,
                         int threads) {
    if (!fs::is_directory(game_path)) {
        emit_error("dossier du jeu introuvable: " + game_path);
        return;
    }

    auto t0 = std::chrono::steady_clock::now();

    viola::DumpStats stats;
    viola::DumpOptions opts;
    opts.threads = threads;
    opts.recursive = true;
    opts.on_progress = [](const viola::DumpStats& s, const std::string& cpk) {
        spdlog::info("mod dump: [{}/{}] {}",
                     s.cpk_processed.load(), s.cpk_found.load(), cpk);
    };

    const auto total = viola::batch_extract(
        fs::path(game_path), fs::path(output_dir), opts, stats);

    auto t1 = std::chrono::steady_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    emit(json{
        {"ok", true},
        {"cpk_found", stats.cpk_found.load()},
        {"cpk_processed", stats.cpk_processed.load()},
        {"files_extracted", total},
        {"elapsed_ms", ms}
    });
}

// ── mod conflicts ─────────────────────────────────────────────────────

static void cmd_mod_conflicts(const std::vector<std::string>& sources,
                              bool json_output) {
    auto mods = mods_from_paths(sources);
    if (mods.empty()) {
        emit_error("aucun mod trouve");
        return;
    }

    auto report = modding::detect_conflicts(mods);

    if (json_output) {
        // Format JSON structure demande
        json conflicts_json = json::object();
        for (const auto& [path, owners] : report.conflicts) {
            conflicts_json[path] = owners;
        }
        emit(json{
            {"has_conflicts", report.has_conflicts()},
            {"count", report.count()},
            {"conflicts", conflicts_json}
        });
    } else {
        json conflicts_json = json::object();
        for (const auto& [path, owners] : report.conflicts) {
            conflicts_json[path] = owners;
        }
        emit(json{
            {"ok", true},
            {"has_conflicts", report.has_conflicts()},
            {"conflict_count", report.count()},
            {"conflicts", conflicts_json}
        });
    }
}

// ── mod profile ───────────────────────────────────────────────────────

static void cmd_profile_list(const std::string& profiles_dir_opt,
                             bool json_output) {
    auto dir = resolve_profiles_dir(profiles_dir_opt);
    modding::ProfileManager mgr(dir);

    auto profiles = mgr.list_profiles();

    if (json_output) {
        // Format JSON structure : tableau de profils
        json arr = json::array();
        for (const auto& p : profiles) {
            json mods_arr = json::array();
            for (const auto& m : p.mods) {
                mods_arr.push_back(m.name);
            }
            arr.push_back(json{
                {"name", p.name},
                {"mods", mods_arr},
                {"created_at", p.created_at}
            });
        }
        emit(arr);
    } else {
        json arr = json::array();
        for (const auto& p : profiles) {
            arr.push_back(json{
                {"name", p.name},
                {"created_at", p.created_at},
                {"last_modified", p.last_modified},
                {"mods_count", p.mods.size()},
                {"selected_cpk", p.selected_cpk_name}
            });
        }
        emit(json{{"ok", true}, {"profiles", arr}});
    }
}

static void cmd_profile_create(const std::string& name,
                               const std::vector<std::string>& mod_names,
                               const std::string& profiles_dir_opt) {
    if (name.empty()) {
        emit_error("nom de profil requis");
        return;
    }

    auto dir = resolve_profiles_dir(profiles_dir_opt);
    modding::ProfileManager mgr(dir);

    modding::ModProfile profile;
    profile.name = name;

    // Generer un timestamp ISO8601 pour created_at
    {
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
        profile.created_at = oss.str();
    }

    for (const auto& m : mod_names) {
        modding::ModProfileEntry entry;
        entry.name = m;
        entry.enabled = true;
        profile.mods.push_back(std::move(entry));
    }

    if (mgr.save_profile(std::move(profile))) {
        emit(json{{"ok", true}, {"name", name}});
    } else {
        emit_error("impossible de sauvegarder le profil");
    }
}

static void cmd_profile_apply(const std::string& name,
                              const std::string& game_path,
                              const std::string& cpklist_path,
                              const std::string& mods_dir_str,
                              const std::string& profiles_dir_opt,
                              const std::string& platform) {
    if (game_path.empty()) {
        emit_error("--game est requis");
        return;
    }

    auto dir = resolve_profiles_dir(profiles_dir_opt);
    modding::ProfileManager mgr(dir);

    auto profile = mgr.load_profile(name);
    if (!profile) {
        emit_error("profil introuvable: " + name);
        return;
    }

    // Construire la liste de ModInfo a partir du profil et du dossier de mods
    const fs::path mods_base = mods_dir_str.empty()
        ? fs::path("mods")
        : fs::path(mods_dir_str);

    std::vector<modding::ModInfo> mods;
    for (const auto& entry : profile->mods) {
        if (!entry.enabled) continue;

        const auto mod_path = mods_base / entry.name;
        if (!fs::is_directory(mod_path)) {
            spdlog::warn("mod profile apply: mod '{}' introuvable dans '{}'",
                         entry.name, mods_base.string());
            continue;
        }

        modding::ModInfo info;
        info.name = entry.name;
        info.path = mod_path;
        info.enabled = true;
        info.metadata = modding::load_mod_metadata(mod_path);
        mods.push_back(std::move(info));
    }

    if (mods.empty()) {
        emit_error("aucun mod valide dans le profil");
        return;
    }

    const bool is_switch = (platform == "switch" || platform == "SWITCH");

    modding::InstallOptions opts;
    opts.game_path = fs::path(game_path);
    opts.cpklist_path = cpklist_path.empty() ? fs::path{} : fs::path(cpklist_path);
    opts.platform = is_switch ? modding::Platform::Switch : modding::Platform::PC;
    opts.do_pack = !cpklist_path.empty();
    opts.cleanup_temp = true;

    auto result = modding::install_mods(mods, opts);

    emit(json{
        {"ok", result.success},
        {"profile", name},
        {"mods_applied", result.mods_applied},
        {"files_installed", result.files_installed},
        {"error", result.error}
    });
}

static void cmd_profile_delete(const std::string& name,
                               const std::string& profiles_dir_opt) {
    auto dir = resolve_profiles_dir(profiles_dir_opt);
    modding::ProfileManager mgr(dir);

    if (mgr.delete_profile(name)) {
        emit(json{{"ok", true}, {"deleted", name}});
    } else {
        emit_error("profil inexistant: " + name);
    }
}

// ── mod config ───────────────────────────────────────────────────────

static void cmd_config_show(const std::string& config_path_str) {
    const fs::path cfg_path = config_path_str.empty()
        ? fs::path("iecode_config.json")
        : fs::path(config_path_str);

    modding::ConfigManager mgr{cfg_path};
    auto app_cfg = mgr.load();

    json out = {
        {"ok", true},
        {"game_path", app_cfg.game_path.generic_string()},
        {"mods_dir", app_cfg.mods_dir.generic_string()},
        {"temp_dir", app_cfg.temp_dir.generic_string()},
        {"profiles_dir", app_cfg.profiles_dir.generic_string()},
        {"last_applied_profile", app_cfg.last_applied_profile},
        {"selected_cpk_name", app_cfg.selected_cpk_name},
        {"show_technical_logs", app_cfg.show_technical_logs},
        {"game_version", app_cfg.game_version},
        {"mods_count", app_cfg.mods.size()},
    };
    emit(out);
}

static void cmd_config_set_game(const std::string& game_path_str,
                                const std::string& config_path_str) {
    if (game_path_str.empty()) {
        emit_error("chemin du jeu requis");
        return;
    }

    const fs::path gp(game_path_str);
    if (!modding::validate_game_path(gp)) {
        emit_error("dossier invalide (nie.exe ou data/ manquant) : " + game_path_str);
        return;
    }

    const fs::path cfg_path = config_path_str.empty()
        ? fs::path("iecode_config.json")
        : fs::path(config_path_str);

    modding::ConfigManager mgr{cfg_path};
    auto app_cfg = mgr.load();
    app_cfg.game_path = gp;

    if (mgr.save(app_cfg)) {
        emit(json{{"ok", true}, {"game_path", gp.generic_string()}});
    } else {
        emit_error("impossible de sauvegarder la configuration");
    }
}

static void cmd_config_detect_steam(const std::string& config_path_str) {
    auto detection = modding::detect_game_path();
    if (!detection) {
        emit_error("jeu Steam introuvable (app_id=2799860)");
        return;
    }

    // Sauvegarder dans la config si un chemin est fourni
    if (!config_path_str.empty()) {
        const fs::path cfg_p{config_path_str};
        modding::ConfigManager mgr{cfg_p};
        auto app_cfg = mgr.load();
        app_cfg.game_path = detection->game_path;
        mgr.save(app_cfg);
    }

    emit(json{
        {"ok", true},
        {"game_path", detection->game_path.generic_string()},
        {"steam_path", detection->steam_path.generic_string()},
        {"library_folder", detection->library_folder},
        {"auto_detected", detection->auto_detected},
    });
}

// ── mod gamebanana search ─────────────────────────────────────────────

static void cmd_gamebanana_search(const std::string& query,
                                  int page,
                                  int page_size) {
    auto result_opt = query.empty()
        ? modding::gamebanana_list_mods(page, page_size)
        : modding::gamebanana_search_mods(query, page, page_size);

    if (!result_opt) {
        emit_error("erreur lors de la recherche GameBanana");
        return;
    }

    const auto& result = *result_opt;

    json mods_arr = json::array();
    for (const auto& mod : result.mods) {
        mods_arr.push_back(json{
            {"id",            mod.id},
            {"name",          mod.name},
            {"page_url",      mod.page_url},
            {"thumbnail_url", mod.thumbnail_url},
            {"downloads",     mod.downloads},
            {"submitter",     mod.submitter},
        });
    }

    emit(json{
        {"ok",        true},
        {"page",      result.page},
        {"page_size", result.page_size},
        {"has_more",  result.has_more},
        {"count",     mods_arr.size()},
        {"mods",      mods_arr},
    });
}

// ── mod gamebanana info ──────────────────────────────────────────────

static void cmd_gamebanana_info(int mod_id) {
    auto mod_opt = modding::gamebanana_get_mod(mod_id);
    if (!mod_opt) {
        emit_error(fmt::format("mod {} introuvable ou erreur reseau", mod_id));
        return;
    }

    const auto& mod = *mod_opt;

    json out = {
        {"ok",             true},
        {"id",             mod.id},
        {"name",           mod.name},
        {"page_url",       mod.page_url},
        {"download_url",   mod.download_url},
        {"downloads",      mod.downloads},
        {"date_added",     mod.date_added},
        {"date_modified",  mod.date_modified},
        {"description",    mod.description},
    };

    // Ajouter les fichiers disponibles
    auto files_opt = modding::gamebanana_get_files(mod_id);
    if (files_opt) {
        json files_arr = json::array();
        for (const auto& f : *files_opt) {
            files_arr.push_back(json{
                {"id",           f.id},
                {"filename",     f.filename},
                {"download_url", f.download_url},
                {"file_size",    f.file_size},
                {"downloads",    f.downloads},
            });
        }
        out["files"] = files_arr;
    }

    emit(out);
}

// ── mod gamebanana download ──────────────────────────────────────────

static void cmd_gamebanana_download(int mod_id,
                                    const std::string& output_dir) {
    const fs::path out_path = output_dir.empty()
        ? fs::path("mods")
        : fs::path(output_dir);

    spdlog::info("gamebanana: telechargement du mod {} vers '{}'",
                 mod_id, out_path.string());

    auto result = modding::gamebanana_download_mod_by_id(mod_id, out_path);

    emit(json{
        {"ok",               result.success},
        {"mod_id",           mod_id},
        {"output_path",      result.output_path.generic_string()},
        {"bytes_downloaded", result.bytes_downloaded},
        {"error",            result.error},
    });
}

// ── mod update check ─────────────────────────────────────────────────

static void cmd_update_check_mods(const std::vector<std::string>& sources) {
    auto mods = mods_from_paths(sources);
    if (mods.empty()) {
        emit_error("aucun mod trouve pour verifier les mises a jour");
        return;
    }

    auto result = modding::check_mod_updates(mods);

    json results_arr = json::array();
    for (const auto& r : result.results) {
        results_arr.push_back(json{
            {"mod_name",             r.mod_name},
            {"gamebanana_id",        r.gamebanana_id},
            {"update_available",     r.update_available},
            {"installed_version",    r.installed_version},
            {"latest_date_modified", r.latest_date_modified},
            {"page_url",             r.page_url},
        });
    }

    emit(json{
        {"ok",                true},
        {"checked",           result.checked},
        {"updates_available", result.updates_available},
        {"results",           results_arr},
    });
}

// ── mod update app ───────────────────────────────────────────────────

static void cmd_update_check_app(const std::string& current_version) {
    if (current_version.empty()) {
        emit_error("--version est requis pour verifier les mises a jour app");
        return;
    }

    auto result = modding::check_app_update(current_version);

    json out = {
        {"ok",                true},
        {"update_available",  result.update_available},
        {"current_version",   result.current_version},
        {"latest_version",    result.latest_version},
    };

    if (!result.error.empty()) {
        out["error"] = result.error;
    }

    if (result.release) {
        json assets_arr = json::array();
        for (const auto& a : result.release->assets) {
            assets_arr.push_back(json{
                {"name",         a.name},
                {"download_url", a.download_url},
                {"size",         a.size},
            });
        }

        out["release"] = json{
            {"tag_name",     result.release->tag_name},
            {"name",         result.release->name},
            {"published_at", result.release->published_at},
            {"html_url",     result.release->html_url},
            {"body",         result.release->body},
            {"assets",       assets_arr},
        };
    }

    emit(out);
}

// ── mod deps check ───────────────────────────────────────────────────

static void cmd_deps_check(const std::vector<std::string>& sources) {
    auto mods = mods_from_paths(sources);
    if (mods.empty()) {
        emit_error("aucun mod trouve");
        return;
    }

    auto result = modding::check_dependencies(mods);

    json out = {
        {"ok", true},
        {"satisfied", result.satisfied},
        {"missing", result.missing},
        {"version_mismatch", result.version_mismatch},
        {"optional_missing", result.optional_missing},
        {"install_order", result.install_order},
        {"circular_dependencies", result.circular_dependencies},
    };
    emit(out);
}

// ── mod deps order ──────────────────────────────────────────────────

static void cmd_deps_order(const std::vector<std::string>& sources) {
    auto mods = mods_from_paths(sources);
    if (mods.empty()) {
        emit_error("aucun mod trouve");
        return;
    }

    auto ordered = modding::resolve_install_order(mods);

    json order_arr = json::array();
    for (const auto& m : ordered) {
        order_arr.push_back(json{
            {"name", m.name},
            {"version", m.metadata.mod_version},
        });
    }

    emit(json{
        {"ok", !ordered.empty() || mods.empty()},
        {"count", ordered.size()},
        {"install_order", order_arr},
    });
}

// ── mod compat check ────────────────────────────────────────────────

static void cmd_compat_check(const std::vector<std::string>& sources,
                             const std::string& game_path_str,
                             const std::string& game_version_override) {
    auto mods = mods_from_paths(sources);
    if (mods.empty()) {
        emit_error("aucun mod trouve");
        return;
    }

    // Determiner la version du jeu
    std::string game_version = game_version_override;
    if (game_version.empty() && !game_path_str.empty()) {
        auto detected = modding::detect_game_version(fs::path(game_path_str));
        if (detected) {
            game_version = *detected;
        }
    }

    auto results = modding::check_compatibility(mods, game_version);

    json results_arr = json::array();
    size_t incompatible_count = 0;
    for (const auto& r : results) {
        results_arr.push_back(json{
            {"mod_name", r.mod_name},
            {"compatible", r.compatible},
            {"mod_game_version", r.mod_game_version},
            {"current_game_version", r.current_game_version},
            {"reason", r.reason},
        });
        if (!r.compatible) ++incompatible_count;
    }

    emit(json{
        {"ok", true},
        {"game_version", game_version},
        {"total", results.size()},
        {"compatible", results.size() - incompatible_count},
        {"incompatible", incompatible_count},
        {"results", results_arr},
    });
}

// ── mod package ─────────────────────────────────────────────────────

static void cmd_package_mod(const std::string& mod_dir_str,
                            const std::string& output_str) {
    const fs::path mod_dir(mod_dir_str);
    if (!fs::is_directory(mod_dir)) {
        emit_error("dossier de mod inexistant: " + mod_dir_str);
        return;
    }

    modding::PackageOptions opts;
    opts.mod_dir = mod_dir;
    opts.output_path = output_str.empty()
        ? fs::path(mod_dir.filename().string() + ".zip")
        : fs::path(output_str);
    opts.validate = true;
    opts.include_readme = true;

    auto result = modding::package_mod(opts);

    emit(json{
        {"ok", result.success},
        {"output", result.output_path.generic_string()},
        {"files_packaged", result.files_packaged},
        {"total_size_bytes", result.total_size_bytes},
        {"error", result.error},
    });
}

// ── mod validate ────────────────────────────────────────────────────

static void cmd_validate_mod(const std::string& mod_dir_str) {
    auto result = modding::validate_mod_structure(fs::path(mod_dir_str));

    emit(json{
        {"ok", true},
        {"valid", result.valid},
        {"errors", result.errors},
        {"warnings", result.warnings},
    });
}

// ── mod init ────────────────────────────────────────────────────────

static void cmd_init_mod(const std::string& dir_str,
                         const std::string& mod_name,
                         const std::string& author) {
    if (mod_name.empty()) {
        emit_error("--name est requis");
        return;
    }

    const fs::path dir = dir_str.empty() ? fs::path(mod_name) : fs::path(dir_str);
    const std::string auth = author.empty() ? "Unknown" : author;

    if (modding::create_mod_template(dir, mod_name, auth)) {
        emit(json{
            {"ok", true},
            {"path", dir.generic_string()},
            {"name", mod_name},
            {"author", auth},
        });
    } else {
        emit_error("impossible de creer le template");
    }
}

// ── Registration ──────────────────────────────────────────────────────

void register_mod_command(CLI::App& app) {
    auto* mod = app.add_subcommand("mod", "Gestion des mods (merge, install, pack, dump, profils)");
    mod->require_subcommand(1);

    // Flag --json global a la commande mod
    static bool json_output = false;
    mod->add_flag("--json", json_output, "Sortie JSON structuree");

    // ── mod merge ─────────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("merge", "Fusionner des mods dans un dossier");
        static std::vector<std::string> sources;
        static std::string output_dir = "merged";
        static bool do_pack = false;
        static std::string cpklist_path;
        static std::string platform = "pc";

        cmd->add_option("sources", sources, "Dossiers de mods a fusionner")->required();
        cmd->add_option("-o,--output", output_dir, "Dossier de sortie")->default_val("merged");
        cmd->add_flag("--pack", do_pack, "Mettre a jour cpk_list.cfg.bin apres fusion");
        cmd->add_option("--cpklist", cpklist_path, "Chemin vers cpk_list.cfg.bin");
        cmd->add_option("--platform", platform, "Plateforme (pc ou switch)")->default_val("pc");

        cmd->callback([]() {
            cmd_mod_merge(sources, output_dir, do_pack, cpklist_path, platform);
        });
    }

    // ── mod install ───────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("install", "Installer des mods dans le jeu");
        static std::vector<std::string> sources;
        static std::string game_path;
        static std::string cpklist_path;
        static bool no_pack = false;
        static std::string platform = "pc";
        static std::string data_dir;

        cmd->add_option("sources", sources, "Dossiers de mods")->required();
        cmd->add_option("--game", game_path, "Chemin vers le dossier du jeu")->required();
        cmd->add_option("--cpklist", cpklist_path, "Chemin vers cpk_list.cfg.bin");
        cmd->add_flag("--no-pack", no_pack, "Ne pas mettre a jour cpk_list.cfg.bin");
        cmd->add_option("--platform", platform, "Plateforme (pc ou switch)")->default_val("pc");
        cmd->add_option("--data-dir", data_dir, "Dossier de donnees iecode (defaut: ./iecode_data/)");

        cmd->callback([]() {
            cmd_mod_install(sources, game_path, cpklist_path, no_pack,
                            platform, data_dir, json_output);
        });
    }

    // ── mod pack ──────────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("pack", "Mettre a jour cpk_list.cfg.bin");
        static std::string input_dir;
        static std::string cpklist_path;
        static std::string output_dir = "mod_output";
        static std::string platform = "pc";

        cmd->add_option("--input,-i", input_dir, "Dossier de fichiers moddes")->required();
        cmd->add_option("--cpklist", cpklist_path, "Chemin vers cpk_list.cfg.bin")->required();
        cmd->add_option("-o,--output", output_dir, "Dossier de sortie")->default_val("mod_output");
        cmd->add_option("--platform", platform, "Plateforme (pc ou switch)")->default_val("pc");

        cmd->callback([]() {
            cmd_mod_pack(input_dir, cpklist_path, output_dir, platform);
        });
    }

    // ── mod unpack ────────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("unpack", "Extraire une archive CPK");
        static std::string cpk_path;
        static std::string output_dir = "unpacked";

        cmd->add_option("cpk", cpk_path, "Fichier CPK a extraire")->required();
        cmd->add_option("-o,--output", output_dir, "Dossier de sortie")->default_val("unpacked");

        cmd->callback([]() {
            cmd_mod_unpack(cpk_path, output_dir);
        });
    }

    // ── mod dump ──────────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("dump", "Extraction massive des CPK du jeu");
        static std::string game_path;
        static std::string output_dir = ".";
        static int threads = 0;

        cmd->add_option("--game", game_path, "Dossier du jeu")->required();
        cmd->add_option("-o,--output", output_dir, "Dossier de sortie")->default_val(".");
        cmd->add_option("-t,--threads", threads, "Nombre de threads (0 = auto)");

        cmd->callback([]() {
            cmd_mod_dump(game_path, output_dir, threads);
        });
    }

    // ── mod conflicts ─────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("conflicts", "Detecter les conflits entre mods");
        static std::vector<std::string> sources;

        cmd->add_option("sources", sources, "Dossiers de mods a analyser")->required();

        cmd->callback([]() {
            cmd_mod_conflicts(sources, json_output);
        });
    }

    // ── mod profile ───────────────────────────────────
    {
        auto* profile = mod->add_subcommand("profile", "Gestion des profils de mods");
        profile->require_subcommand(1);

        // mod profile list
        {
            auto* cmd = profile->add_subcommand("list", "Lister les profils");
            static std::string profiles_dir;
            cmd->add_option("--profiles-dir", profiles_dir, "Dossier des profils");
            cmd->callback([]() { cmd_profile_list(profiles_dir, json_output); });
        }

        // mod profile create
        {
            auto* cmd = profile->add_subcommand("create", "Creer un profil");
            static std::string name;
            static std::vector<std::string> mod_names;
            static std::string profiles_dir;

            cmd->add_option("name", name, "Nom du profil")->required();
            cmd->add_option("--mods", mod_names, "Noms des mods (separes par virgule)");
            cmd->add_option("--profiles-dir", profiles_dir, "Dossier des profils");

            cmd->callback([]() {
                cmd_profile_create(name, mod_names, profiles_dir);
            });
        }

        // mod profile apply
        {
            auto* cmd = profile->add_subcommand("apply", "Appliquer un profil au jeu");
            static std::string name;
            static std::string game_path;
            static std::string cpklist_path;
            static std::string mods_dir;
            static std::string profiles_dir;
            static std::string platform = "pc";

            cmd->add_option("name", name, "Nom du profil")->required();
            cmd->add_option("--game", game_path, "Chemin vers le jeu")->required();
            cmd->add_option("--cpklist", cpklist_path, "Chemin vers cpk_list.cfg.bin");
            cmd->add_option("--mods-dir", mods_dir, "Dossier contenant les mods");
            cmd->add_option("--profiles-dir", profiles_dir, "Dossier des profils");
            cmd->add_option("--platform", platform, "Plateforme (pc ou switch)")->default_val("pc");

            cmd->callback([]() {
                cmd_profile_apply(name, game_path, cpklist_path, mods_dir,
                                  profiles_dir, platform);
            });
        }

        // mod profile delete
        {
            auto* cmd = profile->add_subcommand("delete", "Supprimer un profil");
            static std::string name;
            static std::string profiles_dir;

            cmd->add_option("name", name, "Nom du profil")->required();
            cmd->add_option("--profiles-dir", profiles_dir, "Dossier des profils");

            cmd->callback([]() {
                cmd_profile_delete(name, profiles_dir);
            });
        }
    }

    // ── mod config ───────────────────────────────────
    {
        auto* cfg_sub = mod->add_subcommand("config", "Gestion de la configuration");
        cfg_sub->require_subcommand(1);

        // mod config show
        {
            auto* cmd = cfg_sub->add_subcommand("show", "Afficher la configuration courante");
            static std::string cfg_show_path;
            cmd->add_option("--config", cfg_show_path, "Chemin vers le fichier de config");
            cmd->callback([]() { cmd_config_show(cfg_show_path); });
        }

        // mod config set-game
        {
            auto* cmd = cfg_sub->add_subcommand("set-game", "Definir le chemin du jeu");
            static std::string cfg_set_game_path;
            static std::string cfg_set_config_path;

            cmd->add_option("path", cfg_set_game_path, "Chemin vers le dossier du jeu")->required();
            cmd->add_option("--config", cfg_set_config_path, "Chemin vers le fichier de config");

            cmd->callback([]() {
                cmd_config_set_game(cfg_set_game_path, cfg_set_config_path);
            });
        }

        // mod config detect-steam
        {
            auto* cmd = cfg_sub->add_subcommand("detect-steam",
                "Auto-detecter Steam et le chemin du jeu");
            static std::string cfg_detect_path;
            cmd->add_option("--config", cfg_detect_path, "Chemin vers le fichier de config (sauvegarde auto)");
            cmd->callback([]() { cmd_config_detect_steam(cfg_detect_path); });
        }
    }

    // ── mod gamebanana ───────────────────────────────────
    {
        auto* gb = mod->add_subcommand("gamebanana",
            "Parcourir et telecharger des mods depuis GameBanana");
        gb->require_subcommand(1);

        // mod gamebanana search <query>
        {
            auto* cmd = gb->add_subcommand("search", "Rechercher des mods");
            static std::string gb_query;
            static int gb_page = 1;
            static int gb_page_size = 50;

            cmd->add_option("query", gb_query, "Terme de recherche (vide = liste recents)");
            cmd->add_option("--page,-p", gb_page, "Numero de page")->default_val(1);
            cmd->add_option("--per-page,-n", gb_page_size, "Mods par page")->default_val(50);

            cmd->callback([]() {
                cmd_gamebanana_search(gb_query, gb_page, gb_page_size);
            });
        }

        // mod gamebanana info <mod_id>
        {
            auto* cmd = gb->add_subcommand("info", "Details d'un mod");
            static int gb_mod_id = 0;

            cmd->add_option("mod_id", gb_mod_id, "ID du mod GameBanana")->required();

            cmd->callback([]() {
                cmd_gamebanana_info(gb_mod_id);
            });
        }

        // mod gamebanana download <mod_id>
        {
            auto* cmd = gb->add_subcommand("download", "Telecharger un mod");
            static int gb_dl_mod_id = 0;
            static std::string gb_dl_output = "mods";

            cmd->add_option("mod_id", gb_dl_mod_id, "ID du mod GameBanana")->required();
            cmd->add_option("-o,--output", gb_dl_output, "Dossier de sortie")->default_val("mods");

            cmd->callback([]() {
                cmd_gamebanana_download(gb_dl_mod_id, gb_dl_output);
            });
        }
    }

    // ── mod update ───────────────────────────────────────
    {
        auto* update = mod->add_subcommand("update",
            "Verifier les mises a jour (app et mods)");
        update->require_subcommand(1);

        // mod update check <mods...>
        {
            auto* cmd = update->add_subcommand("check",
                "Verifier les mises a jour des mods installes");
            static std::vector<std::string> upd_sources;

            cmd->add_option("sources", upd_sources, "Dossiers de mods")->required();

            cmd->callback([]() {
                cmd_update_check_mods(upd_sources);
            });
        }

        // mod update app
        {
            auto* cmd = update->add_subcommand("app",
                "Verifier les mises a jour de l'application (GitHub)");
            static std::string upd_version;

            cmd->add_option("--version,-v", upd_version,
                "Version actuelle (ex: 1.7.0)")->required();

            cmd->callback([]() {
                cmd_update_check_app(upd_version);
            });
        }
    }

    // ── mod deps ─────────────────────────────────────────
    {
        auto* deps = mod->add_subcommand("deps",
            "Resolution de dependances entre mods");
        deps->require_subcommand(1);

        // mod deps check <mods_dir>
        {
            auto* cmd = deps->add_subcommand("check",
                "Verifier les dependances de tous les mods");
            static std::vector<std::string> deps_sources;

            cmd->add_option("sources", deps_sources, "Dossiers de mods")->required();

            cmd->callback([]() {
                cmd_deps_check(deps_sources);
            });
        }

        // mod deps order <mods_dir>
        {
            auto* cmd = deps->add_subcommand("order",
                "Afficher l'ordre d'installation (tri topologique)");
            static std::vector<std::string> deps_order_sources;

            cmd->add_option("sources", deps_order_sources, "Dossiers de mods")->required();

            cmd->callback([]() {
                cmd_deps_order(deps_order_sources);
            });
        }
    }

    // ── mod compat ───────────────────────────────────────
    {
        auto* compat = mod->add_subcommand("compat",
            "Verification de compatibilite avec la version du jeu");
        compat->require_subcommand(1);

        // mod compat check <mods_dir> --game <path>
        {
            auto* cmd = compat->add_subcommand("check",
                "Verifier la compatibilite des mods avec le jeu installe");
            static std::vector<std::string> compat_sources;
            static std::string compat_game_path;
            static std::string compat_game_version;

            cmd->add_option("sources", compat_sources, "Dossiers de mods")->required();
            cmd->add_option("--game", compat_game_path, "Chemin vers le dossier du jeu");
            cmd->add_option("--game-version", compat_game_version,
                "Version du jeu (ex: 5.00.24.00) — override la detection");

            cmd->callback([]() {
                cmd_compat_check(compat_sources, compat_game_path,
                                 compat_game_version);
            });
        }
    }

    // ── mod package ──────────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("package",
            "Empaqueter un mod en archive ZIP pour distribution");
        static std::string pkg_mod_dir;
        static std::string pkg_output;

        cmd->add_option("mod_dir", pkg_mod_dir, "Dossier du mod a empaqueter")->required();
        cmd->add_option("-o,--output", pkg_output, "Chemin du fichier ZIP de sortie");

        cmd->callback([]() {
            cmd_package_mod(pkg_mod_dir, pkg_output);
        });
    }

    // ── mod validate ─────────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("validate",
            "Valider la structure d'un mod");
        static std::string val_mod_dir;

        cmd->add_option("mod_dir", val_mod_dir, "Dossier du mod a valider")->required();

        cmd->callback([]() {
            cmd_validate_mod(val_mod_dir);
        });
    }

    // ── mod init ─────────────────────────────────────────
    {
        auto* cmd = mod->add_subcommand("init",
            "Creer un template de mod (mod_data.json + data/)");
        static std::string init_dir;
        static std::string init_name;
        static std::string init_author;

        cmd->add_option("dir", init_dir, "Dossier cible (defaut: nom du mod)");
        cmd->add_option("--name", init_name, "Nom du mod")->required();
        cmd->add_option("--author", init_author, "Nom de l'auteur");

        cmd->callback([]() {
            cmd_init_mod(init_dir, init_name, init_author);
        });
    }
}

} // namespace iecode::cli
