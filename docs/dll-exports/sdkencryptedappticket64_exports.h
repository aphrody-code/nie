#pragma once

/// @file sdkencryptedappticket64_exports.h
/// Exports de sdkencryptedappticket64.dll (12 fonctions)
/// Genere automatiquement par analyze_game_dlls.py
///
/// Utilisation : chargement dynamique via LoadLibrary + GetProcAddress

#include <cstdint>

namespace iecode::imports::sdkencryptedappticket {

/// Nom de la DLL a charger.
inline constexpr const char* DLL_NAME = "sdkencryptedappticket64.dll";

/// Nombre total d'exports.
inline constexpr int EXPORT_COUNT = 12;

// ── EncryptedAppTicket (12 fonctions) ────────────────────────────────

namespace encryptedappticket {
    inline constexpr const char* SteamEncryptedAppTicket_BDecryptTicket = "SteamEncryptedAppTicket_BDecryptTicket";
    inline constexpr const char* SteamEncryptedAppTicket_BGetAppDefinedValue = "SteamEncryptedAppTicket_BGetAppDefinedValue";
    inline constexpr const char* SteamEncryptedAppTicket_BIsLicenseBorrowed = "SteamEncryptedAppTicket_BIsLicenseBorrowed";
    inline constexpr const char* SteamEncryptedAppTicket_BIsLicenseTemporary = "SteamEncryptedAppTicket_BIsLicenseTemporary";
    inline constexpr const char* SteamEncryptedAppTicket_BIsTicketForApp = "SteamEncryptedAppTicket_BIsTicketForApp";
    inline constexpr const char* SteamEncryptedAppTicket_BIsTicketSigned = "SteamEncryptedAppTicket_BIsTicketSigned";
    inline constexpr const char* SteamEncryptedAppTicket_BUserIsVacBanned = "SteamEncryptedAppTicket_BUserIsVacBanned";
    inline constexpr const char* SteamEncryptedAppTicket_BUserOwnsAppInTicket = "SteamEncryptedAppTicket_BUserOwnsAppInTicket";
    inline constexpr const char* SteamEncryptedAppTicket_GetTicketAppID = "SteamEncryptedAppTicket_GetTicketAppID";
    inline constexpr const char* SteamEncryptedAppTicket_GetTicketIssueTime = "SteamEncryptedAppTicket_GetTicketIssueTime";
    inline constexpr const char* SteamEncryptedAppTicket_GetTicketSteamID = "SteamEncryptedAppTicket_GetTicketSteamID";
    inline constexpr const char* SteamEncryptedAppTicket_GetUserVariableData = "SteamEncryptedAppTicket_GetUserVariableData";
} // namespace encryptedappticket

} // namespace iecode::imports::sdkencryptedappticket
