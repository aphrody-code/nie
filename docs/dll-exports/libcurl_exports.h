#pragma once

/// @file libcurl_exports.h
/// Exports de libcurl.dll (93 fonctions)
/// Genere automatiquement par analyze_game_dlls.py
///
/// Utilisation : chargement dynamique via LoadLibrary + GetProcAddress

#include <cstdint>

namespace iecode::imports::libcurl {

/// Nom de la DLL a charger.
inline constexpr const char* DLL_NAME = "libcurl.dll";

/// Nombre total d'exports.
inline constexpr int EXPORT_COUNT = 93;

// ── Easy (19 fonctions) ──────────────────────────────────────────────

namespace easy {
    inline constexpr const char* curl_easy_cleanup = "curl_easy_cleanup";
    inline constexpr const char* curl_easy_duphandle = "curl_easy_duphandle";
    inline constexpr const char* curl_easy_escape = "curl_easy_escape";
    inline constexpr const char* curl_easy_getinfo = "curl_easy_getinfo";
    inline constexpr const char* curl_easy_header = "curl_easy_header";
    inline constexpr const char* curl_easy_init = "curl_easy_init";
    inline constexpr const char* curl_easy_nextheader = "curl_easy_nextheader";
    inline constexpr const char* curl_easy_option_by_id = "curl_easy_option_by_id";
    inline constexpr const char* curl_easy_option_by_name = "curl_easy_option_by_name";
    inline constexpr const char* curl_easy_option_next = "curl_easy_option_next";
    inline constexpr const char* curl_easy_pause = "curl_easy_pause";
    inline constexpr const char* curl_easy_perform = "curl_easy_perform";
    inline constexpr const char* curl_easy_recv = "curl_easy_recv";
    inline constexpr const char* curl_easy_reset = "curl_easy_reset";
    inline constexpr const char* curl_easy_send = "curl_easy_send";
    inline constexpr const char* curl_easy_setopt = "curl_easy_setopt";
    inline constexpr const char* curl_easy_strerror = "curl_easy_strerror";
    inline constexpr const char* curl_easy_unescape = "curl_easy_unescape";
    inline constexpr const char* curl_easy_upkeep = "curl_easy_upkeep";
} // namespace easy

// ── Global (29 fonctions) ────────────────────────────────────────────

namespace global {
    inline constexpr const char* curl_escape = "curl_escape";
    inline constexpr const char* curl_formadd = "curl_formadd";
    inline constexpr const char* curl_formfree = "curl_formfree";
    inline constexpr const char* curl_formget = "curl_formget";
    inline constexpr const char* curl_free = "curl_free";
    inline constexpr const char* curl_getdate = "curl_getdate";
    inline constexpr const char* curl_getenv = "curl_getenv";
    inline constexpr const char* curl_global_cleanup = "curl_global_cleanup";
    inline constexpr const char* curl_global_init = "curl_global_init";
    inline constexpr const char* curl_global_init_mem = "curl_global_init_mem";
    inline constexpr const char* curl_global_sslset = "curl_global_sslset";
    inline constexpr const char* curl_global_trace = "curl_global_trace";
    inline constexpr const char* curl_maprintf = "curl_maprintf";
    inline constexpr const char* curl_mfprintf = "curl_mfprintf";
    inline constexpr const char* curl_mprintf = "curl_mprintf";
    inline constexpr const char* curl_msnprintf = "curl_msnprintf";
    inline constexpr const char* curl_msprintf = "curl_msprintf";
    inline constexpr const char* curl_mvaprintf = "curl_mvaprintf";
    inline constexpr const char* curl_mvfprintf = "curl_mvfprintf";
    inline constexpr const char* curl_mvprintf = "curl_mvprintf";
    inline constexpr const char* curl_mvsnprintf = "curl_mvsnprintf";
    inline constexpr const char* curl_mvsprintf = "curl_mvsprintf";
    inline constexpr const char* curl_pushheader_byname = "curl_pushheader_byname";
    inline constexpr const char* curl_pushheader_bynum = "curl_pushheader_bynum";
    inline constexpr const char* curl_strequal = "curl_strequal";
    inline constexpr const char* curl_strnequal = "curl_strnequal";
    inline constexpr const char* curl_unescape = "curl_unescape";
    inline constexpr const char* curl_version = "curl_version";
    inline constexpr const char* curl_version_info = "curl_version_info";
} // namespace global

// ── MIME (12 fonctions) ──────────────────────────────────────────────

namespace mime {
    inline constexpr const char* curl_mime_addpart = "curl_mime_addpart";
    inline constexpr const char* curl_mime_data = "curl_mime_data";
    inline constexpr const char* curl_mime_data_cb = "curl_mime_data_cb";
    inline constexpr const char* curl_mime_encoder = "curl_mime_encoder";
    inline constexpr const char* curl_mime_filedata = "curl_mime_filedata";
    inline constexpr const char* curl_mime_filename = "curl_mime_filename";
    inline constexpr const char* curl_mime_free = "curl_mime_free";
    inline constexpr const char* curl_mime_headers = "curl_mime_headers";
    inline constexpr const char* curl_mime_init = "curl_mime_init";
    inline constexpr const char* curl_mime_name = "curl_mime_name";
    inline constexpr const char* curl_mime_subparts = "curl_mime_subparts";
    inline constexpr const char* curl_mime_type = "curl_mime_type";
} // namespace mime

// ── Multi (18 fonctions) ─────────────────────────────────────────────

namespace multi {
    inline constexpr const char* curl_multi_add_handle = "curl_multi_add_handle";
    inline constexpr const char* curl_multi_assign = "curl_multi_assign";
    inline constexpr const char* curl_multi_cleanup = "curl_multi_cleanup";
    inline constexpr const char* curl_multi_fdset = "curl_multi_fdset";
    inline constexpr const char* curl_multi_get_handles = "curl_multi_get_handles";
    inline constexpr const char* curl_multi_info_read = "curl_multi_info_read";
    inline constexpr const char* curl_multi_init = "curl_multi_init";
    inline constexpr const char* curl_multi_perform = "curl_multi_perform";
    inline constexpr const char* curl_multi_poll = "curl_multi_poll";
    inline constexpr const char* curl_multi_remove_handle = "curl_multi_remove_handle";
    inline constexpr const char* curl_multi_setopt = "curl_multi_setopt";
    inline constexpr const char* curl_multi_socket = "curl_multi_socket";
    inline constexpr const char* curl_multi_socket_action = "curl_multi_socket_action";
    inline constexpr const char* curl_multi_socket_all = "curl_multi_socket_all";
    inline constexpr const char* curl_multi_strerror = "curl_multi_strerror";
    inline constexpr const char* curl_multi_timeout = "curl_multi_timeout";
    inline constexpr const char* curl_multi_wait = "curl_multi_wait";
    inline constexpr const char* curl_multi_wakeup = "curl_multi_wakeup";
} // namespace multi

// ── SList (2 fonctions) ─────────────────────────────────────────────

namespace slist {
    inline constexpr const char* curl_slist_append = "curl_slist_append";
    inline constexpr const char* curl_slist_free_all = "curl_slist_free_all";
} // namespace slist

// ── Share (4 fonctions) ─────────────────────────────────────────────

namespace share {
    inline constexpr const char* curl_share_cleanup = "curl_share_cleanup";
    inline constexpr const char* curl_share_init = "curl_share_init";
    inline constexpr const char* curl_share_setopt = "curl_share_setopt";
    inline constexpr const char* curl_share_strerror = "curl_share_strerror";
} // namespace share

// ── URL (6 fonctions) ───────────────────────────────────────────────

namespace url {
    inline constexpr const char* curl_url = "curl_url";
    inline constexpr const char* curl_url_cleanup = "curl_url_cleanup";
    inline constexpr const char* curl_url_dup = "curl_url_dup";
    inline constexpr const char* curl_url_get = "curl_url_get";
    inline constexpr const char* curl_url_set = "curl_url_set";
    inline constexpr const char* curl_url_strerror = "curl_url_strerror";
} // namespace url

// ── WebSocket (3 fonctions) ─────────────────────────────────────────

namespace websocket {
    inline constexpr const char* curl_ws_meta = "curl_ws_meta";
    inline constexpr const char* curl_ws_recv = "curl_ws_recv";
    inline constexpr const char* curl_ws_send = "curl_ws_send";
} // namespace websocket

} // namespace iecode::imports::libcurl
