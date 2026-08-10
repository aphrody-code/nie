/// @file gamebanana.cpp
/// Implementation du client API GameBanana.

#include "iecode/modding/gamebanana.h"

#include <httplib.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <future>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::modding {

// ── Constantes internes ─────────────────────────────────────────────

static constexpr const char* GAMEBANANA_API_HOST = "gamebanana.com";
static constexpr const char* GAMEBANANA_CORE_HOST = "api.gamebanana.com";
static constexpr const char* USER_AGENT = "iecode-cli/1.0";
static constexpr int HTTP_TIMEOUT_SECONDS = 20;

// ── Helpers ─────────────────────────────────────────────────────────

/// Cree un client HTTP configure pour GameBanana.
static httplib::Client make_client(const std::string& host) {
    httplib::Client client(fmt::format("https://{}", host));
    client.set_connection_timeout(HTTP_TIMEOUT_SECONDS);
    client.set_read_timeout(HTTP_TIMEOUT_SECONDS);
    client.set_follow_location(true);
    client.set_default_headers({
        {"User-Agent", USER_AGENT},
        {"Accept",     "application/json"}
    });
    return client;
}

/// Convertit une chaine en minuscules.
static std::string to_lower(std::string s) {
    for (auto& ch : s) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return s;
}

/// Extrait une valeur string d'un JSON, avec fallback.
static std::string json_str(const json& obj, const std::string& key,
                            const std::string& fallback = {}) {
    if (obj.contains(key) && obj[key].is_string()) {
        return obj[key].get<std::string>();
    }
    return fallback;
}

/// Extrait une valeur int d'un JSON, avec fallback.
static int json_int(const json& obj, const std::string& key, int fallback = 0) {
    if (obj.contains(key) && obj[key].is_number_integer()) {
        return obj[key].get<int>();
    }
    return fallback;
}

/// Resout l'URL de la miniature depuis _aPreviewMedia.
static std::string resolve_thumbnail(const json& record) {
    if (!record.contains("_aPreviewMedia") ||
        !record["_aPreviewMedia"].is_object()) {
        return {};
    }

    const auto& media = record["_aPreviewMedia"];
    if (!media.contains("_aImages") || !media["_aImages"].is_array()) {
        return {};
    }

    const auto& images = media["_aImages"];
    if (images.empty()) return {};

    const auto& first = images[0];
    if (!first.is_object()) return {};

    auto base_url = json_str(first, "_sBaseUrl");
    auto file = json_str(first, "_sFile530");
    if (file.empty()) {
        file = json_str(first, "_sFile");
    }

    if (!base_url.empty() && !file.empty()) {
        return fmt::format("{}/{}", base_url, file);
    }
    return {};
}

/// Parse un mod depuis un enregistrement Subfeed.
static GameBananaMod parse_subfeed_record(const json& record) {
    GameBananaMod mod;
    mod.id = json_int(record, "_idRow");
    mod.name = json_str(record, "_sName", fmt::format("Mod {}", mod.id));
    mod.page_url = json_str(record, "_sProfileUrl",
                            fmt::format("https://gamebanana.com/mods/{}", mod.id));
    mod.thumbnail_url = resolve_thumbnail(record);
    mod.date_added = json_str(record, "_tsDateAdded");
    mod.date_modified = json_str(record, "_tsDateModified");

    // Submitter
    if (record.contains("_aSubmitter") && record["_aSubmitter"].is_object()) {
        mod.submitter = json_str(record["_aSubmitter"], "_sName");
    }

    return mod;
}

/// Sanitise un nom de fichier (remplace les caracteres invalides par '_').
static std::string sanitize_filename(const std::string& name) {
    std::string result;
    result.reserve(name.size());
    for (const char ch : name) {
        if (ch == '/' || ch == '\\' || ch == ':' || ch == '*' ||
            ch == '?' || ch == '"' || ch == '<' || ch == '>' || ch == '|') {
            result += '_';
        } else {
            result += ch;
        }
    }
    // Supprimer les espaces en debut/fin
    while (!result.empty() && result.front() == ' ') result.erase(result.begin());
    while (!result.empty() && result.back() == ' ') result.pop_back();
    if (result.empty()) result = "mod";
    return result;
}

/// Genere un chemin unique dans un dossier (ajoute _N si collision).
static fs::path unique_directory(const fs::path& root, const std::string& name) {
    auto candidate = root / name;
    int counter = 1;
    while (fs::exists(candidate)) {
        candidate = root / fmt::format("{}_{}", name, counter);
        ++counter;
    }
    return candidate;
}

