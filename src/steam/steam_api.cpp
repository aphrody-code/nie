/// @file steam_api.cpp
/// Implementation du wrapper Steam API via chargement dynamique.
///
/// On charge steam_api64.dll (Windows) ou libsteam_api.so (Linux) au runtime
/// via LoadLibrary/dlopen. Les noms de symboles sont ceux de la flat C API
/// du Steamworks SDK (prefixe SteamAPI_ / SteamInternal_).
///
/// Noms de symboles decouverts via dumpbin /exports sur steam_api64.dll
/// livree avec nie.exe.

#include "iecode/steam/steam_api.h"
#include "iecode/steam/dll_loader.h"

#include <spdlog/spdlog.h>

#include <cstring>

namespace iecode::steam {

using detail::load_dll;
using detail::free_dll;
using detail::load_fn;

// ── SteamContext lifecycle ───────────────────────────────────────────

SteamContext::~SteamContext() {
    shutdown();
}

SteamContext::SteamContext(SteamContext&& other) noexcept
    : lib_handle_(other.lib_handle_)
    , initialized_(other.initialized_)
    , fn_init_(other.fn_init_)
    , fn_shutdown_(other.fn_shutdown_)
    , fn_is_running_(other.fn_is_running_)
    , fn_restart_(other.fn_restart_)
    , fn_run_callbacks_(other.fn_run_callbacks_)
    , fn_steam_user_(other.fn_steam_user_)
    , fn_steam_apps_(other.fn_steam_apps_)
    , fn_get_steam_id_(other.fn_get_steam_id_)
    , fn_logged_on_(other.fn_logged_on_)
    , fn_steam_level_(other.fn_steam_level_)
    , fn_is_subscribed_(other.fn_is_subscribed_)
    , fn_is_subscribed_app_(other.fn_is_subscribed_app_)
    , fn_family_sharing_(other.fn_family_sharing_)
    , fn_dlc_installed_(other.fn_dlc_installed_)
    , fn_game_language_(other.fn_game_language_)
    , fn_build_id_(other.fn_build_id_)
    , fn_install_dir_(other.fn_install_dir_)
    , fn_steam_remote_storage_(other.fn_steam_remote_storage_)
    , fn_cloud_enabled_account_(other.fn_cloud_enabled_account_)
    , fn_cloud_enabled_app_(other.fn_cloud_enabled_app_)
    , fn_cloud_quota_(other.fn_cloud_quota_)
    , fn_cloud_file_count_(other.fn_cloud_file_count_)
    , fn_cloud_file_name_size_(other.fn_cloud_file_name_size_)
    , fn_cloud_file_exists_(other.fn_cloud_file_exists_)
    , fn_cloud_file_size_(other.fn_cloud_file_size_)
    , fn_cloud_file_timestamp_(other.fn_cloud_file_timestamp_)
    , fn_cloud_file_read_(other.fn_cloud_file_read_)
    , fn_cloud_file_write_(other.fn_cloud_file_write_)
    , fn_cloud_file_delete_(other.fn_cloud_file_delete_)
    , fn_cloud_file_persisted_(other.fn_cloud_file_persisted_) {
    other.lib_handle_ = nullptr;
    other.initialized_ = false;
}

SteamContext& SteamContext::operator=(SteamContext&& other) noexcept {
    if (this != &other) {
        shutdown();
        lib_handle_ = other.lib_handle_;
        initialized_ = other.initialized_;
        fn_init_ = other.fn_init_;
        fn_shutdown_ = other.fn_shutdown_;
        fn_is_running_ = other.fn_is_running_;
        fn_restart_ = other.fn_restart_;
        fn_run_callbacks_ = other.fn_run_callbacks_;
        fn_steam_user_ = other.fn_steam_user_;
        fn_steam_apps_ = other.fn_steam_apps_;
        fn_get_steam_id_ = other.fn_get_steam_id_;
        fn_logged_on_ = other.fn_logged_on_;
        fn_steam_level_ = other.fn_steam_level_;
        fn_is_subscribed_ = other.fn_is_subscribed_;
        fn_is_subscribed_app_ = other.fn_is_subscribed_app_;
        fn_family_sharing_ = other.fn_family_sharing_;
        fn_dlc_installed_ = other.fn_dlc_installed_;
        fn_game_language_ = other.fn_game_language_;
        fn_build_id_ = other.fn_build_id_;
        fn_install_dir_ = other.fn_install_dir_;
        fn_steam_remote_storage_ = other.fn_steam_remote_storage_;
        fn_cloud_enabled_account_ = other.fn_cloud_enabled_account_;
        fn_cloud_enabled_app_ = other.fn_cloud_enabled_app_;
        fn_cloud_quota_ = other.fn_cloud_quota_;
        fn_cloud_file_count_ = other.fn_cloud_file_count_;
        fn_cloud_file_name_size_ = other.fn_cloud_file_name_size_;
        fn_cloud_file_exists_ = other.fn_cloud_file_exists_;
        fn_cloud_file_size_ = other.fn_cloud_file_size_;
        fn_cloud_file_timestamp_ = other.fn_cloud_file_timestamp_;
        fn_cloud_file_read_ = other.fn_cloud_file_read_;
        fn_cloud_file_write_ = other.fn_cloud_file_write_;
        fn_cloud_file_delete_ = other.fn_cloud_file_delete_;
        fn_cloud_file_persisted_ = other.fn_cloud_file_persisted_;
        other.lib_handle_ = nullptr;
        other.initialized_ = false;
    }
    return *this;
}

void SteamContext::shutdown() {
    if (initialized_ && fn_shutdown_) {
        fn_shutdown_();
        spdlog::info("steam: API shutdown");
    }
    if (lib_handle_) {
        free_dll(lib_handle_);
        lib_handle_ = nullptr;
    }
    initialized_ = false;
}

// ── Chargement ───────────────────────────────────────────────────────

bool SteamContext::load_library() {
    // Tenter de charger la DLL Steam depuis :
    // 1. Le repertoire courant (jeu lance depuis son dossier)
    // 2. Le PATH systeme
#ifdef _WIN32
    lib_handle_ = load_dll("steam_api64.dll");
#else
    lib_handle_ = load_dll("libsteam_api.so");
#endif

    if (!lib_handle_) {
        spdlog::warn("steam: impossible de charger la DLL Steam API");
        return false;
    }

    spdlog::debug("steam: DLL chargee avec succes");
    return true;
}

bool SteamContext::resolve_symbols() {
    if (!lib_handle_) return false;

    bool ok = true;

    // Lifecycle — obligatoires
    ok &= load_fn(lib_handle_, "SteamAPI_Init",              fn_init_);
    ok &= load_fn(lib_handle_, "SteamAPI_Shutdown",           fn_shutdown_);

    if (!ok) {
        spdlog::error("steam: symboles Init/Shutdown manquants — DLL incompatible");
        return false;
    }

    // Optionnels (ne bloquent pas l'init si absents)
    load_fn(lib_handle_, "SteamAPI_IsSteamRunning",           fn_is_running_);
    load_fn(lib_handle_, "SteamAPI_RestartAppIfNecessary",    fn_restart_);
    load_fn(lib_handle_, "SteamAPI_RunCallbacks",             fn_run_callbacks_);

    // Interface accessors — flat C API
    // Noms decouverts via : dumpbin /exports steam_api64.dll | findstr Steam
    load_fn(lib_handle_, "SteamAPI_SteamUser_v023",           fn_steam_user_);
    if (!fn_steam_user_)
        load_fn(lib_handle_, "SteamAPI_SteamUser_v021",       fn_steam_user_);
    if (!fn_steam_user_)
        load_fn(lib_handle_, "SteamUser",                     fn_steam_user_);

    load_fn(lib_handle_, "SteamAPI_SteamApps_v008",           fn_steam_apps_);
    if (!fn_steam_apps_)
        load_fn(lib_handle_, "SteamApps",                     fn_steam_apps_);

    // ISteamUser methods — flat C API : SteamAPI_ISteamUser_*
    load_fn(lib_handle_, "SteamAPI_ISteamUser_GetSteamID",            fn_get_steam_id_);
    load_fn(lib_handle_, "SteamAPI_ISteamUser_BLoggedOn",             fn_logged_on_);
    load_fn(lib_handle_, "SteamAPI_ISteamUser_GetPlayerSteamLevel",   fn_steam_level_);

    // ISteamApps methods — flat C API : SteamAPI_ISteamApps_*
    load_fn(lib_handle_, "SteamAPI_ISteamApps_BIsSubscribed",                      fn_is_subscribed_);
    load_fn(lib_handle_, "SteamAPI_ISteamApps_BIsSubscribedApp",                   fn_is_subscribed_app_);
    load_fn(lib_handle_, "SteamAPI_ISteamApps_BIsSubscribedFromFamilySharing",     fn_family_sharing_);
    load_fn(lib_handle_, "SteamAPI_ISteamApps_BIsDlcInstalled",                    fn_dlc_installed_);
    load_fn(lib_handle_, "SteamAPI_ISteamApps_GetCurrentGameLanguage",             fn_game_language_);
    load_fn(lib_handle_, "SteamAPI_ISteamApps_GetAppBuildId",                      fn_build_id_);
    load_fn(lib_handle_, "SteamAPI_ISteamApps_GetAppInstallDir",                   fn_install_dir_);

    // ISteamRemoteStorage accessor — flat C API
    load_fn(lib_handle_, "SteamAPI_SteamRemoteStorage_v016",                       fn_steam_remote_storage_);

    // ISteamRemoteStorage methods — flat C API : SteamAPI_ISteamRemoteStorage_*
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_IsCloudEnabledForAccount",  fn_cloud_enabled_account_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_IsCloudEnabledForApp",      fn_cloud_enabled_app_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_GetQuota",                  fn_cloud_quota_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_GetFileCount",              fn_cloud_file_count_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_GetFileNameAndSize",        fn_cloud_file_name_size_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_FileExists",                fn_cloud_file_exists_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_GetFileSize",               fn_cloud_file_size_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_GetFileTimestamp",          fn_cloud_file_timestamp_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_FileRead",                  fn_cloud_file_read_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_FileWrite",                 fn_cloud_file_write_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_FileDelete",                fn_cloud_file_delete_);
    load_fn(lib_handle_, "SteamAPI_ISteamRemoteStorage_FilePersisted",             fn_cloud_file_persisted_);

    return true;
}

// ── Init ─────────────────────────────────────────────────────────────

std::optional<SteamContext> SteamContext::init() {
    SteamContext ctx;

    if (!ctx.load_library()) return std::nullopt;
    if (!ctx.resolve_symbols()) {
        free_dll(ctx.lib_handle_);
        ctx.lib_handle_ = nullptr;
        return std::nullopt;
    }

    if (!ctx.fn_init_()) {
        spdlog::warn("steam: SteamAPI_Init echec — Steam n'est pas lance ?");
        free_dll(ctx.lib_handle_);
        ctx.lib_handle_ = nullptr;
        return std::nullopt;
    }

    ctx.initialized_ = true;
    spdlog::info("steam: API initialisee avec succes");
    return ctx;
}

std::optional<SteamContext> SteamContext::init_with_app_id(uint32_t app_id) {
    SteamContext ctx;

    if (!ctx.load_library()) return std::nullopt;
    if (!ctx.resolve_symbols()) {
        free_dll(ctx.lib_handle_);
        ctx.lib_handle_ = nullptr;
        return std::nullopt;
    }

    // Verifier si l'app doit etre relancee via Steam
    if (ctx.fn_restart_ && ctx.fn_restart_(app_id)) {
        spdlog::info("steam: l'app doit etre relancee via Steam (AppID={})", app_id);
        free_dll(ctx.lib_handle_);
        ctx.lib_handle_ = nullptr;
        return std::nullopt;
    }

    if (!ctx.fn_init_()) {
        spdlog::warn("steam: SteamAPI_Init echec — Steam n'est pas lance ?");
        free_dll(ctx.lib_handle_);
        ctx.lib_handle_ = nullptr;
        return std::nullopt;
    }

    ctx.initialized_ = true;
    spdlog::info("steam: API initialisee (AppID={})", app_id);
    return ctx;
}

// ── ISteamUser ───────────────────────────────────────────────────────

bool SteamContext::is_steam_running() const {
    if (fn_is_running_) return fn_is_running_();
    return initialized_;  // Fallback : si init reussie, Steam tourne
}

SteamID SteamContext::get_steam_id() const {
    if (!fn_steam_user_ || !fn_get_steam_id_) return {};
    void* user = fn_steam_user_();
    if (!user) return {};
    return SteamID{fn_get_steam_id_(user)};
}

bool SteamContext::is_logged_on() const {
    if (!fn_steam_user_ || !fn_logged_on_) return false;
    void* user = fn_steam_user_();
    if (!user) return false;
    return fn_logged_on_(user);
}

int SteamContext::get_player_steam_level() const {
    if (!fn_steam_user_ || !fn_steam_level_) return 0;
    void* user = fn_steam_user_();
    if (!user) return 0;
    return fn_steam_level_(user);
}

UserInfo SteamContext::get_user_info() const {
    return UserInfo{
        .steam_id    = get_steam_id(),
        .logged_on   = is_logged_on(),
        .steam_level = get_player_steam_level(),
    };
}

// ── ISteamApps ───────────────────────────────────────────────────────

bool SteamContext::is_subscribed() const {
    if (!fn_steam_apps_ || !fn_is_subscribed_) return false;
    void* apps = fn_steam_apps_();
    if (!apps) return false;
    return fn_is_subscribed_(apps);
}

bool SteamContext::is_subscribed_app(uint32_t app_id) const {
    if (!fn_steam_apps_ || !fn_is_subscribed_app_) return false;
    void* apps = fn_steam_apps_();
    if (!apps) return false;
    return fn_is_subscribed_app_(apps, app_id);
}

bool SteamContext::is_family_sharing() const {
    if (!fn_steam_apps_ || !fn_family_sharing_) return false;
    void* apps = fn_steam_apps_();
    if (!apps) return false;
    return fn_family_sharing_(apps);
}

bool SteamContext::is_dlc_installed(uint32_t dlc_app_id) const {
    if (!fn_steam_apps_ || !fn_dlc_installed_) return false;
    void* apps = fn_steam_apps_();
    if (!apps) return false;
    return fn_dlc_installed_(apps, dlc_app_id);
}

std::string SteamContext::get_current_game_language() const {
    if (!fn_steam_apps_ || !fn_game_language_) return {};
    void* apps = fn_steam_apps_();
    if (!apps) return {};
    const char* lang = fn_game_language_(apps);
    return lang ? std::string(lang) : std::string{};
}

int SteamContext::get_app_build_id() const {
    if (!fn_steam_apps_ || !fn_build_id_) return 0;
    void* apps = fn_steam_apps_();
    if (!apps) return 0;
    return fn_build_id_(apps);
}

std::string SteamContext::get_app_install_dir(uint32_t app_id) const {
    if (!fn_steam_apps_ || !fn_install_dir_) return {};
    void* apps = fn_steam_apps_();
    if (!apps) return {};

    char buf[4096]{};
    uint32_t len = fn_install_dir_(apps, app_id, buf, sizeof(buf));
    if (len == 0) return {};
    return std::string(buf);
}

AppInfo SteamContext::get_app_info(uint32_t app_id) const {
    return AppInfo{
        .subscribed     = is_subscribed(),
        .family_sharing = is_family_sharing(),
        .language       = get_current_game_language(),
        .build_id       = get_app_build_id(),
        .install_dir    = get_app_install_dir(app_id),
    };
}

// ── ISteamRemoteStorage (Cloud) ──────────────────────────────────────

bool SteamContext::is_cloud_enabled_for_account() const {
    if (!fn_steam_remote_storage_ || !fn_cloud_enabled_account_) return false;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return false;
    return fn_cloud_enabled_account_(rs);
}

bool SteamContext::is_cloud_enabled_for_app() const {
    if (!fn_steam_remote_storage_ || !fn_cloud_enabled_app_) return false;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return false;
    return fn_cloud_enabled_app_(rs);
}

CloudQuota SteamContext::get_cloud_quota() const {
    if (!fn_steam_remote_storage_ || !fn_cloud_quota_) return {};
    void* rs = fn_steam_remote_storage_();
    if (!rs) return {};
    CloudQuota quota;
    if (!fn_cloud_quota_(rs, &quota.total, &quota.available)) return {};
    return quota;
}

int SteamContext::get_cloud_file_count() const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_count_) return 0;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return 0;
    return fn_cloud_file_count_(rs);
}

