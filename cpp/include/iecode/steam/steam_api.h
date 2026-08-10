#pragma once

/// @file steam_api.h
/// Wrapper Steam API via chargement dynamique de steam_api64.dll.
///
/// Pas besoin du Steamworks SDK — on declare les fonctions C flat API
/// et on les charge via LoadLibrary/GetProcAddress (Windows) ou dlopen (Linux).
///
/// Couvre :
///   - Initialisation / Shutdown
///   - ISteamUser : SteamID, login status, Steam level
///   - ISteamApps : subscription, DLC, langue, build ID, install dir, Family Sharing
///   - ISteamRemoteStorage : Cloud read/write/delete, quota, enumeration

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace iecode::steam {

// ── Types Steam (reproduits du SDK sans en-tetes) ────────────────────

/// Steam 64-bit ID — encode account ID, instance, universe, type.
struct SteamID {
    uint64_t raw = 0;

    [[nodiscard]] uint32_t account_id()  const noexcept { return static_cast<uint32_t>(raw & 0xFFFFFFFF); }
    [[nodiscard]] uint32_t instance()    const noexcept { return static_cast<uint32_t>((raw >> 32) & 0xFFFFF); }
    [[nodiscard]] uint8_t  type()        const noexcept { return static_cast<uint8_t>((raw >> 52) & 0xF); }
    [[nodiscard]] uint8_t  universe()    const noexcept { return static_cast<uint8_t>((raw >> 56) & 0xFF); }
    [[nodiscard]] bool     is_valid()    const noexcept { return raw != 0; }
};

/// Informations sur l'utilisateur Steam courant.
struct UserInfo {
    SteamID steam_id;
    bool    logged_on    = false;
    int     steam_level  = 0;
};

/// Informations sur l'application.
struct AppInfo {
    bool        subscribed             = false;   ///< L'utilisateur possede l'app
    bool        family_sharing         = false;   ///< Acces via Family Sharing
    std::string language;                         ///< Langue du jeu (ex: "french")
    int         build_id               = 0;       ///< Build ID Steam
    std::string install_dir;                      ///< Repertoire d'installation
};

/// Informations DLC.
struct DlcInfo {
    uint32_t app_id    = 0;
    bool     installed = false;
};

/// Quota Steam Cloud (espace total et disponible en octets).
struct CloudQuota {
    uint64_t total     = 0;
    uint64_t available = 0;
};

/// Informations sur un fichier Steam Cloud.
struct CloudFileInfo {
    std::string name;
    int32_t     size = 0;
};

// ── SteamContext — RAII wrapper ──────────────────────────────────────

/// Contexte Steam — charge steam_api64.dll dynamiquement et expose les API.
///
/// Usage :
/// @code
///   auto ctx = SteamContext::init();
///   if (!ctx) { /* Steam pas lance */ }
///   auto user = ctx->get_user_info();
///   auto app  = ctx->get_app_info();
///   spdlog::info("SteamID: {}", user.steam_id.raw);
/// @endcode
class SteamContext {
public:
    /// Initialise l'API Steam. Retourne nullopt si Steam n'est pas lance
    /// ou si la DLL n'est pas trouvee.
    [[nodiscard]] static std::optional<SteamContext> init();

    /// Initialise avec verification d'AppID (RestartAppIfNecessary).
    /// Retourne nullopt si l'app doit etre relancee via Steam.
    [[nodiscard]] static std::optional<SteamContext> init_with_app_id(uint32_t app_id);

    ~SteamContext();

    // Move-only
    SteamContext(SteamContext&& other) noexcept;
    SteamContext& operator=(SteamContext&& other) noexcept;
    SteamContext(const SteamContext&) = delete;
    SteamContext& operator=(const SteamContext&) = delete;

    // ── User Info ────────────────────────────────────────────────────

    /// Verifie si Steam est en cours d'execution.
    [[nodiscard]] bool is_steam_running() const;

    /// Retourne les informations utilisateur (SteamID, login, level).
    [[nodiscard]] UserInfo get_user_info() const;

    /// Retourne le SteamID 64 bits.
    [[nodiscard]] SteamID get_steam_id() const;

    /// Verifie si l'utilisateur est connecte.
    [[nodiscard]] bool is_logged_on() const;

    /// Retourne le niveau Steam du joueur.
    [[nodiscard]] int get_player_steam_level() const;

    // ── App Info ─────────────────────────────────────────────────────

    /// Retourne les informations de l'application.
    [[nodiscard]] AppInfo get_app_info(uint32_t app_id = 2799860) const;

    /// Verifie si l'utilisateur possede l'app (licence active).
    [[nodiscard]] bool is_subscribed() const;

    /// Verifie si l'utilisateur possede une app specifique.
    [[nodiscard]] bool is_subscribed_app(uint32_t app_id) const;

    /// Verifie si l'acces est via Family Sharing.
    [[nodiscard]] bool is_family_sharing() const;

    /// Verifie si un DLC est installe.
    [[nodiscard]] bool is_dlc_installed(uint32_t dlc_app_id) const;

    /// Retourne la langue du jeu (ex: "french", "english").
    [[nodiscard]] std::string get_current_game_language() const;

    /// Retourne le build ID Steam.
    [[nodiscard]] int get_app_build_id() const;

    /// Retourne le repertoire d'installation de l'app.
    [[nodiscard]] std::string get_app_install_dir(uint32_t app_id = 2799860) const;

    // ── Cloud (ISteamRemoteStorage) ────────────────────────────────

    /// Verifie si le Cloud Steam est active pour le compte utilisateur.
    [[nodiscard]] bool is_cloud_enabled_for_account() const;

    /// Verifie si le Cloud Steam est active pour cette application.
    [[nodiscard]] bool is_cloud_enabled_for_app() const;

    /// Retourne le quota Cloud (total et disponible en octets).
    [[nodiscard]] CloudQuota get_cloud_quota() const;

    /// Retourne le nombre de fichiers dans le Cloud.
    [[nodiscard]] int get_cloud_file_count() const;

    /// Retourne les infos (nom + taille) du fichier Cloud a l'index donne.
    [[nodiscard]] CloudFileInfo get_cloud_file_info(int index) const;

    /// Verifie si un fichier existe dans le Cloud.
    [[nodiscard]] bool cloud_file_exists(std::string_view name) const;

    /// Retourne la taille d'un fichier Cloud en octets.
    [[nodiscard]] int cloud_file_size(std::string_view name) const;

    /// Retourne le timestamp Unix du fichier Cloud.
    [[nodiscard]] int64_t cloud_file_timestamp(std::string_view name) const;

    /// Lit le contenu d'un fichier Cloud. Retourne nullopt si echec.
    [[nodiscard]] std::optional<std::vector<uint8_t>> cloud_read(std::string_view name) const;

    /// Ecrit des donnees dans un fichier Cloud. Retourne true si succes.
    [[nodiscard]] bool cloud_write(std::string_view name, std::span<const uint8_t> data) const;

    /// Supprime un fichier du Cloud. Retourne true si succes.
    [[nodiscard]] bool cloud_delete(std::string_view name) const;

    /// Verifie si un fichier Cloud est persiste (synchronise avec le serveur).
    [[nodiscard]] bool cloud_file_persisted(std::string_view name) const;

    // ── Callbacks ────────────────────────────────────────────────────

    /// Traite les callbacks Steam en attente (appeler periodiquement).
    void run_callbacks() const;

    // ── Accesseurs ───────────────────────────────────────────────────

    /// Contexte initialise avec succes.
    [[nodiscard]] bool is_initialized() const noexcept { return initialized_; }

private:
    SteamContext() = default;

    bool load_library();
    bool resolve_symbols();
    void shutdown();

    // Handle DLL
    void* lib_handle_ = nullptr;
    bool  initialized_ = false;

    // ── Pointeurs de fonctions (flat C API Steam) ────────────────────
    // Resolus par GetProcAddress / dlsym

    // Lifecycle
    using FnSteamAPI_Init             = bool(*)();
    using FnSteamAPI_Shutdown         = void(*)();
    using FnSteamAPI_IsSteamRunning   = bool(*)();
    using FnSteamAPI_RestartAppIfNecessary = bool(*)(uint32_t);
    using FnSteamAPI_RunCallbacks     = void(*)();

    // Interface accessors (retournent void* = ISteam* opaque)
    using FnSteamUser                 = void*(*)();
    using FnSteamApps                 = void*(*)();

    // ISteamUser
    using FnGetSteamID                = uint64_t(*)(void*);
    using FnBLoggedOn                 = bool(*)(void*);
    using FnGetPlayerSteamLevel       = int(*)(void*);

    // ISteamApps
    using FnBIsSubscribed             = bool(*)(void*);
    using FnBIsSubscribedApp          = bool(*)(void*, uint32_t);
    using FnBIsSubscribedFromFamilySharing = bool(*)(void*);
    using FnBIsDlcInstalled           = bool(*)(void*, uint32_t);
    using FnGetCurrentGameLanguage    = const char*(*)(void*);
    using FnGetAppBuildId             = int(*)(void*);
    using FnGetAppInstallDir          = uint32_t(*)(void*, uint32_t, char*, uint32_t);

    // ISteamRemoteStorage
    using FnSteamRemoteStorage        = void*(*)();
    using FnIsCloudEnabledForAccount  = bool(*)(void*);
    using FnIsCloudEnabledForApp      = bool(*)(void*);
    using FnGetQuota                  = bool(*)(void*, uint64_t*, uint64_t*);
    using FnGetFileCount              = int(*)(void*);
    using FnGetFileNameAndSize        = const char*(*)(void*, int, int32_t*);
    using FnFileExists                = bool(*)(void*, const char*);
    using FnGetFileSize               = int32_t(*)(void*, const char*);
    using FnGetFileTimestamp           = int64_t(*)(void*, const char*);
    using FnFileRead                  = int32_t(*)(void*, const char*, void*, int32_t);
    using FnFileWrite                 = bool(*)(void*, const char*, const void*, int32_t);
    using FnFileDelete                = bool(*)(void*, const char*);
    using FnFilePersisted             = bool(*)(void*, const char*);

    // Pointeurs resolus
    FnSteamAPI_Init             fn_init_              = nullptr;
    FnSteamAPI_Shutdown         fn_shutdown_          = nullptr;
    FnSteamAPI_IsSteamRunning   fn_is_running_        = nullptr;
    FnSteamAPI_RestartAppIfNecessary fn_restart_       = nullptr;
    FnSteamAPI_RunCallbacks     fn_run_callbacks_     = nullptr;
    FnSteamUser                 fn_steam_user_        = nullptr;
    FnSteamApps                 fn_steam_apps_        = nullptr;
    FnGetSteamID                fn_get_steam_id_      = nullptr;
    FnBLoggedOn                 fn_logged_on_         = nullptr;
    FnGetPlayerSteamLevel       fn_steam_level_       = nullptr;
    FnBIsSubscribed             fn_is_subscribed_     = nullptr;
    FnBIsSubscribedApp          fn_is_subscribed_app_ = nullptr;
    FnBIsSubscribedFromFamilySharing fn_family_sharing_ = nullptr;
    FnBIsDlcInstalled           fn_dlc_installed_     = nullptr;
    FnGetCurrentGameLanguage    fn_game_language_     = nullptr;
    FnGetAppBuildId             fn_build_id_          = nullptr;
    FnGetAppInstallDir          fn_install_dir_       = nullptr;
    FnSteamRemoteStorage        fn_steam_remote_storage_ = nullptr;
    FnIsCloudEnabledForAccount  fn_cloud_enabled_account_ = nullptr;
    FnIsCloudEnabledForApp      fn_cloud_enabled_app_ = nullptr;
    FnGetQuota                  fn_cloud_quota_       = nullptr;
    FnGetFileCount              fn_cloud_file_count_  = nullptr;
    FnGetFileNameAndSize        fn_cloud_file_name_size_ = nullptr;
    FnFileExists                fn_cloud_file_exists_ = nullptr;
    FnGetFileSize               fn_cloud_file_size_   = nullptr;
    FnGetFileTimestamp           fn_cloud_file_timestamp_ = nullptr;
    FnFileRead                  fn_cloud_file_read_   = nullptr;
    FnFileWrite                 fn_cloud_file_write_  = nullptr;
    FnFileDelete                fn_cloud_file_delete_ = nullptr;
    FnFilePersisted             fn_cloud_file_persisted_ = nullptr;
};

} // namespace iecode::steam