// ── Implementation API ──────────────────────────────────────────────

std::optional<GameBananaSearchResult> gamebanana_list_mods(int page,
                                                           int page_size) {
    auto client = make_client(GAMEBANANA_API_HOST);

    const auto path = fmt::format(
        "/apiv11/Game/{}/Subfeed?_nPage={}&_nPerPage={}"
        "&_sSort=new&_csvModelInclusions=Mod",
        GAMEBANANA_GAME_ID, page, page_size);

    auto res = client.Get(path);
    if (!res) {
        spdlog::error("gamebanana: erreur reseau (Subfeed) : {}",
                      httplib::to_string(res.error()));
        return std::nullopt;
    }

    if (res->status != 200) {
        spdlog::error("gamebanana: Subfeed HTTP {} : {}",
                      res->status, res->body.substr(0, 200));
        return std::nullopt;
    }

    try {
        auto doc = json::parse(res->body);
        GameBananaSearchResult result;
        result.page = page;
        result.page_size = page_size;

        if (!doc.contains("_aRecords") || !doc["_aRecords"].is_array()) {
            spdlog::warn("gamebanana: reponse Subfeed inattendue");
            return result;
        }

        const auto& records = doc["_aRecords"];
        for (const auto& record : records) {
            if (!record.is_object()) continue;

            auto model = json_str(record, "_sModelName");
            if (!model.empty() && to_lower(model) != "mod") continue;

            auto id = json_int(record, "_idRow");
            if (id <= 0) continue;

            result.mods.push_back(parse_subfeed_record(record));
        }

        result.has_more = (static_cast<int>(result.mods.size()) >= page_size);

        spdlog::info("gamebanana: {} mods charges (page {})",
                     result.mods.size(), page);
        return result;

    } catch (const json::exception& e) {
        spdlog::error("gamebanana: erreur JSON (Subfeed) : {}", e.what());
        return std::nullopt;
    }
}

std::optional<GameBananaSearchResult> gamebanana_search_mods(
    const std::string& query, int page, int page_size) {

    // Charger la page puis filtrer localement (GameBanana n'a pas de
    // recherche par texte sur le Subfeed).
    auto result = gamebanana_list_mods(page, page_size);
    if (!result) return std::nullopt;

    if (query.empty()) return result;

    const auto query_lower = to_lower(query);

    std::vector<GameBananaMod> filtered;
    for (auto& mod : result->mods) {
        const auto name_lower = to_lower(mod.name);
        const auto id_str = std::to_string(mod.id);
        if (name_lower.find(query_lower) != std::string::npos ||
            id_str.find(query) != std::string::npos) {
            filtered.push_back(std::move(mod));
        }
    }

    result->mods = std::move(filtered);
    return result;
}

std::optional<GameBananaMod> gamebanana_get_mod(int mod_id) {
    auto client = make_client(GAMEBANANA_CORE_HOST);

    const auto path = fmt::format(
        "/Core/Item/Data?itemtype=Mod&itemid={}"
        "&fields=_sName,_sProfileUrl,_sDownloadUrl,_nDownloadCount,"
        "_tsDateAdded,_tsDateModified,_sDescription"
        "&format=json",
        mod_id);

    auto res = client.Get(path);
    if (!res) {
        spdlog::error("gamebanana: erreur reseau (Item/Data) pour mod {} : {}",
                      mod_id, httplib::to_string(res.error()));
        return std::nullopt;
    }

    if (res->status != 200) {
        spdlog::error("gamebanana: Item/Data HTTP {} pour mod {}",
                      res->status, mod_id);
        return std::nullopt;
    }

    try {
        auto doc = json::parse(res->body);

        // L'API Core/Item/Data retourne un tableau dans l'ordre des fields demandes
        if (!doc.is_array() || doc.size() < 3) {
            spdlog::warn("gamebanana: reponse inattendue pour mod {}", mod_id);
            return std::nullopt;
        }

        GameBananaMod mod;
        mod.id = mod_id;
        mod.name = doc[0].is_string() ? doc[0].get<std::string>() : "";
        mod.page_url = doc[1].is_string() ? doc[1].get<std::string>() : "";
        mod.download_url = doc[2].is_string() ? doc[2].get<std::string>() : "";
        mod.downloads = (doc.size() > 3 && doc[3].is_number())
                            ? doc[3].get<int>()
                            : 0;
        mod.date_added = (doc.size() > 4 && doc[4].is_string())
                             ? doc[4].get<std::string>()
                             : "";
        mod.date_modified = (doc.size() > 5 && doc[5].is_string())
                                ? doc[5].get<std::string>()
                                : "";
        mod.description = (doc.size() > 6 && doc[6].is_string())
                              ? doc[6].get<std::string>()
                              : "";

        if (mod.download_url.empty()) {
            mod.download_url = mod.page_url;
        }

        if (mod.name.empty()) {
            spdlog::warn("gamebanana: mod {} sans nom", mod_id);
            return std::nullopt;
        }

        return mod;

    } catch (const json::exception& e) {
        spdlog::error("gamebanana: erreur JSON (Item/Data) pour mod {} : {}",
                      mod_id, e.what());
        return std::nullopt;
    }
}