CloudFileInfo SteamContext::get_cloud_file_info(int index) const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_name_size_) return {};
    void* rs = fn_steam_remote_storage_();
    if (!rs) return {};
    int32_t size = 0;
    const char* name = fn_cloud_file_name_size_(rs, index, &size);
    if (!name) return {};
    return CloudFileInfo{.name = std::string(name), .size = size};
}

bool SteamContext::cloud_file_exists(std::string_view name) const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_exists_) return false;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return false;
    // string_view n'est pas forcement null-terminated — copier
    std::string name_str(name);
    return fn_cloud_file_exists_(rs, name_str.c_str());
}

int SteamContext::cloud_file_size(std::string_view name) const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_size_) return 0;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return 0;
    std::string name_str(name);
    return fn_cloud_file_size_(rs, name_str.c_str());
}

int64_t SteamContext::cloud_file_timestamp(std::string_view name) const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_timestamp_) return 0;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return 0;
    std::string name_str(name);
    return fn_cloud_file_timestamp_(rs, name_str.c_str());
}

std::optional<std::vector<uint8_t>> SteamContext::cloud_read(std::string_view name) const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_read_ || !fn_cloud_file_size_)
        return std::nullopt;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return std::nullopt;

    std::string name_str(name);
    int32_t file_size = fn_cloud_file_size_(rs, name_str.c_str());
    if (file_size <= 0) return std::nullopt;

    std::vector<uint8_t> buf(static_cast<size_t>(file_size));
    int32_t bytes_read = fn_cloud_file_read_(rs, name_str.c_str(), buf.data(), file_size);
    if (bytes_read != file_size) return std::nullopt;

    return buf;
}

bool SteamContext::cloud_write(std::string_view name, std::span<const uint8_t> data) const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_write_) return false;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return false;
    std::string name_str(name);
    return fn_cloud_file_write_(rs, name_str.c_str(), data.data(),
                                static_cast<int32_t>(data.size()));
}

bool SteamContext::cloud_delete(std::string_view name) const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_delete_) return false;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return false;
    std::string name_str(name);
    return fn_cloud_file_delete_(rs, name_str.c_str());
}

bool SteamContext::cloud_file_persisted(std::string_view name) const {
    if (!fn_steam_remote_storage_ || !fn_cloud_file_persisted_) return false;
    void* rs = fn_steam_remote_storage_();
    if (!rs) return false;
    std::string name_str(name);
    return fn_cloud_file_persisted_(rs, name_str.c_str());
}

// ── Callbacks ────────────────────────────────────────────────────────

void SteamContext::run_callbacks() const {
    if (fn_run_callbacks_) fn_run_callbacks_();
}

} // namespace iecode::steam
