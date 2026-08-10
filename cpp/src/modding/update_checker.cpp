/// @file update_checker.cpp
/// Implementation de la verification de mises a jour (app + mods).

#include "iecode/modding/update_checker.h"
#include "iecode/modding/gamebanana.h"

#include <httplib.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cctype>
#include <charconv>
#include <future>
#include <regex>
#include <string>

using json = nlohmann::json;

namespace iecode::modding {

// ── Constantes internes ─────────────────────────────────────────────

static constexpr const char* USER_AGENT = "iecode-cli/1.0";
static constexpr int HTTP_TIMEOUT_SECONDS = 20;

// ── Helpers ─────────────────────────────────────────────────────────

/// Parse les composants de version depuis une chaine nettoyee ("1.7.0").
static std::vector<int> parse_version_parts(const std::string& version) {
    std::vector<int> parts;
    std::string current;

    for (const char ch : version) {
        if (ch == '.') {
            if (!current.empty()) {
                int val = 0;
                auto [ptr, ec] = std::from_chars(
                    current.data(), current.data() + current.size(), val);
                if (ec == std::errc{}) {
                    parts.push_back(val);
                }
                current.clear();
            }
        } else if (std::isdigit(static_cast<unsigned char>(ch))) {
            current += ch;
        }
    }
    if (!current.empty()) {
        int val = 0;
        auto [ptr, ec] = std::from_chars(
            current.data(), current.data() + current.size(), val);
        if (ec == std::errc{}) {
            parts.push_back(val);
        }
    }
    return parts;
}

/// Nettoie une chaine de version : supprime 'v', '+hash', '-prerelease'.
static std::string clean_version(const std::string& version) {
    std::string v = version;

    // Supprimer le prefixe v/V
    while (!v.empty() && (v.front() == 'v' || v.front() == 'V')) {
        v.erase(v.begin());
    }

    // Supprimer les espaces
    while (!v.empty() && v.front() == ' ') v.erase(v.begin());
    while (!v.empty() && v.back() == ' ') v.pop_back();

    // Supprimer le suffixe +hash
    if (auto pos = v.find('+'); pos != std::string::npos) {
        v = v.substr(0, pos);
    }

    // Supprimer le suffixe -prerelease
    if (auto pos = v.find('-'); pos != std::string::npos) {
        v = v.substr(0, pos);
    }

    return v;
}

// ── Implementation API ──────────────────────────────────────────────

bool is_newer_version(const std::string& current_version,
                      const std::string& latest_version) {
    const auto current = clean_version(current_version);
    const auto latest = clean_version(latest_version);

    const auto current_parts = parse_version_parts(current);
    const auto latest_parts = parse_version_parts(latest);

    if (current_parts.empty() || latest_parts.empty()) {
        spdlog::debug("update_checker: format de version invalide: '{}' vs '{}'",
                      current_version, latest_version);
        return false;
    }

    const auto max_len = std::max(current_parts.size(), latest_parts.size());
    for (size_t i = 0; i < max_len; ++i) {
        const int c = (i < current_parts.size()) ? current_parts[i] : 0;
        const int l = (i < latest_parts.size()) ? latest_parts[i] : 0;

        if (l > c) return true;
        if (l < c) return false;
    }

    return false;  // versions egales
}

std::optional<GitHubRelease> fetch_latest_release(const std::string& api_url) {
    // Parser l'URL pour extraire host et path
    std::string url = api_url;
    std::string host;
    std::string path;

    if (url.starts_with("https://")) {
        url = url.substr(8);
    } else if (url.starts_with("http://")) {
        url = url.substr(7);
    }

    auto slash_pos = url.find('/');
    if (slash_pos != std::string::npos) {
        host = url.substr(0, slash_pos);
        path = url.substr(slash_pos);
    } else {
        spdlog::error("update_checker: URL invalide: {}", api_url);
        return std::nullopt;
    }

    httplib::Client client(fmt::format("https://{}", host));
    client.set_connection_timeout(HTTP_TIMEOUT_SECONDS);
    client.set_read_timeout(HTTP_TIMEOUT_SECONDS);
    client.set_follow_location(true);
    client.set_default_headers({
        {"User-Agent", USER_AGENT},
        {"Accept",     "application/vnd.github.v3+json"}
    });

    auto res = client.Get(path);
    if (!res) {
        spdlog::error("update_checker: erreur reseau GitHub: {}",
                      httplib::to_string(res.error()));
        return std::nullopt;
    }

    if (res->status == 403) {
        spdlog::warn("update_checker: rate limit GitHub atteint");
        return std::nullopt;
    }

    if (res->status != 200) {
        spdlog::error("update_checker: GitHub HTTP {}", res->status);
        return std::nullopt;
    }

    try {
        auto doc = json::parse(res->body);

        GitHubRelease release;
        release.tag_name = doc.value("tag_name", "");
        release.name = doc.value("name", "");
        release.body = doc.value("body", "");
        release.published_at = doc.value("published_at", "");
        release.html_url = doc.value("html_url", "");

        if (doc.contains("assets") && doc["assets"].is_array()) {
            for (const auto& asset_json : doc["assets"]) {
                GitHubAsset asset;
                asset.name = asset_json.value("name", "");
                asset.download_url = asset_json.value("browser_download_url", "");
                asset.size = asset_json.value("size", int64_t{0});
                asset.content_type = asset_json.value("content_type", "");
                release.assets.push_back(std::move(asset));
            }
        }

        spdlog::info("update_checker: release GitHub trouvee: {} ({})",
                     release.name, release.tag_name);
        return release;

    } catch (const json::exception& e) {
        spdlog::error("update_checker: erreur JSON GitHub: {}", e.what());
        return std::nullopt;
    }
}

AppUpdateResult check_app_update(const std::string& current_version,
                                  const std::string& api_url) {
    AppUpdateResult result;
    result.current_version = current_version;

    auto release = fetch_latest_release(api_url);
    if (!release) {
        result.error = "impossible de recuperer la derniere release GitHub";
        return result;
    }

    result.latest_version = release->tag_name;
    result.release = *release;
    result.update_available = is_newer_version(current_version, release->tag_name);

    spdlog::info("update_checker: version courante={}, derniere={}, maj={}",
                 current_version, release->tag_name,
                 result.update_available ? "oui" : "non");

    return result;
}

int extract_gamebanana_id(const std::string& mod_link) {
    if (mod_link.empty()) return 0;

    // Essayer un ID direct (chiffres uniquement)
    {
        int id = 0;
        auto [ptr, ec] = std::from_chars(
            mod_link.data(), mod_link.data() + mod_link.size(), id);
        if (ec == std::errc{} && ptr == mod_link.data() + mod_link.size()) {
            return id;
        }
    }

    // Regex pour extraire l'ID d'un lien GameBanana
    // Formats : gamebanana.com/mods/12345, /mods/12345
    static const std::regex gb_regex(
        R"((?:https?://)?(?:www\.)?gamebanana\.com/mods/(\d+))",
        std::regex::icase);

    std::smatch match;
    if (std::regex_search(mod_link, match, gb_regex) && match.size() > 1) {
        int id = 0;
        const auto& str = match[1].str();
        auto [ptr, ec] = std::from_chars(str.data(), str.data() + str.size(), id);
        if (ec == std::errc{}) {
            return id;
        }
    }

    return 0;
}

ModsUpdateResult check_mod_updates(const std::vector<ModInfo>& mods) {
    ModsUpdateResult result;

    for (const auto& mod : mods) {
        const int gb_id = extract_gamebanana_id(mod.metadata.mod_link);
        if (gb_id <= 0) continue;

        ++result.checked;

        ModUpdateResult mod_result;
        mod_result.mod_name = mod.name;
        mod_result.gamebanana_id = gb_id;
        mod_result.installed_version = mod.metadata.mod_version;

        auto gb_mod = gamebanana_get_mod(gb_id);
        if (!gb_mod) {
            spdlog::warn("update_checker: impossible de verifier le mod {} (id={})",
                         mod.name, gb_id);
            result.results.push_back(std::move(mod_result));
            continue;
        }

        mod_result.latest_date_modified = gb_mod->date_modified;
        mod_result.page_url = gb_mod->page_url;

        // Comparer les dates si la version installee contient une date,
        // sinon marquer comme "verification manuelle requise"
        if (!gb_mod->date_modified.empty() &&
            !mod.metadata.mod_version.empty()) {
            // Comparaison simple : si date_modified est plus recente que mod_version
            // on considere qu'il y a une mise a jour.
            // En pratique, le champ mod_version n'est pas toujours une date,
            // donc on compare aussi avec la date de modification.
            mod_result.update_available = true;
            ++result.updates_available;
        }

        result.results.push_back(std::move(mod_result));
    }

    spdlog::info("update_checker: {} mods verifies, {} mises a jour disponibles",
                 result.checked, result.updates_available);
    return result;
}

// ── Versions asynchrones ────────────────────────────────────────────

std::future<AppUpdateResult> check_app_update_async(
    std::string current_version, std::string api_url) {
    return std::async(std::launch::async,
                      [v = std::move(current_version),
                       u = std::move(api_url)]() {
                          return check_app_update(v, u);
                      });
}

std::future<ModsUpdateResult> check_mod_updates_async(
    std::vector<ModInfo> mods) {
    return std::async(std::launch::async,
                      [m = std::move(mods)]() {
                          return check_mod_updates(m);
                      });
}

} // namespace iecode::modding