std::optional<std::vector<GameBananaFile>> gamebanana_get_files(int mod_id) {
    auto client = make_client(GAMEBANANA_API_HOST);

    const auto path = fmt::format("/apiv11/Mod/{}/Files", mod_id);

    auto res = client.Get(path);
    if (!res) {
        spdlog::error("gamebanana: erreur reseau (Files) pour mod {} : {}",
                      mod_id, httplib::to_string(res.error()));
        return std::nullopt;
    }

    if (res->status != 200) {
        spdlog::error("gamebanana: Files HTTP {} pour mod {}",
                      res->status, mod_id);
        return std::nullopt;
    }

    try {
        auto doc = json::parse(res->body);

        std::vector<GameBananaFile> files;

        // La reponse peut etre un tableau direct ou un objet avec _aFiles
        const json* arr = nullptr;
        if (doc.is_array()) {
            arr = &doc;
        } else if (doc.is_object() && doc.contains("_aFiles") &&
                   doc["_aFiles"].is_array()) {
            arr = &doc["_aFiles"];
        }

        if (!arr) {
            spdlog::warn("gamebanana: pas de fichiers pour mod {}", mod_id);
            return files;
        }

        for (const auto& item : *arr) {
            if (!item.is_object()) continue;

            GameBananaFile file;
            file.id = json_int(item, "_idRow");
            file.filename = json_str(item, "_sFile");
            file.download_url = json_str(item, "_sDownloadUrl");
            file.file_size = item.contains("_nFilesize") && item["_nFilesize"].is_number()
                                 ? item["_nFilesize"].get<int64_t>()
                                 : 0;
            file.description = json_str(item, "_sDescription");
            file.downloads = json_int(item, "_nDownloadCount");
            file.date_added = json_str(item, "_tsDateAdded");

            files.push_back(std::move(file));
        }

        return files;

    } catch (const json::exception& e) {
        spdlog::error("gamebanana: erreur JSON (Files) pour mod {} : {}",
                      mod_id, e.what());
        return std::nullopt;
    }
}

DownloadResult gamebanana_download_mod(const std::string& download_url,
                                        const fs::path& output_dir,
                                        const std::string& mod_name) {
    DownloadResult result;

    if (download_url.empty()) {
        result.error = "URL de telechargement vide";
        return result;
    }

    // Parser l'URL pour separer host et path
    // Format attendu : https://host/path
    std::string url = download_url;
    std::string host;
    std::string path;

    // Supprimer le schema
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
        result.error = fmt::format("URL invalide: {}", download_url);
        return result;
    }

    spdlog::info("gamebanana: telechargement depuis {} ...", host);

    httplib::Client client(fmt::format("https://{}", host));
    client.set_connection_timeout(30);
    client.set_read_timeout(120);
    client.set_follow_location(true);
    client.set_default_headers({{"User-Agent", USER_AGENT}});

    auto res = client.Get(path);
    if (!res) {
        result.error = fmt::format("erreur reseau: {}",
                                   httplib::to_string(res.error()));
        return result;
    }

    if (res->status != 200) {
        result.error = fmt::format("HTTP {} lors du telechargement", res->status);
        return result;
    }

    result.bytes_downloaded = res->body.size();

    // Determiner le nom de fichier et l'extension
    auto filename = fs::path(path).filename().string();
    if (filename.empty()) {
        filename = fmt::format("mod_{}.zip", sanitize_filename(mod_name));
    }

    const auto extension = to_lower(fs::path(filename).extension().string());
    const auto safe_name = sanitize_filename(mod_name);
    const auto target_dir = unique_directory(output_dir, safe_name);

    try {
        fs::create_directories(output_dir);

        if (extension == ".zip") {
            // Ecrire le zip dans un fichier temporaire, puis extraire
            const auto tmp_path = output_dir / fmt::format(".tmp_{}", filename);
            {
                std::ofstream out(tmp_path, std::ios::binary);
                if (!out) {
                    result.error = fmt::format("impossible d'ecrire: {}",
                                               tmp_path.string());
                    return result;
                }
                out.write(res->body.data(),
                          static_cast<std::streamsize>(res->body.size()));
            }

            // Extraction ZIP via miniz ou commande systeme
            // Pour rester simple et sans dependance supplementaire,
            // on utilise la commande systeme disponible.
#ifdef _WIN32
            fs::create_directories(target_dir);
            const auto cmd = fmt::format(
                "powershell -NoProfile -Command \"Expand-Archive -Path '{}' "
                "-DestinationPath '{}' -Force\"",
                tmp_path.string(), target_dir.string());
            const int ret = std::system(cmd.c_str());
#else
            fs::create_directories(target_dir);
            const auto cmd = fmt::format("unzip -o -q '{}' -d '{}'",
                                         tmp_path.string(),
                                         target_dir.string());
            const int ret = std::system(cmd.c_str());
#endif

            // Nettoyer le fichier temporaire
            std::error_code ec;
            fs::remove(tmp_path, ec);

            if (ret != 0) {
                result.error = "erreur lors de l'extraction ZIP";
                return result;
            }

            result.success = true;
            result.output_path = target_dir;

        } else {
            // Fichier non-ZIP : copier directement
            fs::create_directories(target_dir);
            const auto out_path = target_dir / filename;
            std::ofstream out(out_path, std::ios::binary);
            if (!out) {
                result.error = fmt::format("impossible d'ecrire: {}",
                                           out_path.string());
                return result;
            }
            out.write(res->body.data(),
                      static_cast<std::streamsize>(res->body.size()));

            result.success = true;
            result.output_path = target_dir;
        }

    } catch (const std::exception& e) {
        result.error = fmt::format("erreur fichier: {}", e.what());
    }

    return result;
}

DownloadResult gamebanana_download_mod_by_id(int mod_id,
                                              const fs::path& output_dir) {
    // Recuperer les details du mod
    auto mod_opt = gamebanana_get_mod(mod_id);
    if (!mod_opt) {
        return DownloadResult{
            .success = false,
            .error = fmt::format("impossible de recuperer les details du mod {}",
                                 mod_id)
        };
    }

    // Essayer d'abord la liste des fichiers
    auto files_opt = gamebanana_get_files(mod_id);
    std::string download_url;

    if (files_opt && !files_opt->empty()) {
        // Prendre le premier fichier avec une URL de telechargement
        for (const auto& f : *files_opt) {
            if (!f.download_url.empty()) {
                download_url = f.download_url;
                spdlog::info("gamebanana: fichier selectionne: {} ({} bytes)",
                             f.filename, f.file_size);
                break;
            }
        }
    }

    // Fallback sur l'URL du mod
    if (download_url.empty()) {
        download_url = mod_opt->download_url;
    }

    if (download_url.empty()) {
        return DownloadResult{
            .success = false,
            .error = fmt::format("aucune URL de telechargement pour le mod {}",
                                 mod_id)
        };
    }

    return gamebanana_download_mod(download_url, output_dir, mod_opt->name);
}

// ── Versions asynchrones ────────────────────────────────────────────

std::future<std::optional<GameBananaSearchResult>>
gamebanana_list_mods_async(int page, int page_size) {
    return std::async(std::launch::async, [page, page_size]() {
        return gamebanana_list_mods(page, page_size);
    });
}

std::future<std::optional<GameBananaSearchResult>>
gamebanana_search_mods_async(std::string query, int page, int page_size) {
    return std::async(std::launch::async,
                      [q = std::move(query), page, page_size]() {
                          return gamebanana_search_mods(q, page, page_size);
                      });
}

std::future<std::optional<GameBananaMod>>
gamebanana_get_mod_async(int mod_id) {
    return std::async(std::launch::async, [mod_id]() {
        return gamebanana_get_mod(mod_id);
    });
}

} // namespace iecode::modding
