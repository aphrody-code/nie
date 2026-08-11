#pragma once

/// @file steam_api64_exports.h
/// Exports de steam_api64.dll (1096 fonctions)
/// Genere automatiquement par analyze_game_dlls.py
///
/// Utilisation : chargement dynamique via LoadLibrary + GetProcAddress

#include <cstdint>

namespace iecode::imports::steam_api {

/// Nom de la DLL a charger.
inline constexpr const char* DLL_NAME = "steam_api64.dll";

/// Nombre total d'exports.
inline constexpr int EXPORT_COUNT = 1096;

// ── Accessors (84 fonctions) ─────────────────────────────────────────

namespace accessors {
    inline constexpr const char* SteamAPI_SteamApps_v008 = "SteamAPI_SteamApps_v008";
    inline constexpr const char* SteamAPI_SteamController_v008 = "SteamAPI_SteamController_v008";
    inline constexpr const char* SteamAPI_SteamDatagramHostedAddress_Clear = "SteamAPI_SteamDatagramHostedAddress_Clear";
    inline constexpr const char* SteamAPI_SteamDatagramHostedAddress_GetPopID = "SteamAPI_SteamDatagramHostedAddress_GetPopID";
    inline constexpr const char* SteamAPI_SteamDatagramHostedAddress_SetDevAddress = "SteamAPI_SteamDatagramHostedAddress_SetDevAddress";
    inline constexpr const char* SteamAPI_SteamFriends_v018 = "SteamAPI_SteamFriends_v018";
    inline constexpr const char* SteamAPI_SteamGameSearch_v001 = "SteamAPI_SteamGameSearch_v001";
    inline constexpr const char* SteamAPI_SteamGameServerHTTP_v003 = "SteamAPI_SteamGameServerHTTP_v003";
    inline constexpr const char* SteamAPI_SteamGameServerInventory_v003 = "SteamAPI_SteamGameServerInventory_v003";
    inline constexpr const char* SteamAPI_SteamGameServerNetworkingMessages_SteamAPI_v002 = "SteamAPI_SteamGameServerNetworkingMessages_SteamAPI_v002";
    inline constexpr const char* SteamAPI_SteamGameServerNetworkingSockets_SteamAPI_v012 = "SteamAPI_SteamGameServerNetworkingSockets_SteamAPI_v012";
    inline constexpr const char* SteamAPI_SteamGameServerNetworking_v006 = "SteamAPI_SteamGameServerNetworking_v006";
    inline constexpr const char* SteamAPI_SteamGameServerStats_v001 = "SteamAPI_SteamGameServerStats_v001";
    inline constexpr const char* SteamAPI_SteamGameServerUGC_v021 = "SteamAPI_SteamGameServerUGC_v021";
    inline constexpr const char* SteamAPI_SteamGameServerUtils_v010 = "SteamAPI_SteamGameServerUtils_v010";
    inline constexpr const char* SteamAPI_SteamGameServer_v015 = "SteamAPI_SteamGameServer_v015";
    inline constexpr const char* SteamAPI_SteamHTMLSurface_v005 = "SteamAPI_SteamHTMLSurface_v005";
    inline constexpr const char* SteamAPI_SteamHTTP_v003 = "SteamAPI_SteamHTTP_v003";
    inline constexpr const char* SteamAPI_SteamIPAddress_t_IsSet = "SteamAPI_SteamIPAddress_t_IsSet";
    inline constexpr const char* SteamAPI_SteamInput_v006 = "SteamAPI_SteamInput_v006";
    inline constexpr const char* SteamAPI_SteamInventory_v003 = "SteamAPI_SteamInventory_v003";
    inline constexpr const char* SteamAPI_SteamMatchmakingServers_v002 = "SteamAPI_SteamMatchmakingServers_v002";
    inline constexpr const char* SteamAPI_SteamMatchmaking_v009 = "SteamAPI_SteamMatchmaking_v009";
    inline constexpr const char* SteamAPI_SteamMusicRemote_v001 = "SteamAPI_SteamMusicRemote_v001";
    inline constexpr const char* SteamAPI_SteamMusic_v001 = "SteamAPI_SteamMusic_v001";
    inline constexpr const char* SteamAPI_SteamNetworkingConfigValue_t_SetFloat = "SteamAPI_SteamNetworkingConfigValue_t_SetFloat";
    inline constexpr const char* SteamAPI_SteamNetworkingConfigValue_t_SetInt32 = "SteamAPI_SteamNetworkingConfigValue_t_SetInt32";
    inline constexpr const char* SteamAPI_SteamNetworkingConfigValue_t_SetInt64 = "SteamAPI_SteamNetworkingConfigValue_t_SetInt64";
    inline constexpr const char* SteamAPI_SteamNetworkingConfigValue_t_SetPtr = "SteamAPI_SteamNetworkingConfigValue_t_SetPtr";
    inline constexpr const char* SteamAPI_SteamNetworkingConfigValue_t_SetString = "SteamAPI_SteamNetworkingConfigValue_t_SetString";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_Clear = "SteamAPI_SteamNetworkingIPAddr_Clear";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_GetFakeIPType = "SteamAPI_SteamNetworkingIPAddr_GetFakeIPType";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_GetIPv4 = "SteamAPI_SteamNetworkingIPAddr_GetIPv4";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_IsEqualTo = "SteamAPI_SteamNetworkingIPAddr_IsEqualTo";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_IsFakeIP = "SteamAPI_SteamNetworkingIPAddr_IsFakeIP";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_IsIPv4 = "SteamAPI_SteamNetworkingIPAddr_IsIPv4";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_IsIPv6AllZeros = "SteamAPI_SteamNetworkingIPAddr_IsIPv6AllZeros";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_IsLocalHost = "SteamAPI_SteamNetworkingIPAddr_IsLocalHost";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_ParseString = "SteamAPI_SteamNetworkingIPAddr_ParseString";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_SetIPv4 = "SteamAPI_SteamNetworkingIPAddr_SetIPv4";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_SetIPv6 = "SteamAPI_SteamNetworkingIPAddr_SetIPv6";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_SetIPv6LocalHost = "SteamAPI_SteamNetworkingIPAddr_SetIPv6LocalHost";
    inline constexpr const char* SteamAPI_SteamNetworkingIPAddr_ToString = "SteamAPI_SteamNetworkingIPAddr_ToString";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_Clear = "SteamAPI_SteamNetworkingIdentity_Clear";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetFakeIPType = "SteamAPI_SteamNetworkingIdentity_GetFakeIPType";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetGenericBytes = "SteamAPI_SteamNetworkingIdentity_GetGenericBytes";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetGenericString = "SteamAPI_SteamNetworkingIdentity_GetGenericString";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetIPAddr = "SteamAPI_SteamNetworkingIdentity_GetIPAddr";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetIPv4 = "SteamAPI_SteamNetworkingIdentity_GetIPv4";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetPSNID = "SteamAPI_SteamNetworkingIdentity_GetPSNID";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetSteamID = "SteamAPI_SteamNetworkingIdentity_GetSteamID";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetSteamID64 = "SteamAPI_SteamNetworkingIdentity_GetSteamID64";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_GetXboxPairwiseID = "SteamAPI_SteamNetworkingIdentity_GetXboxPairwiseID";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_IsEqualTo = "SteamAPI_SteamNetworkingIdentity_IsEqualTo";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_IsFakeIP = "SteamAPI_SteamNetworkingIdentity_IsFakeIP";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_IsInvalid = "SteamAPI_SteamNetworkingIdentity_IsInvalid";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_IsLocalHost = "SteamAPI_SteamNetworkingIdentity_IsLocalHost";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_ParseString = "SteamAPI_SteamNetworkingIdentity_ParseString";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetGenericBytes = "SteamAPI_SteamNetworkingIdentity_SetGenericBytes";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetGenericString = "SteamAPI_SteamNetworkingIdentity_SetGenericString";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetIPAddr = "SteamAPI_SteamNetworkingIdentity_SetIPAddr";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetIPv4Addr = "SteamAPI_SteamNetworkingIdentity_SetIPv4Addr";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetLocalHost = "SteamAPI_SteamNetworkingIdentity_SetLocalHost";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetPSNID = "SteamAPI_SteamNetworkingIdentity_SetPSNID";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetSteamID = "SteamAPI_SteamNetworkingIdentity_SetSteamID";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetSteamID64 = "SteamAPI_SteamNetworkingIdentity_SetSteamID64";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_SetXboxPairwiseID = "SteamAPI_SteamNetworkingIdentity_SetXboxPairwiseID";
    inline constexpr const char* SteamAPI_SteamNetworkingIdentity_ToString = "SteamAPI_SteamNetworkingIdentity_ToString";
    inline constexpr const char* SteamAPI_SteamNetworkingMessage_t_Release = "SteamAPI_SteamNetworkingMessage_t_Release";
    inline constexpr const char* SteamAPI_SteamNetworkingMessages_SteamAPI_v002 = "SteamAPI_SteamNetworkingMessages_SteamAPI_v002";
    inline constexpr const char* SteamAPI_SteamNetworkingSockets_SteamAPI_v012 = "SteamAPI_SteamNetworkingSockets_SteamAPI_v012";
    inline constexpr const char* SteamAPI_SteamNetworkingUtils_SteamAPI_v004 = "SteamAPI_SteamNetworkingUtils_SteamAPI_v004";
    inline constexpr const char* SteamAPI_SteamNetworking_v006 = "SteamAPI_SteamNetworking_v006";
    inline constexpr const char* SteamAPI_SteamParentalSettings_v001 = "SteamAPI_SteamParentalSettings_v001";
    inline constexpr const char* SteamAPI_SteamParties_v002 = "SteamAPI_SteamParties_v002";
    inline constexpr const char* SteamAPI_SteamRemotePlay_v003 = "SteamAPI_SteamRemotePlay_v003";
    inline constexpr const char* SteamAPI_SteamRemoteStorage_v016 = "SteamAPI_SteamRemoteStorage_v016";
    inline constexpr const char* SteamAPI_SteamScreenshots_v003 = "SteamAPI_SteamScreenshots_v003";
    inline constexpr const char* SteamAPI_SteamTimeline_v004 = "SteamAPI_SteamTimeline_v004";
    inline constexpr const char* SteamAPI_SteamUGC_v021 = "SteamAPI_SteamUGC_v021";
    inline constexpr const char* SteamAPI_SteamUserStats_v013 = "SteamAPI_SteamUserStats_v013";
    inline constexpr const char* SteamAPI_SteamUser_v023 = "SteamAPI_SteamUser_v023";
    inline constexpr const char* SteamAPI_SteamUtils_v010 = "SteamAPI_SteamUtils_v010";
    inline constexpr const char* SteamAPI_SteamVideo_v007 = "SteamAPI_SteamVideo_v007";
} // namespace accessors

// ── ISteamApps (33 fonctions) ────────────────────────────────────────

namespace isteamapps {
    inline constexpr const char* SteamAPI_ISteamApps_BGetDLCDataByIndex = "SteamAPI_ISteamApps_BGetDLCDataByIndex";
    inline constexpr const char* SteamAPI_ISteamApps_BIsAppInstalled = "SteamAPI_ISteamApps_BIsAppInstalled";
    inline constexpr const char* SteamAPI_ISteamApps_BIsCybercafe = "SteamAPI_ISteamApps_BIsCybercafe";
    inline constexpr const char* SteamAPI_ISteamApps_BIsDlcInstalled = "SteamAPI_ISteamApps_BIsDlcInstalled";
    inline constexpr const char* SteamAPI_ISteamApps_BIsLowViolence = "SteamAPI_ISteamApps_BIsLowViolence";
    inline constexpr const char* SteamAPI_ISteamApps_BIsSubscribed = "SteamAPI_ISteamApps_BIsSubscribed";
    inline constexpr const char* SteamAPI_ISteamApps_BIsSubscribedApp = "SteamAPI_ISteamApps_BIsSubscribedApp";
    inline constexpr const char* SteamAPI_ISteamApps_BIsSubscribedFromFamilySharing = "SteamAPI_ISteamApps_BIsSubscribedFromFamilySharing";
    inline constexpr const char* SteamAPI_ISteamApps_BIsSubscribedFromFreeWeekend = "SteamAPI_ISteamApps_BIsSubscribedFromFreeWeekend";
    inline constexpr const char* SteamAPI_ISteamApps_BIsTimedTrial = "SteamAPI_ISteamApps_BIsTimedTrial";
    inline constexpr const char* SteamAPI_ISteamApps_BIsVACBanned = "SteamAPI_ISteamApps_BIsVACBanned";
    inline constexpr const char* SteamAPI_ISteamApps_GetAppBuildId = "SteamAPI_ISteamApps_GetAppBuildId";
    inline constexpr const char* SteamAPI_ISteamApps_GetAppInstallDir = "SteamAPI_ISteamApps_GetAppInstallDir";
    inline constexpr const char* SteamAPI_ISteamApps_GetAppOwner = "SteamAPI_ISteamApps_GetAppOwner";
    inline constexpr const char* SteamAPI_ISteamApps_GetAvailableGameLanguages = "SteamAPI_ISteamApps_GetAvailableGameLanguages";
    inline constexpr const char* SteamAPI_ISteamApps_GetBetaInfo = "SteamAPI_ISteamApps_GetBetaInfo";
    inline constexpr const char* SteamAPI_ISteamApps_GetCurrentBetaName = "SteamAPI_ISteamApps_GetCurrentBetaName";
    inline constexpr const char* SteamAPI_ISteamApps_GetCurrentGameLanguage = "SteamAPI_ISteamApps_GetCurrentGameLanguage";
    inline constexpr const char* SteamAPI_ISteamApps_GetDLCCount = "SteamAPI_ISteamApps_GetDLCCount";
    inline constexpr const char* SteamAPI_ISteamApps_GetDlcDownloadProgress = "SteamAPI_ISteamApps_GetDlcDownloadProgress";
    inline constexpr const char* SteamAPI_ISteamApps_GetEarliestPurchaseUnixTime = "SteamAPI_ISteamApps_GetEarliestPurchaseUnixTime";
    inline constexpr const char* SteamAPI_ISteamApps_GetFileDetails = "SteamAPI_ISteamApps_GetFileDetails";
    inline constexpr const char* SteamAPI_ISteamApps_GetInstalledDepots = "SteamAPI_ISteamApps_GetInstalledDepots";
    inline constexpr const char* SteamAPI_ISteamApps_GetLaunchCommandLine = "SteamAPI_ISteamApps_GetLaunchCommandLine";
    inline constexpr const char* SteamAPI_ISteamApps_GetLaunchQueryParam = "SteamAPI_ISteamApps_GetLaunchQueryParam";
    inline constexpr const char* SteamAPI_ISteamApps_GetNumBetas = "SteamAPI_ISteamApps_GetNumBetas";
    inline constexpr const char* SteamAPI_ISteamApps_InstallDLC = "SteamAPI_ISteamApps_InstallDLC";
    inline constexpr const char* SteamAPI_ISteamApps_MarkContentCorrupt = "SteamAPI_ISteamApps_MarkContentCorrupt";
    inline constexpr const char* SteamAPI_ISteamApps_RequestAllProofOfPurchaseKeys = "SteamAPI_ISteamApps_RequestAllProofOfPurchaseKeys";
    inline constexpr const char* SteamAPI_ISteamApps_RequestAppProofOfPurchaseKey = "SteamAPI_ISteamApps_RequestAppProofOfPurchaseKey";
    inline constexpr const char* SteamAPI_ISteamApps_SetActiveBeta = "SteamAPI_ISteamApps_SetActiveBeta";
    inline constexpr const char* SteamAPI_ISteamApps_SetDlcContext = "SteamAPI_ISteamApps_SetDlcContext";
    inline constexpr const char* SteamAPI_ISteamApps_UninstallDLC = "SteamAPI_ISteamApps_UninstallDLC";
} // namespace isteamapps

// ── ISteamFriends (78 fonctions) ─────────────────────────────────────

namespace isteamfriends {
    inline constexpr const char* SteamAPI_ISteamFriends_ActivateGameOverlay = "SteamAPI_ISteamFriends_ActivateGameOverlay";
    inline constexpr const char* SteamAPI_ISteamFriends_ActivateGameOverlayInviteDialog = "SteamAPI_ISteamFriends_ActivateGameOverlayInviteDialog";
    inline constexpr const char* SteamAPI_ISteamFriends_ActivateGameOverlayInviteDialogConnectString = "SteamAPI_ISteamFriends_ActivateGameOverlayInviteDialogConnectString";
    inline constexpr const char* SteamAPI_ISteamFriends_ActivateGameOverlayRemotePlayTogetherInviteDialog = "SteamAPI_ISteamFriends_ActivateGameOverlayRemotePlayTogetherInviteDialog";
    inline constexpr const char* SteamAPI_ISteamFriends_ActivateGameOverlayToStore = "SteamAPI_ISteamFriends_ActivateGameOverlayToStore";
    inline constexpr const char* SteamAPI_ISteamFriends_ActivateGameOverlayToUser = "SteamAPI_ISteamFriends_ActivateGameOverlayToUser";
    inline constexpr const char* SteamAPI_ISteamFriends_ActivateGameOverlayToWebPage = "SteamAPI_ISteamFriends_ActivateGameOverlayToWebPage";
    inline constexpr const char* SteamAPI_ISteamFriends_BHasEquippedProfileItem = "SteamAPI_ISteamFriends_BHasEquippedProfileItem";
    inline constexpr const char* SteamAPI_ISteamFriends_ClearRichPresence = "SteamAPI_ISteamFriends_ClearRichPresence";
    inline constexpr const char* SteamAPI_ISteamFriends_CloseClanChatWindowInSteam = "SteamAPI_ISteamFriends_CloseClanChatWindowInSteam";
    inline constexpr const char* SteamAPI_ISteamFriends_DownloadClanActivityCounts = "SteamAPI_ISteamFriends_DownloadClanActivityCounts";
    inline constexpr const char* SteamAPI_ISteamFriends_EnumerateFollowingList = "SteamAPI_ISteamFriends_EnumerateFollowingList";
    inline constexpr const char* SteamAPI_ISteamFriends_GetChatMemberByIndex = "SteamAPI_ISteamFriends_GetChatMemberByIndex";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanActivityCounts = "SteamAPI_ISteamFriends_GetClanActivityCounts";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanByIndex = "SteamAPI_ISteamFriends_GetClanByIndex";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanChatMemberCount = "SteamAPI_ISteamFriends_GetClanChatMemberCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanChatMessage = "SteamAPI_ISteamFriends_GetClanChatMessage";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanCount = "SteamAPI_ISteamFriends_GetClanCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanName = "SteamAPI_ISteamFriends_GetClanName";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanOfficerByIndex = "SteamAPI_ISteamFriends_GetClanOfficerByIndex";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanOfficerCount = "SteamAPI_ISteamFriends_GetClanOfficerCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanOwner = "SteamAPI_ISteamFriends_GetClanOwner";
    inline constexpr const char* SteamAPI_ISteamFriends_GetClanTag = "SteamAPI_ISteamFriends_GetClanTag";
    inline constexpr const char* SteamAPI_ISteamFriends_GetCoplayFriend = "SteamAPI_ISteamFriends_GetCoplayFriend";
    inline constexpr const char* SteamAPI_ISteamFriends_GetCoplayFriendCount = "SteamAPI_ISteamFriends_GetCoplayFriendCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFollowerCount = "SteamAPI_ISteamFriends_GetFollowerCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendByIndex = "SteamAPI_ISteamFriends_GetFriendByIndex";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendCoplayGame = "SteamAPI_ISteamFriends_GetFriendCoplayGame";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendCoplayTime = "SteamAPI_ISteamFriends_GetFriendCoplayTime";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendCount = "SteamAPI_ISteamFriends_GetFriendCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendCountFromSource = "SteamAPI_ISteamFriends_GetFriendCountFromSource";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendFromSourceByIndex = "SteamAPI_ISteamFriends_GetFriendFromSourceByIndex";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendGamePlayed = "SteamAPI_ISteamFriends_GetFriendGamePlayed";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendMessage = "SteamAPI_ISteamFriends_GetFriendMessage";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendPersonaName = "SteamAPI_ISteamFriends_GetFriendPersonaName";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendPersonaNameHistory = "SteamAPI_ISteamFriends_GetFriendPersonaNameHistory";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendPersonaState = "SteamAPI_ISteamFriends_GetFriendPersonaState";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendRelationship = "SteamAPI_ISteamFriends_GetFriendRelationship";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendRichPresence = "SteamAPI_ISteamFriends_GetFriendRichPresence";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendRichPresenceKeyByIndex = "SteamAPI_ISteamFriends_GetFriendRichPresenceKeyByIndex";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendRichPresenceKeyCount = "SteamAPI_ISteamFriends_GetFriendRichPresenceKeyCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendSteamLevel = "SteamAPI_ISteamFriends_GetFriendSteamLevel";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendsGroupCount = "SteamAPI_ISteamFriends_GetFriendsGroupCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendsGroupIDByIndex = "SteamAPI_ISteamFriends_GetFriendsGroupIDByIndex";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendsGroupMembersCount = "SteamAPI_ISteamFriends_GetFriendsGroupMembersCount";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendsGroupMembersList = "SteamAPI_ISteamFriends_GetFriendsGroupMembersList";
    inline constexpr const char* SteamAPI_ISteamFriends_GetFriendsGroupName = "SteamAPI_ISteamFriends_GetFriendsGroupName";
    inline constexpr const char* SteamAPI_ISteamFriends_GetLargeFriendAvatar = "SteamAPI_ISteamFriends_GetLargeFriendAvatar";
    inline constexpr const char* SteamAPI_ISteamFriends_GetMediumFriendAvatar = "SteamAPI_ISteamFriends_GetMediumFriendAvatar";
    inline constexpr const char* SteamAPI_ISteamFriends_GetNumChatsWithUnreadPriorityMessages = "SteamAPI_ISteamFriends_GetNumChatsWithUnreadPriorityMessages";
    inline constexpr const char* SteamAPI_ISteamFriends_GetPersonaName = "SteamAPI_ISteamFriends_GetPersonaName";
    inline constexpr const char* SteamAPI_ISteamFriends_GetPersonaState = "SteamAPI_ISteamFriends_GetPersonaState";
    inline constexpr const char* SteamAPI_ISteamFriends_GetPlayerNickname = "SteamAPI_ISteamFriends_GetPlayerNickname";
    inline constexpr const char* SteamAPI_ISteamFriends_GetProfileItemPropertyString = "SteamAPI_ISteamFriends_GetProfileItemPropertyString";
    inline constexpr const char* SteamAPI_ISteamFriends_GetProfileItemPropertyUint = "SteamAPI_ISteamFriends_GetProfileItemPropertyUint";
    inline constexpr const char* SteamAPI_ISteamFriends_GetSmallFriendAvatar = "SteamAPI_ISteamFriends_GetSmallFriendAvatar";
    inline constexpr const char* SteamAPI_ISteamFriends_HasFriend = "SteamAPI_ISteamFriends_HasFriend";
    inline constexpr const char* SteamAPI_ISteamFriends_InviteUserToGame = "SteamAPI_ISteamFriends_InviteUserToGame";
    inline constexpr const char* SteamAPI_ISteamFriends_IsClanChatAdmin = "SteamAPI_ISteamFriends_IsClanChatAdmin";
    inline constexpr const char* SteamAPI_ISteamFriends_IsClanChatWindowOpenInSteam = "SteamAPI_ISteamFriends_IsClanChatWindowOpenInSteam";
    inline constexpr const char* SteamAPI_ISteamFriends_IsClanOfficialGameGroup = "SteamAPI_ISteamFriends_IsClanOfficialGameGroup";
    inline constexpr const char* SteamAPI_ISteamFriends_IsClanPublic = "SteamAPI_ISteamFriends_IsClanPublic";
    inline constexpr const char* SteamAPI_ISteamFriends_IsFollowing = "SteamAPI_ISteamFriends_IsFollowing";
    inline constexpr const char* SteamAPI_ISteamFriends_IsUserInSource = "SteamAPI_ISteamFriends_IsUserInSource";
    inline constexpr const char* SteamAPI_ISteamFriends_JoinClanChatRoom = "SteamAPI_ISteamFriends_JoinClanChatRoom";
    inline constexpr const char* SteamAPI_ISteamFriends_LeaveClanChatRoom = "SteamAPI_ISteamFriends_LeaveClanChatRoom";
    inline constexpr const char* SteamAPI_ISteamFriends_OpenClanChatWindowInSteam = "SteamAPI_ISteamFriends_OpenClanChatWindowInSteam";
    inline constexpr const char* SteamAPI_ISteamFriends_RegisterProtocolInOverlayBrowser = "SteamAPI_ISteamFriends_RegisterProtocolInOverlayBrowser";
    inline constexpr const char* SteamAPI_ISteamFriends_ReplyToFriendMessage = "SteamAPI_ISteamFriends_ReplyToFriendMessage";
    inline constexpr const char* SteamAPI_ISteamFriends_RequestClanOfficerList = "SteamAPI_ISteamFriends_RequestClanOfficerList";
    inline constexpr const char* SteamAPI_ISteamFriends_RequestEquippedProfileItems = "SteamAPI_ISteamFriends_RequestEquippedProfileItems";
    inline constexpr const char* SteamAPI_ISteamFriends_RequestFriendRichPresence = "SteamAPI_ISteamFriends_RequestFriendRichPresence";
    inline constexpr const char* SteamAPI_ISteamFriends_RequestUserInformation = "SteamAPI_ISteamFriends_RequestUserInformation";
    inline constexpr const char* SteamAPI_ISteamFriends_SendClanChatMessage = "SteamAPI_ISteamFriends_SendClanChatMessage";
    inline constexpr const char* SteamAPI_ISteamFriends_SetInGameVoiceSpeaking = "SteamAPI_ISteamFriends_SetInGameVoiceSpeaking";
    inline constexpr const char* SteamAPI_ISteamFriends_SetListenForFriendsMessages = "SteamAPI_ISteamFriends_SetListenForFriendsMessages";
    inline constexpr const char* SteamAPI_ISteamFriends_SetPlayedWith = "SteamAPI_ISteamFriends_SetPlayedWith";
    inline constexpr const char* SteamAPI_ISteamFriends_SetRichPresence = "SteamAPI_ISteamFriends_SetRichPresence";
} // namespace isteamfriends

// ── ISteamHTTP (25 fonctions) ────────────────────────────────────────

namespace isteamhttp {
    inline constexpr const char* SteamAPI_ISteamHTTP_CreateCookieContainer = "SteamAPI_ISteamHTTP_CreateCookieContainer";
    inline constexpr const char* SteamAPI_ISteamHTTP_CreateHTTPRequest = "SteamAPI_ISteamHTTP_CreateHTTPRequest";
    inline constexpr const char* SteamAPI_ISteamHTTP_DeferHTTPRequest = "SteamAPI_ISteamHTTP_DeferHTTPRequest";
    inline constexpr const char* SteamAPI_ISteamHTTP_GetHTTPDownloadProgressPct = "SteamAPI_ISteamHTTP_GetHTTPDownloadProgressPct";
    inline constexpr const char* SteamAPI_ISteamHTTP_GetHTTPRequestWasTimedOut = "SteamAPI_ISteamHTTP_GetHTTPRequestWasTimedOut";
    inline constexpr const char* SteamAPI_ISteamHTTP_GetHTTPResponseBodyData = "SteamAPI_ISteamHTTP_GetHTTPResponseBodyData";
    inline constexpr const char* SteamAPI_ISteamHTTP_GetHTTPResponseBodySize = "SteamAPI_ISteamHTTP_GetHTTPResponseBodySize";
    inline constexpr const char* SteamAPI_ISteamHTTP_GetHTTPResponseHeaderSize = "SteamAPI_ISteamHTTP_GetHTTPResponseHeaderSize";
    inline constexpr const char* SteamAPI_ISteamHTTP_GetHTTPResponseHeaderValue = "SteamAPI_ISteamHTTP_GetHTTPResponseHeaderValue";
    inline constexpr const char* SteamAPI_ISteamHTTP_GetHTTPStreamingResponseBodyData = "SteamAPI_ISteamHTTP_GetHTTPStreamingResponseBodyData";
    inline constexpr const char* SteamAPI_ISteamHTTP_PrioritizeHTTPRequest = "SteamAPI_ISteamHTTP_PrioritizeHTTPRequest";
    inline constexpr const char* SteamAPI_ISteamHTTP_ReleaseCookieContainer = "SteamAPI_ISteamHTTP_ReleaseCookieContainer";
    inline constexpr const char* SteamAPI_ISteamHTTP_ReleaseHTTPRequest = "SteamAPI_ISteamHTTP_ReleaseHTTPRequest";
    inline constexpr const char* SteamAPI_ISteamHTTP_SendHTTPRequest = "SteamAPI_ISteamHTTP_SendHTTPRequest";
    inline constexpr const char* SteamAPI_ISteamHTTP_SendHTTPRequestAndStreamResponse = "SteamAPI_ISteamHTTP_SendHTTPRequestAndStreamResponse";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetCookie = "SteamAPI_ISteamHTTP_SetCookie";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestAbsoluteTimeoutMS = "SteamAPI_ISteamHTTP_SetHTTPRequestAbsoluteTimeoutMS";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestContextValue = "SteamAPI_ISteamHTTP_SetHTTPRequestContextValue";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestCookieContainer = "SteamAPI_ISteamHTTP_SetHTTPRequestCookieContainer";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestGetOrPostParameter = "SteamAPI_ISteamHTTP_SetHTTPRequestGetOrPostParameter";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestHeaderValue = "SteamAPI_ISteamHTTP_SetHTTPRequestHeaderValue";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestNetworkActivityTimeout = "SteamAPI_ISteamHTTP_SetHTTPRequestNetworkActivityTimeout";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestRawPostBody = "SteamAPI_ISteamHTTP_SetHTTPRequestRawPostBody";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestRequiresVerifiedCertificate = "SteamAPI_ISteamHTTP_SetHTTPRequestRequiresVerifiedCertificate";
    inline constexpr const char* SteamAPI_ISteamHTTP_SetHTTPRequestUserAgentInfo = "SteamAPI_ISteamHTTP_SetHTTPRequestUserAgentInfo";
} // namespace isteamhttp

// ── ISteamInput (48 fonctions) ───────────────────────────────────────

namespace isteaminput {
    inline constexpr const char* SteamAPI_ISteamInput_ActivateActionSet = "SteamAPI_ISteamInput_ActivateActionSet";
    inline constexpr const char* SteamAPI_ISteamInput_ActivateActionSetLayer = "SteamAPI_ISteamInput_ActivateActionSetLayer";
    inline constexpr const char* SteamAPI_ISteamInput_BNewDataAvailable = "SteamAPI_ISteamInput_BNewDataAvailable";
    inline constexpr const char* SteamAPI_ISteamInput_BWaitForData = "SteamAPI_ISteamInput_BWaitForData";
    inline constexpr const char* SteamAPI_ISteamInput_DeactivateActionSetLayer = "SteamAPI_ISteamInput_DeactivateActionSetLayer";
    inline constexpr const char* SteamAPI_ISteamInput_DeactivateAllActionSetLayers = "SteamAPI_ISteamInput_DeactivateAllActionSetLayers";
    inline constexpr const char* SteamAPI_ISteamInput_EnableActionEventCallbacks = "SteamAPI_ISteamInput_EnableActionEventCallbacks";
    inline constexpr const char* SteamAPI_ISteamInput_EnableDeviceCallbacks = "SteamAPI_ISteamInput_EnableDeviceCallbacks";
    inline constexpr const char* SteamAPI_ISteamInput_GetActionOriginFromXboxOrigin = "SteamAPI_ISteamInput_GetActionOriginFromXboxOrigin";
    inline constexpr const char* SteamAPI_ISteamInput_GetActionSetHandle = "SteamAPI_ISteamInput_GetActionSetHandle";
    inline constexpr const char* SteamAPI_ISteamInput_GetActiveActionSetLayers = "SteamAPI_ISteamInput_GetActiveActionSetLayers";
    inline constexpr const char* SteamAPI_ISteamInput_GetAnalogActionData = "SteamAPI_ISteamInput_GetAnalogActionData";
    inline constexpr const char* SteamAPI_ISteamInput_GetAnalogActionHandle = "SteamAPI_ISteamInput_GetAnalogActionHandle";
    inline constexpr const char* SteamAPI_ISteamInput_GetAnalogActionOrigins = "SteamAPI_ISteamInput_GetAnalogActionOrigins";
    inline constexpr const char* SteamAPI_ISteamInput_GetConnectedControllers = "SteamAPI_ISteamInput_GetConnectedControllers";
    inline constexpr const char* SteamAPI_ISteamInput_GetControllerForGamepadIndex = "SteamAPI_ISteamInput_GetControllerForGamepadIndex";
    inline constexpr const char* SteamAPI_ISteamInput_GetCurrentActionSet = "SteamAPI_ISteamInput_GetCurrentActionSet";
    inline constexpr const char* SteamAPI_ISteamInput_GetDeviceBindingRevision = "SteamAPI_ISteamInput_GetDeviceBindingRevision";
    inline constexpr const char* SteamAPI_ISteamInput_GetDigitalActionData = "SteamAPI_ISteamInput_GetDigitalActionData";
    inline constexpr const char* SteamAPI_ISteamInput_GetDigitalActionHandle = "SteamAPI_ISteamInput_GetDigitalActionHandle";
    inline constexpr const char* SteamAPI_ISteamInput_GetDigitalActionOrigins = "SteamAPI_ISteamInput_GetDigitalActionOrigins";
    inline constexpr const char* SteamAPI_ISteamInput_GetGamepadIndexForController = "SteamAPI_ISteamInput_GetGamepadIndexForController";
    inline constexpr const char* SteamAPI_ISteamInput_GetGlyphForActionOrigin_Legacy = "SteamAPI_ISteamInput_GetGlyphForActionOrigin_Legacy";
    inline constexpr const char* SteamAPI_ISteamInput_GetGlyphForXboxOrigin = "SteamAPI_ISteamInput_GetGlyphForXboxOrigin";
    inline constexpr const char* SteamAPI_ISteamInput_GetGlyphPNGForActionOrigin = "SteamAPI_ISteamInput_GetGlyphPNGForActionOrigin";
    inline constexpr const char* SteamAPI_ISteamInput_GetGlyphSVGForActionOrigin = "SteamAPI_ISteamInput_GetGlyphSVGForActionOrigin";
    inline constexpr const char* SteamAPI_ISteamInput_GetInputTypeForHandle = "SteamAPI_ISteamInput_GetInputTypeForHandle";
    inline constexpr const char* SteamAPI_ISteamInput_GetMotionData = "SteamAPI_ISteamInput_GetMotionData";
    inline constexpr const char* SteamAPI_ISteamInput_GetRemotePlaySessionID = "SteamAPI_ISteamInput_GetRemotePlaySessionID";
    inline constexpr const char* SteamAPI_ISteamInput_GetSessionInputConfigurationSettings = "SteamAPI_ISteamInput_GetSessionInputConfigurationSettings";
    inline constexpr const char* SteamAPI_ISteamInput_GetStringForActionOrigin = "SteamAPI_ISteamInput_GetStringForActionOrigin";
    inline constexpr const char* SteamAPI_ISteamInput_GetStringForAnalogActionName = "SteamAPI_ISteamInput_GetStringForAnalogActionName";
    inline constexpr const char* SteamAPI_ISteamInput_GetStringForDigitalActionName = "SteamAPI_ISteamInput_GetStringForDigitalActionName";
    inline constexpr const char* SteamAPI_ISteamInput_GetStringForXboxOrigin = "SteamAPI_ISteamInput_GetStringForXboxOrigin";
    inline constexpr const char* SteamAPI_ISteamInput_Init = "SteamAPI_ISteamInput_Init";
    inline constexpr const char* SteamAPI_ISteamInput_Legacy_TriggerHapticPulse = "SteamAPI_ISteamInput_Legacy_TriggerHapticPulse";
    inline constexpr const char* SteamAPI_ISteamInput_Legacy_TriggerRepeatedHapticPulse = "SteamAPI_ISteamInput_Legacy_TriggerRepeatedHapticPulse";
    inline constexpr const char* SteamAPI_ISteamInput_RunFrame = "SteamAPI_ISteamInput_RunFrame";
    inline constexpr const char* SteamAPI_ISteamInput_SetDualSenseTriggerEffect = "SteamAPI_ISteamInput_SetDualSenseTriggerEffect";
    inline constexpr const char* SteamAPI_ISteamInput_SetInputActionManifestFilePath = "SteamAPI_ISteamInput_SetInputActionManifestFilePath";
    inline constexpr const char* SteamAPI_ISteamInput_SetLEDColor = "SteamAPI_ISteamInput_SetLEDColor";
    inline constexpr const char* SteamAPI_ISteamInput_ShowBindingPanel = "SteamAPI_ISteamInput_ShowBindingPanel";
    inline constexpr const char* SteamAPI_ISteamInput_Shutdown = "SteamAPI_ISteamInput_Shutdown";
    inline constexpr const char* SteamAPI_ISteamInput_StopAnalogActionMomentum = "SteamAPI_ISteamInput_StopAnalogActionMomentum";
    inline constexpr const char* SteamAPI_ISteamInput_TranslateActionOrigin = "SteamAPI_ISteamInput_TranslateActionOrigin";
    inline constexpr const char* SteamAPI_ISteamInput_TriggerSimpleHapticEvent = "SteamAPI_ISteamInput_TriggerSimpleHapticEvent";
    inline constexpr const char* SteamAPI_ISteamInput_TriggerVibration = "SteamAPI_ISteamInput_TriggerVibration";
    inline constexpr const char* SteamAPI_ISteamInput_TriggerVibrationExtended = "SteamAPI_ISteamInput_TriggerVibrationExtended";
} // namespace isteaminput

// ── ISteamInventory (38 fonctions) ───────────────────────────────────

namespace isteaminventory {
    inline constexpr const char* SteamAPI_ISteamInventory_AddPromoItem = "SteamAPI_ISteamInventory_AddPromoItem";
    inline constexpr const char* SteamAPI_ISteamInventory_AddPromoItems = "SteamAPI_ISteamInventory_AddPromoItems";
    inline constexpr const char* SteamAPI_ISteamInventory_CheckResultSteamID = "SteamAPI_ISteamInventory_CheckResultSteamID";
    inline constexpr const char* SteamAPI_ISteamInventory_ConsumeItem = "SteamAPI_ISteamInventory_ConsumeItem";
    inline constexpr const char* SteamAPI_ISteamInventory_DeserializeResult = "SteamAPI_ISteamInventory_DeserializeResult";
    inline constexpr const char* SteamAPI_ISteamInventory_DestroyResult = "SteamAPI_ISteamInventory_DestroyResult";
    inline constexpr const char* SteamAPI_ISteamInventory_ExchangeItems = "SteamAPI_ISteamInventory_ExchangeItems";
    inline constexpr const char* SteamAPI_ISteamInventory_GenerateItems = "SteamAPI_ISteamInventory_GenerateItems";
    inline constexpr const char* SteamAPI_ISteamInventory_GetAllItems = "SteamAPI_ISteamInventory_GetAllItems";
    inline constexpr const char* SteamAPI_ISteamInventory_GetEligiblePromoItemDefinitionIDs = "SteamAPI_ISteamInventory_GetEligiblePromoItemDefinitionIDs";
    inline constexpr const char* SteamAPI_ISteamInventory_GetItemDefinitionIDs = "SteamAPI_ISteamInventory_GetItemDefinitionIDs";
    inline constexpr const char* SteamAPI_ISteamInventory_GetItemDefinitionProperty = "SteamAPI_ISteamInventory_GetItemDefinitionProperty";
    inline constexpr const char* SteamAPI_ISteamInventory_GetItemPrice = "SteamAPI_ISteamInventory_GetItemPrice";
    inline constexpr const char* SteamAPI_ISteamInventory_GetItemsByID = "SteamAPI_ISteamInventory_GetItemsByID";
    inline constexpr const char* SteamAPI_ISteamInventory_GetItemsWithPrices = "SteamAPI_ISteamInventory_GetItemsWithPrices";
    inline constexpr const char* SteamAPI_ISteamInventory_GetNumItemsWithPrices = "SteamAPI_ISteamInventory_GetNumItemsWithPrices";
    inline constexpr const char* SteamAPI_ISteamInventory_GetResultItemProperty = "SteamAPI_ISteamInventory_GetResultItemProperty";
    inline constexpr const char* SteamAPI_ISteamInventory_GetResultItems = "SteamAPI_ISteamInventory_GetResultItems";
    inline constexpr const char* SteamAPI_ISteamInventory_GetResultStatus = "SteamAPI_ISteamInventory_GetResultStatus";
    inline constexpr const char* SteamAPI_ISteamInventory_GetResultTimestamp = "SteamAPI_ISteamInventory_GetResultTimestamp";
    inline constexpr const char* SteamAPI_ISteamInventory_GrantPromoItems = "SteamAPI_ISteamInventory_GrantPromoItems";
    inline constexpr const char* SteamAPI_ISteamInventory_InspectItem = "SteamAPI_ISteamInventory_InspectItem";
    inline constexpr const char* SteamAPI_ISteamInventory_LoadItemDefinitions = "SteamAPI_ISteamInventory_LoadItemDefinitions";
    inline constexpr const char* SteamAPI_ISteamInventory_RemoveProperty = "SteamAPI_ISteamInventory_RemoveProperty";
    inline constexpr const char* SteamAPI_ISteamInventory_RequestEligiblePromoItemDefinitionsIDs = "SteamAPI_ISteamInventory_RequestEligiblePromoItemDefinitionsIDs";
    inline constexpr const char* SteamAPI_ISteamInventory_RequestPrices = "SteamAPI_ISteamInventory_RequestPrices";
    inline constexpr const char* SteamAPI_ISteamInventory_SendItemDropHeartbeat = "SteamAPI_ISteamInventory_SendItemDropHeartbeat";
    inline constexpr const char* SteamAPI_ISteamInventory_SerializeResult = "SteamAPI_ISteamInventory_SerializeResult";
    inline constexpr const char* SteamAPI_ISteamInventory_SetPropertyBool = "SteamAPI_ISteamInventory_SetPropertyBool";
    inline constexpr const char* SteamAPI_ISteamInventory_SetPropertyFloat = "SteamAPI_ISteamInventory_SetPropertyFloat";
    inline constexpr const char* SteamAPI_ISteamInventory_SetPropertyInt64 = "SteamAPI_ISteamInventory_SetPropertyInt64";
    inline constexpr const char* SteamAPI_ISteamInventory_SetPropertyString = "SteamAPI_ISteamInventory_SetPropertyString";
    inline constexpr const char* SteamAPI_ISteamInventory_StartPurchase = "SteamAPI_ISteamInventory_StartPurchase";
    inline constexpr const char* SteamAPI_ISteamInventory_StartUpdateProperties = "SteamAPI_ISteamInventory_StartUpdateProperties";
    inline constexpr const char* SteamAPI_ISteamInventory_SubmitUpdateProperties = "SteamAPI_ISteamInventory_SubmitUpdateProperties";
    inline constexpr const char* SteamAPI_ISteamInventory_TradeItems = "SteamAPI_ISteamInventory_TradeItems";
    inline constexpr const char* SteamAPI_ISteamInventory_TransferItemQuantity = "SteamAPI_ISteamInventory_TransferItemQuantity";
    inline constexpr const char* SteamAPI_ISteamInventory_TriggerItemDrop = "SteamAPI_ISteamInventory_TriggerItemDrop";
} // namespace isteaminventory

// ── ISteamMatchmaking (66 fonctions) ─────────────────────────────────

namespace isteammatchmaking {
    inline constexpr const char* SteamAPI_ISteamMatchmakingPingResponse_ServerFailedToRespond = "SteamAPI_ISteamMatchmakingPingResponse_ServerFailedToRespond";
    inline constexpr const char* SteamAPI_ISteamMatchmakingPingResponse_ServerResponded = "SteamAPI_ISteamMatchmakingPingResponse_ServerResponded";
    inline constexpr const char* SteamAPI_ISteamMatchmakingPlayersResponse_AddPlayerToList = "SteamAPI_ISteamMatchmakingPlayersResponse_AddPlayerToList";
    inline constexpr const char* SteamAPI_ISteamMatchmakingPlayersResponse_PlayersFailedToRespond = "SteamAPI_ISteamMatchmakingPlayersResponse_PlayersFailedToRespond";
    inline constexpr const char* SteamAPI_ISteamMatchmakingPlayersResponse_PlayersRefreshComplete = "SteamAPI_ISteamMatchmakingPlayersResponse_PlayersRefreshComplete";
    inline constexpr const char* SteamAPI_ISteamMatchmakingRulesResponse_RulesFailedToRespond = "SteamAPI_ISteamMatchmakingRulesResponse_RulesFailedToRespond";
    inline constexpr const char* SteamAPI_ISteamMatchmakingRulesResponse_RulesRefreshComplete = "SteamAPI_ISteamMatchmakingRulesResponse_RulesRefreshComplete";
    inline constexpr const char* SteamAPI_ISteamMatchmakingRulesResponse_RulesResponded = "SteamAPI_ISteamMatchmakingRulesResponse_RulesResponded";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServerListResponse_RefreshComplete = "SteamAPI_ISteamMatchmakingServerListResponse_RefreshComplete";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServerListResponse_ServerFailedToRespond = "SteamAPI_ISteamMatchmakingServerListResponse_ServerFailedToRespond";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServerListResponse_ServerResponded = "SteamAPI_ISteamMatchmakingServerListResponse_ServerResponded";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_CancelQuery = "SteamAPI_ISteamMatchmakingServers_CancelQuery";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_CancelServerQuery = "SteamAPI_ISteamMatchmakingServers_CancelServerQuery";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_GetServerCount = "SteamAPI_ISteamMatchmakingServers_GetServerCount";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_GetServerDetails = "SteamAPI_ISteamMatchmakingServers_GetServerDetails";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_IsRefreshing = "SteamAPI_ISteamMatchmakingServers_IsRefreshing";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_PingServer = "SteamAPI_ISteamMatchmakingServers_PingServer";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_PlayerDetails = "SteamAPI_ISteamMatchmakingServers_PlayerDetails";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_RefreshQuery = "SteamAPI_ISteamMatchmakingServers_RefreshQuery";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_RefreshServer = "SteamAPI_ISteamMatchmakingServers_RefreshServer";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_ReleaseRequest = "SteamAPI_ISteamMatchmakingServers_ReleaseRequest";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_RequestFavoritesServerList = "SteamAPI_ISteamMatchmakingServers_RequestFavoritesServerList";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_RequestFriendsServerList = "SteamAPI_ISteamMatchmakingServers_RequestFriendsServerList";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_RequestHistoryServerList = "SteamAPI_ISteamMatchmakingServers_RequestHistoryServerList";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_RequestInternetServerList = "SteamAPI_ISteamMatchmakingServers_RequestInternetServerList";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_RequestLANServerList = "SteamAPI_ISteamMatchmakingServers_RequestLANServerList";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_RequestSpectatorServerList = "SteamAPI_ISteamMatchmakingServers_RequestSpectatorServerList";
    inline constexpr const char* SteamAPI_ISteamMatchmakingServers_ServerRules = "SteamAPI_ISteamMatchmakingServers_ServerRules";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_AddFavoriteGame = "SteamAPI_ISteamMatchmaking_AddFavoriteGame";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_AddRequestLobbyListCompatibleMembersFilter = "SteamAPI_ISteamMatchmaking_AddRequestLobbyListCompatibleMembersFilter";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_AddRequestLobbyListDistanceFilter = "SteamAPI_ISteamMatchmaking_AddRequestLobbyListDistanceFilter";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_AddRequestLobbyListFilterSlotsAvailable = "SteamAPI_ISteamMatchmaking_AddRequestLobbyListFilterSlotsAvailable";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_AddRequestLobbyListNearValueFilter = "SteamAPI_ISteamMatchmaking_AddRequestLobbyListNearValueFilter";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_AddRequestLobbyListNumericalFilter = "SteamAPI_ISteamMatchmaking_AddRequestLobbyListNumericalFilter";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_AddRequestLobbyListResultCountFilter = "SteamAPI_ISteamMatchmaking_AddRequestLobbyListResultCountFilter";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_AddRequestLobbyListStringFilter = "SteamAPI_ISteamMatchmaking_AddRequestLobbyListStringFilter";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_CreateLobby = "SteamAPI_ISteamMatchmaking_CreateLobby";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_DeleteLobbyData = "SteamAPI_ISteamMatchmaking_DeleteLobbyData";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetFavoriteGame = "SteamAPI_ISteamMatchmaking_GetFavoriteGame";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetFavoriteGameCount = "SteamAPI_ISteamMatchmaking_GetFavoriteGameCount";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyByIndex = "SteamAPI_ISteamMatchmaking_GetLobbyByIndex";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyChatEntry = "SteamAPI_ISteamMatchmaking_GetLobbyChatEntry";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyData = "SteamAPI_ISteamMatchmaking_GetLobbyData";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyDataByIndex = "SteamAPI_ISteamMatchmaking_GetLobbyDataByIndex";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyDataCount = "SteamAPI_ISteamMatchmaking_GetLobbyDataCount";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyGameServer = "SteamAPI_ISteamMatchmaking_GetLobbyGameServer";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyMemberByIndex = "SteamAPI_ISteamMatchmaking_GetLobbyMemberByIndex";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyMemberData = "SteamAPI_ISteamMatchmaking_GetLobbyMemberData";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyMemberLimit = "SteamAPI_ISteamMatchmaking_GetLobbyMemberLimit";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetLobbyOwner = "SteamAPI_ISteamMatchmaking_GetLobbyOwner";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_GetNumLobbyMembers = "SteamAPI_ISteamMatchmaking_GetNumLobbyMembers";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_InviteUserToLobby = "SteamAPI_ISteamMatchmaking_InviteUserToLobby";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_JoinLobby = "SteamAPI_ISteamMatchmaking_JoinLobby";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_LeaveLobby = "SteamAPI_ISteamMatchmaking_LeaveLobby";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_RemoveFavoriteGame = "SteamAPI_ISteamMatchmaking_RemoveFavoriteGame";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_RequestLobbyData = "SteamAPI_ISteamMatchmaking_RequestLobbyData";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_RequestLobbyList = "SteamAPI_ISteamMatchmaking_RequestLobbyList";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SendLobbyChatMsg = "SteamAPI_ISteamMatchmaking_SendLobbyChatMsg";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SetLinkedLobby = "SteamAPI_ISteamMatchmaking_SetLinkedLobby";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SetLobbyData = "SteamAPI_ISteamMatchmaking_SetLobbyData";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SetLobbyGameServer = "SteamAPI_ISteamMatchmaking_SetLobbyGameServer";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SetLobbyJoinable = "SteamAPI_ISteamMatchmaking_SetLobbyJoinable";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SetLobbyMemberData = "SteamAPI_ISteamMatchmaking_SetLobbyMemberData";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SetLobbyMemberLimit = "SteamAPI_ISteamMatchmaking_SetLobbyMemberLimit";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SetLobbyOwner = "SteamAPI_ISteamMatchmaking_SetLobbyOwner";
    inline constexpr const char* SteamAPI_ISteamMatchmaking_SetLobbyType = "SteamAPI_ISteamMatchmaking_SetLobbyType";
} // namespace isteammatchmaking

// ── ISteamMusic (41 fonctions) ───────────────────────────────────────

namespace isteammusic {
    inline constexpr const char* SteamAPI_ISteamMusicRemote_BActivationSuccess = "SteamAPI_ISteamMusicRemote_BActivationSuccess";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_BIsCurrentMusicRemote = "SteamAPI_ISteamMusicRemote_BIsCurrentMusicRemote";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_CurrentEntryDidChange = "SteamAPI_ISteamMusicRemote_CurrentEntryDidChange";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_CurrentEntryIsAvailable = "SteamAPI_ISteamMusicRemote_CurrentEntryIsAvailable";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_CurrentEntryWillChange = "SteamAPI_ISteamMusicRemote_CurrentEntryWillChange";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_DeregisterSteamMusicRemote = "SteamAPI_ISteamMusicRemote_DeregisterSteamMusicRemote";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_EnableLooped = "SteamAPI_ISteamMusicRemote_EnableLooped";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_EnablePlayNext = "SteamAPI_ISteamMusicRemote_EnablePlayNext";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_EnablePlayPrevious = "SteamAPI_ISteamMusicRemote_EnablePlayPrevious";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_EnablePlaylists = "SteamAPI_ISteamMusicRemote_EnablePlaylists";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_EnableQueue = "SteamAPI_ISteamMusicRemote_EnableQueue";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_EnableShuffled = "SteamAPI_ISteamMusicRemote_EnableShuffled";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_PlaylistDidChange = "SteamAPI_ISteamMusicRemote_PlaylistDidChange";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_PlaylistWillChange = "SteamAPI_ISteamMusicRemote_PlaylistWillChange";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_QueueDidChange = "SteamAPI_ISteamMusicRemote_QueueDidChange";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_QueueWillChange = "SteamAPI_ISteamMusicRemote_QueueWillChange";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_RegisterSteamMusicRemote = "SteamAPI_ISteamMusicRemote_RegisterSteamMusicRemote";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_ResetPlaylistEntries = "SteamAPI_ISteamMusicRemote_ResetPlaylistEntries";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_ResetQueueEntries = "SteamAPI_ISteamMusicRemote_ResetQueueEntries";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_SetCurrentPlaylistEntry = "SteamAPI_ISteamMusicRemote_SetCurrentPlaylistEntry";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_SetCurrentQueueEntry = "SteamAPI_ISteamMusicRemote_SetCurrentQueueEntry";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_SetDisplayName = "SteamAPI_ISteamMusicRemote_SetDisplayName";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_SetPNGIcon_64x64 = "SteamAPI_ISteamMusicRemote_SetPNGIcon_64x64";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_SetPlaylistEntry = "SteamAPI_ISteamMusicRemote_SetPlaylistEntry";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_SetQueueEntry = "SteamAPI_ISteamMusicRemote_SetQueueEntry";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_UpdateCurrentEntryCoverArt = "SteamAPI_ISteamMusicRemote_UpdateCurrentEntryCoverArt";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_UpdateCurrentEntryElapsedSeconds = "SteamAPI_ISteamMusicRemote_UpdateCurrentEntryElapsedSeconds";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_UpdateCurrentEntryText = "SteamAPI_ISteamMusicRemote_UpdateCurrentEntryText";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_UpdateLooped = "SteamAPI_ISteamMusicRemote_UpdateLooped";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_UpdatePlaybackStatus = "SteamAPI_ISteamMusicRemote_UpdatePlaybackStatus";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_UpdateShuffled = "SteamAPI_ISteamMusicRemote_UpdateShuffled";
    inline constexpr const char* SteamAPI_ISteamMusicRemote_UpdateVolume = "SteamAPI_ISteamMusicRemote_UpdateVolume";
    inline constexpr const char* SteamAPI_ISteamMusic_BIsEnabled = "SteamAPI_ISteamMusic_BIsEnabled";
    inline constexpr const char* SteamAPI_ISteamMusic_BIsPlaying = "SteamAPI_ISteamMusic_BIsPlaying";
    inline constexpr const char* SteamAPI_ISteamMusic_GetPlaybackStatus = "SteamAPI_ISteamMusic_GetPlaybackStatus";
    inline constexpr const char* SteamAPI_ISteamMusic_GetVolume = "SteamAPI_ISteamMusic_GetVolume";
    inline constexpr const char* SteamAPI_ISteamMusic_Pause = "SteamAPI_ISteamMusic_Pause";
    inline constexpr const char* SteamAPI_ISteamMusic_Play = "SteamAPI_ISteamMusic_Play";
    inline constexpr const char* SteamAPI_ISteamMusic_PlayNext = "SteamAPI_ISteamMusic_PlayNext";
    inline constexpr const char* SteamAPI_ISteamMusic_PlayPrevious = "SteamAPI_ISteamMusic_PlayPrevious";
    inline constexpr const char* SteamAPI_ISteamMusic_SetVolume = "SteamAPI_ISteamMusic_SetVolume";
} // namespace isteammusic

// ── ISteamNetworking (120 fonctions) ──────────────────────────────────

namespace isteamnetworking {
    inline constexpr const char* SteamAPI_ISteamNetworkingFakeUDPPort_DestroyFakeUDPPort = "SteamAPI_ISteamNetworkingFakeUDPPort_DestroyFakeUDPPort";
    inline constexpr const char* SteamAPI_ISteamNetworkingFakeUDPPort_ReceiveMessages = "SteamAPI_ISteamNetworkingFakeUDPPort_ReceiveMessages";
    inline constexpr const char* SteamAPI_ISteamNetworkingFakeUDPPort_ScheduleCleanup = "SteamAPI_ISteamNetworkingFakeUDPPort_ScheduleCleanup";
    inline constexpr const char* SteamAPI_ISteamNetworkingFakeUDPPort_SendMessageToFakeIP = "SteamAPI_ISteamNetworkingFakeUDPPort_SendMessageToFakeIP";
    inline constexpr const char* SteamAPI_ISteamNetworkingMessages_AcceptSessionWithUser = "SteamAPI_ISteamNetworkingMessages_AcceptSessionWithUser";
    inline constexpr const char* SteamAPI_ISteamNetworkingMessages_CloseChannelWithUser = "SteamAPI_ISteamNetworkingMessages_CloseChannelWithUser";
    inline constexpr const char* SteamAPI_ISteamNetworkingMessages_CloseSessionWithUser = "SteamAPI_ISteamNetworkingMessages_CloseSessionWithUser";
    inline constexpr const char* SteamAPI_ISteamNetworkingMessages_GetSessionConnectionInfo = "SteamAPI_ISteamNetworkingMessages_GetSessionConnectionInfo";
    inline constexpr const char* SteamAPI_ISteamNetworkingMessages_ReceiveMessagesOnChannel = "SteamAPI_ISteamNetworkingMessages_ReceiveMessagesOnChannel";
    inline constexpr const char* SteamAPI_ISteamNetworkingMessages_SendMessageToUser = "SteamAPI_ISteamNetworkingMessages_SendMessageToUser";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_AcceptConnection = "SteamAPI_ISteamNetworkingSockets_AcceptConnection";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_BeginAsyncRequestFakeIP = "SteamAPI_ISteamNetworkingSockets_BeginAsyncRequestFakeIP";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CloseConnection = "SteamAPI_ISteamNetworkingSockets_CloseConnection";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CloseListenSocket = "SteamAPI_ISteamNetworkingSockets_CloseListenSocket";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ConfigureConnectionLanes = "SteamAPI_ISteamNetworkingSockets_ConfigureConnectionLanes";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ConnectByIPAddress = "SteamAPI_ISteamNetworkingSockets_ConnectByIPAddress";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ConnectP2P = "SteamAPI_ISteamNetworkingSockets_ConnectP2P";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ConnectP2PCustomSignaling = "SteamAPI_ISteamNetworkingSockets_ConnectP2PCustomSignaling";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ConnectToHostedDedicatedServer = "SteamAPI_ISteamNetworkingSockets_ConnectToHostedDedicatedServer";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CreateFakeUDPPort = "SteamAPI_ISteamNetworkingSockets_CreateFakeUDPPort";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CreateHostedDedicatedServerListenSocket = "SteamAPI_ISteamNetworkingSockets_CreateHostedDedicatedServerListenSocket";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CreateListenSocketIP = "SteamAPI_ISteamNetworkingSockets_CreateListenSocketIP";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CreateListenSocketP2P = "SteamAPI_ISteamNetworkingSockets_CreateListenSocketP2P";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CreateListenSocketP2PFakeIP = "SteamAPI_ISteamNetworkingSockets_CreateListenSocketP2PFakeIP";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CreatePollGroup = "SteamAPI_ISteamNetworkingSockets_CreatePollGroup";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_CreateSocketPair = "SteamAPI_ISteamNetworkingSockets_CreateSocketPair";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_DestroyPollGroup = "SteamAPI_ISteamNetworkingSockets_DestroyPollGroup";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_FindRelayAuthTicketForServer = "SteamAPI_ISteamNetworkingSockets_FindRelayAuthTicketForServer";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_FlushMessagesOnConnection = "SteamAPI_ISteamNetworkingSockets_FlushMessagesOnConnection";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetAuthenticationStatus = "SteamAPI_ISteamNetworkingSockets_GetAuthenticationStatus";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetCertificateRequest = "SteamAPI_ISteamNetworkingSockets_GetCertificateRequest";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetConnectionInfo = "SteamAPI_ISteamNetworkingSockets_GetConnectionInfo";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetConnectionName = "SteamAPI_ISteamNetworkingSockets_GetConnectionName";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetConnectionRealTimeStatus = "SteamAPI_ISteamNetworkingSockets_GetConnectionRealTimeStatus";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetConnectionUserData = "SteamAPI_ISteamNetworkingSockets_GetConnectionUserData";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetDetailedConnectionStatus = "SteamAPI_ISteamNetworkingSockets_GetDetailedConnectionStatus";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetFakeIP = "SteamAPI_ISteamNetworkingSockets_GetFakeIP";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetGameCoordinatorServerLogin = "SteamAPI_ISteamNetworkingSockets_GetGameCoordinatorServerLogin";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetHostedDedicatedServerAddress = "SteamAPI_ISteamNetworkingSockets_GetHostedDedicatedServerAddress";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetHostedDedicatedServerPOPID = "SteamAPI_ISteamNetworkingSockets_GetHostedDedicatedServerPOPID";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetHostedDedicatedServerPort = "SteamAPI_ISteamNetworkingSockets_GetHostedDedicatedServerPort";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetIdentity = "SteamAPI_ISteamNetworkingSockets_GetIdentity";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetListenSocketAddress = "SteamAPI_ISteamNetworkingSockets_GetListenSocketAddress";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_GetRemoteFakeIPForConnection = "SteamAPI_ISteamNetworkingSockets_GetRemoteFakeIPForConnection";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_InitAuthentication = "SteamAPI_ISteamNetworkingSockets_InitAuthentication";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ReceiveMessagesOnConnection = "SteamAPI_ISteamNetworkingSockets_ReceiveMessagesOnConnection";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ReceiveMessagesOnPollGroup = "SteamAPI_ISteamNetworkingSockets_ReceiveMessagesOnPollGroup";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ReceivedP2PCustomSignal = "SteamAPI_ISteamNetworkingSockets_ReceivedP2PCustomSignal";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ReceivedRelayAuthTicket = "SteamAPI_ISteamNetworkingSockets_ReceivedRelayAuthTicket";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_ResetIdentity = "SteamAPI_ISteamNetworkingSockets_ResetIdentity";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_RunCallbacks = "SteamAPI_ISteamNetworkingSockets_RunCallbacks";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_SendMessageToConnection = "SteamAPI_ISteamNetworkingSockets_SendMessageToConnection";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_SendMessages = "SteamAPI_ISteamNetworkingSockets_SendMessages";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_SetCertificate = "SteamAPI_ISteamNetworkingSockets_SetCertificate";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_SetConnectionName = "SteamAPI_ISteamNetworkingSockets_SetConnectionName";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_SetConnectionPollGroup = "SteamAPI_ISteamNetworkingSockets_SetConnectionPollGroup";
    inline constexpr const char* SteamAPI_ISteamNetworkingSockets_SetConnectionUserData = "SteamAPI_ISteamNetworkingSockets_SetConnectionUserData";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_AllocateMessage = "SteamAPI_ISteamNetworkingUtils_AllocateMessage";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_CheckPingDataUpToDate = "SteamAPI_ISteamNetworkingUtils_CheckPingDataUpToDate";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_ConvertPingLocationToString = "SteamAPI_ISteamNetworkingUtils_ConvertPingLocationToString";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_EstimatePingTimeBetweenTwoLocations = "SteamAPI_ISteamNetworkingUtils_EstimatePingTimeBetweenTwoLocations";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_EstimatePingTimeFromLocalHost = "SteamAPI_ISteamNetworkingUtils_EstimatePingTimeFromLocalHost";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetConfigValue = "SteamAPI_ISteamNetworkingUtils_GetConfigValue";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetConfigValueInfo = "SteamAPI_ISteamNetworkingUtils_GetConfigValueInfo";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetDirectPingToPOP = "SteamAPI_ISteamNetworkingUtils_GetDirectPingToPOP";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetIPv4FakeIPType = "SteamAPI_ISteamNetworkingUtils_GetIPv4FakeIPType";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetLocalPingLocation = "SteamAPI_ISteamNetworkingUtils_GetLocalPingLocation";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetLocalTimestamp = "SteamAPI_ISteamNetworkingUtils_GetLocalTimestamp";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetPOPCount = "SteamAPI_ISteamNetworkingUtils_GetPOPCount";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetPOPList = "SteamAPI_ISteamNetworkingUtils_GetPOPList";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetPingToDataCenter = "SteamAPI_ISteamNetworkingUtils_GetPingToDataCenter";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetRealIdentityForFakeIP = "SteamAPI_ISteamNetworkingUtils_GetRealIdentityForFakeIP";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_GetRelayNetworkStatus = "SteamAPI_ISteamNetworkingUtils_GetRelayNetworkStatus";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess = "SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_IsFakeIPv4 = "SteamAPI_ISteamNetworkingUtils_IsFakeIPv4";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_IterateGenericEditableConfigValues = "SteamAPI_ISteamNetworkingUtils_IterateGenericEditableConfigValues";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_ParsePingLocationString = "SteamAPI_ISteamNetworkingUtils_ParsePingLocationString";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetConfigValue = "SteamAPI_ISteamNetworkingUtils_SetConfigValue";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetConfigValueStruct = "SteamAPI_ISteamNetworkingUtils_SetConfigValueStruct";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetConnectionConfigValueFloat = "SteamAPI_ISteamNetworkingUtils_SetConnectionConfigValueFloat";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetConnectionConfigValueInt32 = "SteamAPI_ISteamNetworkingUtils_SetConnectionConfigValueInt32";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetConnectionConfigValueString = "SteamAPI_ISteamNetworkingUtils_SetConnectionConfigValueString";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetDebugOutputFunction = "SteamAPI_ISteamNetworkingUtils_SetDebugOutputFunction";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_FakeIPResult = "SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_FakeIPResult";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_MessagesSessionFailed = "SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_MessagesSessionFailed";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_MessagesSessionRequest = "SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_MessagesSessionRequest";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_SteamNetAuthenticationStatusChanged = "SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_SteamNetAuthenticationStatusChanged";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_SteamNetConnectionStatusChanged = "SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_SteamNetConnectionStatusChanged";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_SteamRelayNetworkStatusChanged = "SteamAPI_ISteamNetworkingUtils_SetGlobalCallback_SteamRelayNetworkStatusChanged";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueFloat = "SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueFloat";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueInt32 = "SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueInt32";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValuePtr = "SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValuePtr";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueString = "SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueString";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SteamNetworkingIPAddr_GetFakeIPType = "SteamAPI_ISteamNetworkingUtils_SteamNetworkingIPAddr_GetFakeIPType";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SteamNetworkingIPAddr_ParseString = "SteamAPI_ISteamNetworkingUtils_SteamNetworkingIPAddr_ParseString";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SteamNetworkingIPAddr_ToString = "SteamAPI_ISteamNetworkingUtils_SteamNetworkingIPAddr_ToString";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SteamNetworkingIdentity_ParseString = "SteamAPI_ISteamNetworkingUtils_SteamNetworkingIdentity_ParseString";
    inline constexpr const char* SteamAPI_ISteamNetworkingUtils_SteamNetworkingIdentity_ToString = "SteamAPI_ISteamNetworkingUtils_SteamNetworkingIdentity_ToString";
    inline constexpr const char* SteamAPI_ISteamNetworking_AcceptP2PSessionWithUser = "SteamAPI_ISteamNetworking_AcceptP2PSessionWithUser";
    inline constexpr const char* SteamAPI_ISteamNetworking_AllowP2PPacketRelay = "SteamAPI_ISteamNetworking_AllowP2PPacketRelay";
    inline constexpr const char* SteamAPI_ISteamNetworking_CloseP2PChannelWithUser = "SteamAPI_ISteamNetworking_CloseP2PChannelWithUser";
    inline constexpr const char* SteamAPI_ISteamNetworking_CloseP2PSessionWithUser = "SteamAPI_ISteamNetworking_CloseP2PSessionWithUser";
    inline constexpr const char* SteamAPI_ISteamNetworking_CreateConnectionSocket = "SteamAPI_ISteamNetworking_CreateConnectionSocket";
    inline constexpr const char* SteamAPI_ISteamNetworking_CreateListenSocket = "SteamAPI_ISteamNetworking_CreateListenSocket";
    inline constexpr const char* SteamAPI_ISteamNetworking_CreateP2PConnectionSocket = "SteamAPI_ISteamNetworking_CreateP2PConnectionSocket";
    inline constexpr const char* SteamAPI_ISteamNetworking_DestroyListenSocket = "SteamAPI_ISteamNetworking_DestroyListenSocket";
    inline constexpr const char* SteamAPI_ISteamNetworking_DestroySocket = "SteamAPI_ISteamNetworking_DestroySocket";
    inline constexpr const char* SteamAPI_ISteamNetworking_GetListenSocketInfo = "SteamAPI_ISteamNetworking_GetListenSocketInfo";
    inline constexpr const char* SteamAPI_ISteamNetworking_GetMaxPacketSize = "SteamAPI_ISteamNetworking_GetMaxPacketSize";
    inline constexpr const char* SteamAPI_ISteamNetworking_GetP2PSessionState = "SteamAPI_ISteamNetworking_GetP2PSessionState";
    inline constexpr const char* SteamAPI_ISteamNetworking_GetSocketConnectionType = "SteamAPI_ISteamNetworking_GetSocketConnectionType";
    inline constexpr const char* SteamAPI_ISteamNetworking_GetSocketInfo = "SteamAPI_ISteamNetworking_GetSocketInfo";
    inline constexpr const char* SteamAPI_ISteamNetworking_IsDataAvailable = "SteamAPI_ISteamNetworking_IsDataAvailable";
    inline constexpr const char* SteamAPI_ISteamNetworking_IsDataAvailableOnSocket = "SteamAPI_ISteamNetworking_IsDataAvailableOnSocket";
    inline constexpr const char* SteamAPI_ISteamNetworking_IsP2PPacketAvailable = "SteamAPI_ISteamNetworking_IsP2PPacketAvailable";
    inline constexpr const char* SteamAPI_ISteamNetworking_ReadP2PPacket = "SteamAPI_ISteamNetworking_ReadP2PPacket";
    inline constexpr const char* SteamAPI_ISteamNetworking_RetrieveData = "SteamAPI_ISteamNetworking_RetrieveData";
    inline constexpr const char* SteamAPI_ISteamNetworking_RetrieveDataFromSocket = "SteamAPI_ISteamNetworking_RetrieveDataFromSocket";
    inline constexpr const char* SteamAPI_ISteamNetworking_SendDataOnSocket = "SteamAPI_ISteamNetworking_SendDataOnSocket";
    inline constexpr const char* SteamAPI_ISteamNetworking_SendP2PPacket = "SteamAPI_ISteamNetworking_SendP2PPacket";
} // namespace isteamnetworking

// ── ISteamParentalSettings (6 fonctions) ────────────────────────────

namespace isteamparentalsettings {
    inline constexpr const char* SteamAPI_ISteamParentalSettings_BIsAppBlocked = "SteamAPI_ISteamParentalSettings_BIsAppBlocked";
    inline constexpr const char* SteamAPI_ISteamParentalSettings_BIsAppInBlockList = "SteamAPI_ISteamParentalSettings_BIsAppInBlockList";
    inline constexpr const char* SteamAPI_ISteamParentalSettings_BIsFeatureBlocked = "SteamAPI_ISteamParentalSettings_BIsFeatureBlocked";
    inline constexpr const char* SteamAPI_ISteamParentalSettings_BIsFeatureInBlockList = "SteamAPI_ISteamParentalSettings_BIsFeatureInBlockList";
    inline constexpr const char* SteamAPI_ISteamParentalSettings_BIsParentalLockEnabled = "SteamAPI_ISteamParentalSettings_BIsParentalLockEnabled";
    inline constexpr const char* SteamAPI_ISteamParentalSettings_BIsParentalLockLocked = "SteamAPI_ISteamParentalSettings_BIsParentalLockLocked";
} // namespace isteamparentalsettings

// ── ISteamRemoteStorage (59 fonctions) ───────────────────────────────

namespace isteamremotestorage {
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_BeginFileWriteBatch = "SteamAPI_ISteamRemoteStorage_BeginFileWriteBatch";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_CommitPublishedFileUpdate = "SteamAPI_ISteamRemoteStorage_CommitPublishedFileUpdate";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_CreatePublishedFileUpdateRequest = "SteamAPI_ISteamRemoteStorage_CreatePublishedFileUpdateRequest";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_DeletePublishedFile = "SteamAPI_ISteamRemoteStorage_DeletePublishedFile";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_EndFileWriteBatch = "SteamAPI_ISteamRemoteStorage_EndFileWriteBatch";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_EnumeratePublishedFilesByUserAction = "SteamAPI_ISteamRemoteStorage_EnumeratePublishedFilesByUserAction";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_EnumeratePublishedWorkshopFiles = "SteamAPI_ISteamRemoteStorage_EnumeratePublishedWorkshopFiles";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_EnumerateUserPublishedFiles = "SteamAPI_ISteamRemoteStorage_EnumerateUserPublishedFiles";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_EnumerateUserSharedWorkshopFiles = "SteamAPI_ISteamRemoteStorage_EnumerateUserSharedWorkshopFiles";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_EnumerateUserSubscribedFiles = "SteamAPI_ISteamRemoteStorage_EnumerateUserSubscribedFiles";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileDelete = "SteamAPI_ISteamRemoteStorage_FileDelete";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileExists = "SteamAPI_ISteamRemoteStorage_FileExists";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileForget = "SteamAPI_ISteamRemoteStorage_FileForget";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FilePersisted = "SteamAPI_ISteamRemoteStorage_FilePersisted";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileRead = "SteamAPI_ISteamRemoteStorage_FileRead";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileReadAsync = "SteamAPI_ISteamRemoteStorage_FileReadAsync";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileReadAsyncComplete = "SteamAPI_ISteamRemoteStorage_FileReadAsyncComplete";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileShare = "SteamAPI_ISteamRemoteStorage_FileShare";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileWrite = "SteamAPI_ISteamRemoteStorage_FileWrite";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileWriteAsync = "SteamAPI_ISteamRemoteStorage_FileWriteAsync";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileWriteStreamCancel = "SteamAPI_ISteamRemoteStorage_FileWriteStreamCancel";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileWriteStreamClose = "SteamAPI_ISteamRemoteStorage_FileWriteStreamClose";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileWriteStreamOpen = "SteamAPI_ISteamRemoteStorage_FileWriteStreamOpen";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_FileWriteStreamWriteChunk = "SteamAPI_ISteamRemoteStorage_FileWriteStreamWriteChunk";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetCachedUGCCount = "SteamAPI_ISteamRemoteStorage_GetCachedUGCCount";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetCachedUGCHandle = "SteamAPI_ISteamRemoteStorage_GetCachedUGCHandle";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetFileCount = "SteamAPI_ISteamRemoteStorage_GetFileCount";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetFileNameAndSize = "SteamAPI_ISteamRemoteStorage_GetFileNameAndSize";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetFileSize = "SteamAPI_ISteamRemoteStorage_GetFileSize";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetFileTimestamp = "SteamAPI_ISteamRemoteStorage_GetFileTimestamp";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetLocalFileChange = "SteamAPI_ISteamRemoteStorage_GetLocalFileChange";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetLocalFileChangeCount = "SteamAPI_ISteamRemoteStorage_GetLocalFileChangeCount";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetPublishedFileDetails = "SteamAPI_ISteamRemoteStorage_GetPublishedFileDetails";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetPublishedItemVoteDetails = "SteamAPI_ISteamRemoteStorage_GetPublishedItemVoteDetails";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetQuota = "SteamAPI_ISteamRemoteStorage_GetQuota";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetSyncPlatforms = "SteamAPI_ISteamRemoteStorage_GetSyncPlatforms";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetUGCDetails = "SteamAPI_ISteamRemoteStorage_GetUGCDetails";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetUGCDownloadProgress = "SteamAPI_ISteamRemoteStorage_GetUGCDownloadProgress";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_GetUserPublishedItemVoteDetails = "SteamAPI_ISteamRemoteStorage_GetUserPublishedItemVoteDetails";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_IsCloudEnabledForAccount = "SteamAPI_ISteamRemoteStorage_IsCloudEnabledForAccount";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_IsCloudEnabledForApp = "SteamAPI_ISteamRemoteStorage_IsCloudEnabledForApp";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_PublishVideo = "SteamAPI_ISteamRemoteStorage_PublishVideo";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_PublishWorkshopFile = "SteamAPI_ISteamRemoteStorage_PublishWorkshopFile";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_SetCloudEnabledForApp = "SteamAPI_ISteamRemoteStorage_SetCloudEnabledForApp";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_SetSyncPlatforms = "SteamAPI_ISteamRemoteStorage_SetSyncPlatforms";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_SetUserPublishedFileAction = "SteamAPI_ISteamRemoteStorage_SetUserPublishedFileAction";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_SubscribePublishedFile = "SteamAPI_ISteamRemoteStorage_SubscribePublishedFile";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UGCDownload = "SteamAPI_ISteamRemoteStorage_UGCDownload";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UGCDownloadToLocation = "SteamAPI_ISteamRemoteStorage_UGCDownloadToLocation";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UGCRead = "SteamAPI_ISteamRemoteStorage_UGCRead";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UnsubscribePublishedFile = "SteamAPI_ISteamRemoteStorage_UnsubscribePublishedFile";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UpdatePublishedFileDescription = "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileDescription";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UpdatePublishedFileFile = "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileFile";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UpdatePublishedFilePreviewFile = "SteamAPI_ISteamRemoteStorage_UpdatePublishedFilePreviewFile";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UpdatePublishedFileSetChangeDescription = "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileSetChangeDescription";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTags = "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTags";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTitle = "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileTitle";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UpdatePublishedFileVisibility = "SteamAPI_ISteamRemoteStorage_UpdatePublishedFileVisibility";
    inline constexpr const char* SteamAPI_ISteamRemoteStorage_UpdateUserPublishedItemVote = "SteamAPI_ISteamRemoteStorage_UpdateUserPublishedItemVote";
} // namespace isteamremotestorage

// ── ISteamScreenshots (9 fonctions) ─────────────────────────────────

namespace isteamscreenshots {
    inline constexpr const char* SteamAPI_ISteamScreenshots_AddScreenshotToLibrary = "SteamAPI_ISteamScreenshots_AddScreenshotToLibrary";
    inline constexpr const char* SteamAPI_ISteamScreenshots_AddVRScreenshotToLibrary = "SteamAPI_ISteamScreenshots_AddVRScreenshotToLibrary";
    inline constexpr const char* SteamAPI_ISteamScreenshots_HookScreenshots = "SteamAPI_ISteamScreenshots_HookScreenshots";
    inline constexpr const char* SteamAPI_ISteamScreenshots_IsScreenshotsHooked = "SteamAPI_ISteamScreenshots_IsScreenshotsHooked";
    inline constexpr const char* SteamAPI_ISteamScreenshots_SetLocation = "SteamAPI_ISteamScreenshots_SetLocation";
    inline constexpr const char* SteamAPI_ISteamScreenshots_TagPublishedFile = "SteamAPI_ISteamScreenshots_TagPublishedFile";
    inline constexpr const char* SteamAPI_ISteamScreenshots_TagUser = "SteamAPI_ISteamScreenshots_TagUser";
    inline constexpr const char* SteamAPI_ISteamScreenshots_TriggerScreenshot = "SteamAPI_ISteamScreenshots_TriggerScreenshot";
    inline constexpr const char* SteamAPI_ISteamScreenshots_WriteScreenshot = "SteamAPI_ISteamScreenshots_WriteScreenshot";
} // namespace isteamscreenshots

// ── ISteamTimeline (18 fonctions) ────────────────────────────────────

namespace isteamtimeline {
    inline constexpr const char* SteamAPI_ISteamTimeline_AddGamePhaseTag = "SteamAPI_ISteamTimeline_AddGamePhaseTag";
    inline constexpr const char* SteamAPI_ISteamTimeline_AddInstantaneousTimelineEvent = "SteamAPI_ISteamTimeline_AddInstantaneousTimelineEvent";
    inline constexpr const char* SteamAPI_ISteamTimeline_AddRangeTimelineEvent = "SteamAPI_ISteamTimeline_AddRangeTimelineEvent";
    inline constexpr const char* SteamAPI_ISteamTimeline_ClearTimelineTooltip = "SteamAPI_ISteamTimeline_ClearTimelineTooltip";
    inline constexpr const char* SteamAPI_ISteamTimeline_DoesEventRecordingExist = "SteamAPI_ISteamTimeline_DoesEventRecordingExist";
    inline constexpr const char* SteamAPI_ISteamTimeline_DoesGamePhaseRecordingExist = "SteamAPI_ISteamTimeline_DoesGamePhaseRecordingExist";
    inline constexpr const char* SteamAPI_ISteamTimeline_EndGamePhase = "SteamAPI_ISteamTimeline_EndGamePhase";
    inline constexpr const char* SteamAPI_ISteamTimeline_EndRangeTimelineEvent = "SteamAPI_ISteamTimeline_EndRangeTimelineEvent";
    inline constexpr const char* SteamAPI_ISteamTimeline_OpenOverlayToGamePhase = "SteamAPI_ISteamTimeline_OpenOverlayToGamePhase";
    inline constexpr const char* SteamAPI_ISteamTimeline_OpenOverlayToTimelineEvent = "SteamAPI_ISteamTimeline_OpenOverlayToTimelineEvent";
    inline constexpr const char* SteamAPI_ISteamTimeline_RemoveTimelineEvent = "SteamAPI_ISteamTimeline_RemoveTimelineEvent";
    inline constexpr const char* SteamAPI_ISteamTimeline_SetGamePhaseAttribute = "SteamAPI_ISteamTimeline_SetGamePhaseAttribute";
    inline constexpr const char* SteamAPI_ISteamTimeline_SetGamePhaseID = "SteamAPI_ISteamTimeline_SetGamePhaseID";
    inline constexpr const char* SteamAPI_ISteamTimeline_SetTimelineGameMode = "SteamAPI_ISteamTimeline_SetTimelineGameMode";
    inline constexpr const char* SteamAPI_ISteamTimeline_SetTimelineTooltip = "SteamAPI_ISteamTimeline_SetTimelineTooltip";
    inline constexpr const char* SteamAPI_ISteamTimeline_StartGamePhase = "SteamAPI_ISteamTimeline_StartGamePhase";
    inline constexpr const char* SteamAPI_ISteamTimeline_StartRangeTimelineEvent = "SteamAPI_ISteamTimeline_StartRangeTimelineEvent";
    inline constexpr const char* SteamAPI_ISteamTimeline_UpdateRangeTimelineEvent = "SteamAPI_ISteamTimeline_UpdateRangeTimelineEvent";
} // namespace isteamtimeline

// ── ISteamUGC (96 fonctions) ─────────────────────────────────────────

namespace isteamugc {
    inline constexpr const char* SteamAPI_ISteamUGC_AddAppDependency = "SteamAPI_ISteamUGC_AddAppDependency";
    inline constexpr const char* SteamAPI_ISteamUGC_AddContentDescriptor = "SteamAPI_ISteamUGC_AddContentDescriptor";
    inline constexpr const char* SteamAPI_ISteamUGC_AddDependency = "SteamAPI_ISteamUGC_AddDependency";
    inline constexpr const char* SteamAPI_ISteamUGC_AddExcludedTag = "SteamAPI_ISteamUGC_AddExcludedTag";
    inline constexpr const char* SteamAPI_ISteamUGC_AddItemKeyValueTag = "SteamAPI_ISteamUGC_AddItemKeyValueTag";
    inline constexpr const char* SteamAPI_ISteamUGC_AddItemPreviewFile = "SteamAPI_ISteamUGC_AddItemPreviewFile";
    inline constexpr const char* SteamAPI_ISteamUGC_AddItemPreviewVideo = "SteamAPI_ISteamUGC_AddItemPreviewVideo";
    inline constexpr const char* SteamAPI_ISteamUGC_AddItemToFavorites = "SteamAPI_ISteamUGC_AddItemToFavorites";
    inline constexpr const char* SteamAPI_ISteamUGC_AddRequiredKeyValueTag = "SteamAPI_ISteamUGC_AddRequiredKeyValueTag";
    inline constexpr const char* SteamAPI_ISteamUGC_AddRequiredTag = "SteamAPI_ISteamUGC_AddRequiredTag";
    inline constexpr const char* SteamAPI_ISteamUGC_AddRequiredTagGroup = "SteamAPI_ISteamUGC_AddRequiredTagGroup";
    inline constexpr const char* SteamAPI_ISteamUGC_BInitWorkshopForGameServer = "SteamAPI_ISteamUGC_BInitWorkshopForGameServer";
    inline constexpr const char* SteamAPI_ISteamUGC_CreateItem = "SteamAPI_ISteamUGC_CreateItem";
    inline constexpr const char* SteamAPI_ISteamUGC_CreateQueryAllUGCRequestCursor = "SteamAPI_ISteamUGC_CreateQueryAllUGCRequestCursor";
    inline constexpr const char* SteamAPI_ISteamUGC_CreateQueryAllUGCRequestPage = "SteamAPI_ISteamUGC_CreateQueryAllUGCRequestPage";
    inline constexpr const char* SteamAPI_ISteamUGC_CreateQueryUGCDetailsRequest = "SteamAPI_ISteamUGC_CreateQueryUGCDetailsRequest";
    inline constexpr const char* SteamAPI_ISteamUGC_CreateQueryUserUGCRequest = "SteamAPI_ISteamUGC_CreateQueryUserUGCRequest";
    inline constexpr const char* SteamAPI_ISteamUGC_DeleteItem = "SteamAPI_ISteamUGC_DeleteItem";
    inline constexpr const char* SteamAPI_ISteamUGC_DownloadItem = "SteamAPI_ISteamUGC_DownloadItem";
    inline constexpr const char* SteamAPI_ISteamUGC_GetAppDependencies = "SteamAPI_ISteamUGC_GetAppDependencies";
    inline constexpr const char* SteamAPI_ISteamUGC_GetItemDownloadInfo = "SteamAPI_ISteamUGC_GetItemDownloadInfo";
    inline constexpr const char* SteamAPI_ISteamUGC_GetItemInstallInfo = "SteamAPI_ISteamUGC_GetItemInstallInfo";
    inline constexpr const char* SteamAPI_ISteamUGC_GetItemState = "SteamAPI_ISteamUGC_GetItemState";
    inline constexpr const char* SteamAPI_ISteamUGC_GetItemUpdateProgress = "SteamAPI_ISteamUGC_GetItemUpdateProgress";
    inline constexpr const char* SteamAPI_ISteamUGC_GetNumSubscribedItems = "SteamAPI_ISteamUGC_GetNumSubscribedItems";
    inline constexpr const char* SteamAPI_ISteamUGC_GetNumSupportedGameVersions = "SteamAPI_ISteamUGC_GetNumSupportedGameVersions";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryFirstUGCKeyValueTag = "SteamAPI_ISteamUGC_GetQueryFirstUGCKeyValueTag";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCAdditionalPreview = "SteamAPI_ISteamUGC_GetQueryUGCAdditionalPreview";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCChildren = "SteamAPI_ISteamUGC_GetQueryUGCChildren";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCContentDescriptors = "SteamAPI_ISteamUGC_GetQueryUGCContentDescriptors";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCKeyValueTag = "SteamAPI_ISteamUGC_GetQueryUGCKeyValueTag";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCMetadata = "SteamAPI_ISteamUGC_GetQueryUGCMetadata";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCNumAdditionalPreviews = "SteamAPI_ISteamUGC_GetQueryUGCNumAdditionalPreviews";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCNumKeyValueTags = "SteamAPI_ISteamUGC_GetQueryUGCNumKeyValueTags";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCNumTags = "SteamAPI_ISteamUGC_GetQueryUGCNumTags";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCPreviewURL = "SteamAPI_ISteamUGC_GetQueryUGCPreviewURL";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCResult = "SteamAPI_ISteamUGC_GetQueryUGCResult";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCStatistic = "SteamAPI_ISteamUGC_GetQueryUGCStatistic";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCTag = "SteamAPI_ISteamUGC_GetQueryUGCTag";
    inline constexpr const char* SteamAPI_ISteamUGC_GetQueryUGCTagDisplayName = "SteamAPI_ISteamUGC_GetQueryUGCTagDisplayName";
    inline constexpr const char* SteamAPI_ISteamUGC_GetSubscribedItems = "SteamAPI_ISteamUGC_GetSubscribedItems";
    inline constexpr const char* SteamAPI_ISteamUGC_GetSupportedGameVersionData = "SteamAPI_ISteamUGC_GetSupportedGameVersionData";
    inline constexpr const char* SteamAPI_ISteamUGC_GetUserContentDescriptorPreferences = "SteamAPI_ISteamUGC_GetUserContentDescriptorPreferences";
    inline constexpr const char* SteamAPI_ISteamUGC_GetUserItemVote = "SteamAPI_ISteamUGC_GetUserItemVote";
    inline constexpr const char* SteamAPI_ISteamUGC_GetWorkshopEULAStatus = "SteamAPI_ISteamUGC_GetWorkshopEULAStatus";
    inline constexpr const char* SteamAPI_ISteamUGC_ReleaseQueryUGCRequest = "SteamAPI_ISteamUGC_ReleaseQueryUGCRequest";
    inline constexpr const char* SteamAPI_ISteamUGC_RemoveAllItemKeyValueTags = "SteamAPI_ISteamUGC_RemoveAllItemKeyValueTags";
    inline constexpr const char* SteamAPI_ISteamUGC_RemoveAppDependency = "SteamAPI_ISteamUGC_RemoveAppDependency";
    inline constexpr const char* SteamAPI_ISteamUGC_RemoveContentDescriptor = "SteamAPI_ISteamUGC_RemoveContentDescriptor";
    inline constexpr const char* SteamAPI_ISteamUGC_RemoveDependency = "SteamAPI_ISteamUGC_RemoveDependency";
    inline constexpr const char* SteamAPI_ISteamUGC_RemoveItemFromFavorites = "SteamAPI_ISteamUGC_RemoveItemFromFavorites";
    inline constexpr const char* SteamAPI_ISteamUGC_RemoveItemKeyValueTags = "SteamAPI_ISteamUGC_RemoveItemKeyValueTags";
    inline constexpr const char* SteamAPI_ISteamUGC_RemoveItemPreview = "SteamAPI_ISteamUGC_RemoveItemPreview";
    inline constexpr const char* SteamAPI_ISteamUGC_RequestUGCDetails = "SteamAPI_ISteamUGC_RequestUGCDetails";
    inline constexpr const char* SteamAPI_ISteamUGC_SendQueryUGCRequest = "SteamAPI_ISteamUGC_SendQueryUGCRequest";
    inline constexpr const char* SteamAPI_ISteamUGC_SetAdminQuery = "SteamAPI_ISteamUGC_SetAdminQuery";
    inline constexpr const char* SteamAPI_ISteamUGC_SetAllowCachedResponse = "SteamAPI_ISteamUGC_SetAllowCachedResponse";
    inline constexpr const char* SteamAPI_ISteamUGC_SetAllowLegacyUpload = "SteamAPI_ISteamUGC_SetAllowLegacyUpload";
    inline constexpr const char* SteamAPI_ISteamUGC_SetCloudFileNameFilter = "SteamAPI_ISteamUGC_SetCloudFileNameFilter";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemContent = "SteamAPI_ISteamUGC_SetItemContent";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemDescription = "SteamAPI_ISteamUGC_SetItemDescription";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemMetadata = "SteamAPI_ISteamUGC_SetItemMetadata";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemPreview = "SteamAPI_ISteamUGC_SetItemPreview";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemTags = "SteamAPI_ISteamUGC_SetItemTags";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemTitle = "SteamAPI_ISteamUGC_SetItemTitle";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemUpdateLanguage = "SteamAPI_ISteamUGC_SetItemUpdateLanguage";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemVisibility = "SteamAPI_ISteamUGC_SetItemVisibility";
    inline constexpr const char* SteamAPI_ISteamUGC_SetItemsDisabledLocally = "SteamAPI_ISteamUGC_SetItemsDisabledLocally";
    inline constexpr const char* SteamAPI_ISteamUGC_SetLanguage = "SteamAPI_ISteamUGC_SetLanguage";
    inline constexpr const char* SteamAPI_ISteamUGC_SetMatchAnyTag = "SteamAPI_ISteamUGC_SetMatchAnyTag";
    inline constexpr const char* SteamAPI_ISteamUGC_SetRankedByTrendDays = "SteamAPI_ISteamUGC_SetRankedByTrendDays";
    inline constexpr const char* SteamAPI_ISteamUGC_SetRequiredGameVersions = "SteamAPI_ISteamUGC_SetRequiredGameVersions";
    inline constexpr const char* SteamAPI_ISteamUGC_SetReturnAdditionalPreviews = "SteamAPI_ISteamUGC_SetReturnAdditionalPreviews";
    inline constexpr const char* SteamAPI_ISteamUGC_SetReturnChildren = "SteamAPI_ISteamUGC_SetReturnChildren";
    inline constexpr const char* SteamAPI_ISteamUGC_SetReturnKeyValueTags = "SteamAPI_ISteamUGC_SetReturnKeyValueTags";
    inline constexpr const char* SteamAPI_ISteamUGC_SetReturnLongDescription = "SteamAPI_ISteamUGC_SetReturnLongDescription";
    inline constexpr const char* SteamAPI_ISteamUGC_SetReturnMetadata = "SteamAPI_ISteamUGC_SetReturnMetadata";
    inline constexpr const char* SteamAPI_ISteamUGC_SetReturnOnlyIDs = "SteamAPI_ISteamUGC_SetReturnOnlyIDs";
    inline constexpr const char* SteamAPI_ISteamUGC_SetReturnPlaytimeStats = "SteamAPI_ISteamUGC_SetReturnPlaytimeStats";
    inline constexpr const char* SteamAPI_ISteamUGC_SetReturnTotalOnly = "SteamAPI_ISteamUGC_SetReturnTotalOnly";
    inline constexpr const char* SteamAPI_ISteamUGC_SetSearchText = "SteamAPI_ISteamUGC_SetSearchText";
    inline constexpr const char* SteamAPI_ISteamUGC_SetSubscriptionsLoadOrder = "SteamAPI_ISteamUGC_SetSubscriptionsLoadOrder";
    inline constexpr const char* SteamAPI_ISteamUGC_SetTimeCreatedDateRange = "SteamAPI_ISteamUGC_SetTimeCreatedDateRange";
    inline constexpr const char* SteamAPI_ISteamUGC_SetTimeUpdatedDateRange = "SteamAPI_ISteamUGC_SetTimeUpdatedDateRange";
    inline constexpr const char* SteamAPI_ISteamUGC_SetUserItemVote = "SteamAPI_ISteamUGC_SetUserItemVote";
    inline constexpr const char* SteamAPI_ISteamUGC_ShowWorkshopEULA = "SteamAPI_ISteamUGC_ShowWorkshopEULA";
    inline constexpr const char* SteamAPI_ISteamUGC_StartItemUpdate = "SteamAPI_ISteamUGC_StartItemUpdate";
    inline constexpr const char* SteamAPI_ISteamUGC_StartPlaytimeTracking = "SteamAPI_ISteamUGC_StartPlaytimeTracking";
    inline constexpr const char* SteamAPI_ISteamUGC_StopPlaytimeTracking = "SteamAPI_ISteamUGC_StopPlaytimeTracking";
    inline constexpr const char* SteamAPI_ISteamUGC_StopPlaytimeTrackingForAllItems = "SteamAPI_ISteamUGC_StopPlaytimeTrackingForAllItems";
    inline constexpr const char* SteamAPI_ISteamUGC_SubmitItemUpdate = "SteamAPI_ISteamUGC_SubmitItemUpdate";
    inline constexpr const char* SteamAPI_ISteamUGC_SubscribeItem = "SteamAPI_ISteamUGC_SubscribeItem";
    inline constexpr const char* SteamAPI_ISteamUGC_SuspendDownloads = "SteamAPI_ISteamUGC_SuspendDownloads";
    inline constexpr const char* SteamAPI_ISteamUGC_UnsubscribeItem = "SteamAPI_ISteamUGC_UnsubscribeItem";
    inline constexpr const char* SteamAPI_ISteamUGC_UpdateItemPreviewFile = "SteamAPI_ISteamUGC_UpdateItemPreviewFile";
    inline constexpr const char* SteamAPI_ISteamUGC_UpdateItemPreviewVideo = "SteamAPI_ISteamUGC_UpdateItemPreviewVideo";
} // namespace isteamugc

// ── ISteamUser (33 fonctions) ────────────────────────────────────────

namespace isteamuser {
    inline constexpr const char* SteamAPI_ISteamUser_AdvertiseGame = "SteamAPI_ISteamUser_AdvertiseGame";
    inline constexpr const char* SteamAPI_ISteamUser_BIsBehindNAT = "SteamAPI_ISteamUser_BIsBehindNAT";
    inline constexpr const char* SteamAPI_ISteamUser_BIsPhoneIdentifying = "SteamAPI_ISteamUser_BIsPhoneIdentifying";
    inline constexpr const char* SteamAPI_ISteamUser_BIsPhoneRequiringVerification = "SteamAPI_ISteamUser_BIsPhoneRequiringVerification";
    inline constexpr const char* SteamAPI_ISteamUser_BIsPhoneVerified = "SteamAPI_ISteamUser_BIsPhoneVerified";
    inline constexpr const char* SteamAPI_ISteamUser_BIsTwoFactorEnabled = "SteamAPI_ISteamUser_BIsTwoFactorEnabled";
    inline constexpr const char* SteamAPI_ISteamUser_BLoggedOn = "SteamAPI_ISteamUser_BLoggedOn";
    inline constexpr const char* SteamAPI_ISteamUser_BSetDurationControlOnlineState = "SteamAPI_ISteamUser_BSetDurationControlOnlineState";
    inline constexpr const char* SteamAPI_ISteamUser_BeginAuthSession = "SteamAPI_ISteamUser_BeginAuthSession";
    inline constexpr const char* SteamAPI_ISteamUser_CancelAuthTicket = "SteamAPI_ISteamUser_CancelAuthTicket";
    inline constexpr const char* SteamAPI_ISteamUser_DecompressVoice = "SteamAPI_ISteamUser_DecompressVoice";
    inline constexpr const char* SteamAPI_ISteamUser_EndAuthSession = "SteamAPI_ISteamUser_EndAuthSession";
    inline constexpr const char* SteamAPI_ISteamUser_GetAuthSessionTicket = "SteamAPI_ISteamUser_GetAuthSessionTicket";
    inline constexpr const char* SteamAPI_ISteamUser_GetAuthTicketForWebApi = "SteamAPI_ISteamUser_GetAuthTicketForWebApi";
    inline constexpr const char* SteamAPI_ISteamUser_GetAvailableVoice = "SteamAPI_ISteamUser_GetAvailableVoice";
    inline constexpr const char* SteamAPI_ISteamUser_GetDurationControl = "SteamAPI_ISteamUser_GetDurationControl";
    inline constexpr const char* SteamAPI_ISteamUser_GetEncryptedAppTicket = "SteamAPI_ISteamUser_GetEncryptedAppTicket";
    inline constexpr const char* SteamAPI_ISteamUser_GetGameBadgeLevel = "SteamAPI_ISteamUser_GetGameBadgeLevel";
    inline constexpr const char* SteamAPI_ISteamUser_GetHSteamUser = "SteamAPI_ISteamUser_GetHSteamUser";
    inline constexpr const char* SteamAPI_ISteamUser_GetMarketEligibility = "SteamAPI_ISteamUser_GetMarketEligibility";
    inline constexpr const char* SteamAPI_ISteamUser_GetPlayerSteamLevel = "SteamAPI_ISteamUser_GetPlayerSteamLevel";
    inline constexpr const char* SteamAPI_ISteamUser_GetSteamID = "SteamAPI_ISteamUser_GetSteamID";
    inline constexpr const char* SteamAPI_ISteamUser_GetUserDataFolder = "SteamAPI_ISteamUser_GetUserDataFolder";
    inline constexpr const char* SteamAPI_ISteamUser_GetVoice = "SteamAPI_ISteamUser_GetVoice";
    inline constexpr const char* SteamAPI_ISteamUser_GetVoiceOptimalSampleRate = "SteamAPI_ISteamUser_GetVoiceOptimalSampleRate";
    inline constexpr const char* SteamAPI_ISteamUser_InitiateGameConnection_DEPRECATED = "SteamAPI_ISteamUser_InitiateGameConnection_DEPRECATED";
    inline constexpr const char* SteamAPI_ISteamUser_RequestEncryptedAppTicket = "SteamAPI_ISteamUser_RequestEncryptedAppTicket";
    inline constexpr const char* SteamAPI_ISteamUser_RequestStoreAuthURL = "SteamAPI_ISteamUser_RequestStoreAuthURL";
    inline constexpr const char* SteamAPI_ISteamUser_StartVoiceRecording = "SteamAPI_ISteamUser_StartVoiceRecording";
    inline constexpr const char* SteamAPI_ISteamUser_StopVoiceRecording = "SteamAPI_ISteamUser_StopVoiceRecording";
    inline constexpr const char* SteamAPI_ISteamUser_TerminateGameConnection_DEPRECATED = "SteamAPI_ISteamUser_TerminateGameConnection_DEPRECATED";
    inline constexpr const char* SteamAPI_ISteamUser_TrackAppUsageEvent = "SteamAPI_ISteamUser_TrackAppUsageEvent";
    inline constexpr const char* SteamAPI_ISteamUser_UserHasLicenseForApp = "SteamAPI_ISteamUser_UserHasLicenseForApp";
} // namespace isteamuser

// ── ISteamUserStats (44 fonctions) ───────────────────────────────────

namespace isteamuserstats {
    inline constexpr const char* SteamAPI_ISteamUserStats_AttachLeaderboardUGC = "SteamAPI_ISteamUserStats_AttachLeaderboardUGC";
    inline constexpr const char* SteamAPI_ISteamUserStats_ClearAchievement = "SteamAPI_ISteamUserStats_ClearAchievement";
    inline constexpr const char* SteamAPI_ISteamUserStats_DownloadLeaderboardEntries = "SteamAPI_ISteamUserStats_DownloadLeaderboardEntries";
    inline constexpr const char* SteamAPI_ISteamUserStats_DownloadLeaderboardEntriesForUsers = "SteamAPI_ISteamUserStats_DownloadLeaderboardEntriesForUsers";
    inline constexpr const char* SteamAPI_ISteamUserStats_FindLeaderboard = "SteamAPI_ISteamUserStats_FindLeaderboard";
    inline constexpr const char* SteamAPI_ISteamUserStats_FindOrCreateLeaderboard = "SteamAPI_ISteamUserStats_FindOrCreateLeaderboard";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetAchievement = "SteamAPI_ISteamUserStats_GetAchievement";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetAchievementAchievedPercent = "SteamAPI_ISteamUserStats_GetAchievementAchievedPercent";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetAchievementAndUnlockTime = "SteamAPI_ISteamUserStats_GetAchievementAndUnlockTime";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetAchievementDisplayAttribute = "SteamAPI_ISteamUserStats_GetAchievementDisplayAttribute";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetAchievementIcon = "SteamAPI_ISteamUserStats_GetAchievementIcon";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetAchievementName = "SteamAPI_ISteamUserStats_GetAchievementName";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetAchievementProgressLimitsFloat = "SteamAPI_ISteamUserStats_GetAchievementProgressLimitsFloat";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetAchievementProgressLimitsInt32 = "SteamAPI_ISteamUserStats_GetAchievementProgressLimitsInt32";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry = "SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetGlobalStatDouble = "SteamAPI_ISteamUserStats_GetGlobalStatDouble";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetGlobalStatHistoryDouble = "SteamAPI_ISteamUserStats_GetGlobalStatHistoryDouble";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetGlobalStatHistoryInt64 = "SteamAPI_ISteamUserStats_GetGlobalStatHistoryInt64";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetGlobalStatInt64 = "SteamAPI_ISteamUserStats_GetGlobalStatInt64";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetLeaderboardDisplayType = "SteamAPI_ISteamUserStats_GetLeaderboardDisplayType";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetLeaderboardEntryCount = "SteamAPI_ISteamUserStats_GetLeaderboardEntryCount";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetLeaderboardName = "SteamAPI_ISteamUserStats_GetLeaderboardName";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetLeaderboardSortMethod = "SteamAPI_ISteamUserStats_GetLeaderboardSortMethod";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetMostAchievedAchievementInfo = "SteamAPI_ISteamUserStats_GetMostAchievedAchievementInfo";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetNextMostAchievedAchievementInfo = "SteamAPI_ISteamUserStats_GetNextMostAchievedAchievementInfo";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetNumAchievements = "SteamAPI_ISteamUserStats_GetNumAchievements";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetNumberOfCurrentPlayers = "SteamAPI_ISteamUserStats_GetNumberOfCurrentPlayers";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetStatFloat = "SteamAPI_ISteamUserStats_GetStatFloat";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetStatInt32 = "SteamAPI_ISteamUserStats_GetStatInt32";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetUserAchievement = "SteamAPI_ISteamUserStats_GetUserAchievement";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetUserAchievementAndUnlockTime = "SteamAPI_ISteamUserStats_GetUserAchievementAndUnlockTime";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetUserStatFloat = "SteamAPI_ISteamUserStats_GetUserStatFloat";
    inline constexpr const char* SteamAPI_ISteamUserStats_GetUserStatInt32 = "SteamAPI_ISteamUserStats_GetUserStatInt32";
    inline constexpr const char* SteamAPI_ISteamUserStats_IndicateAchievementProgress = "SteamAPI_ISteamUserStats_IndicateAchievementProgress";
    inline constexpr const char* SteamAPI_ISteamUserStats_RequestGlobalAchievementPercentages = "SteamAPI_ISteamUserStats_RequestGlobalAchievementPercentages";
    inline constexpr const char* SteamAPI_ISteamUserStats_RequestGlobalStats = "SteamAPI_ISteamUserStats_RequestGlobalStats";
    inline constexpr const char* SteamAPI_ISteamUserStats_RequestUserStats = "SteamAPI_ISteamUserStats_RequestUserStats";
    inline constexpr const char* SteamAPI_ISteamUserStats_ResetAllStats = "SteamAPI_ISteamUserStats_ResetAllStats";
    inline constexpr const char* SteamAPI_ISteamUserStats_SetAchievement = "SteamAPI_ISteamUserStats_SetAchievement";
    inline constexpr const char* SteamAPI_ISteamUserStats_SetStatFloat = "SteamAPI_ISteamUserStats_SetStatFloat";
    inline constexpr const char* SteamAPI_ISteamUserStats_SetStatInt32 = "SteamAPI_ISteamUserStats_SetStatInt32";
    inline constexpr const char* SteamAPI_ISteamUserStats_StoreStats = "SteamAPI_ISteamUserStats_StoreStats";
    inline constexpr const char* SteamAPI_ISteamUserStats_UpdateAvgRateStat = "SteamAPI_ISteamUserStats_UpdateAvgRateStat";
    inline constexpr const char* SteamAPI_ISteamUserStats_UploadLeaderboardScore = "SteamAPI_ISteamUserStats_UploadLeaderboardScore";
} // namespace isteamuserstats

// ── ISteamUtils (37 fonctions) ───────────────────────────────────────

namespace isteamutils {
    inline constexpr const char* SteamAPI_ISteamUtils_BOverlayNeedsPresent = "SteamAPI_ISteamUtils_BOverlayNeedsPresent";
    inline constexpr const char* SteamAPI_ISteamUtils_CheckFileSignature = "SteamAPI_ISteamUtils_CheckFileSignature";
    inline constexpr const char* SteamAPI_ISteamUtils_DismissFloatingGamepadTextInput = "SteamAPI_ISteamUtils_DismissFloatingGamepadTextInput";
    inline constexpr const char* SteamAPI_ISteamUtils_DismissGamepadTextInput = "SteamAPI_ISteamUtils_DismissGamepadTextInput";
    inline constexpr const char* SteamAPI_ISteamUtils_FilterText = "SteamAPI_ISteamUtils_FilterText";
    inline constexpr const char* SteamAPI_ISteamUtils_GetAPICallFailureReason = "SteamAPI_ISteamUtils_GetAPICallFailureReason";
    inline constexpr const char* SteamAPI_ISteamUtils_GetAPICallResult = "SteamAPI_ISteamUtils_GetAPICallResult";
    inline constexpr const char* SteamAPI_ISteamUtils_GetAppID = "SteamAPI_ISteamUtils_GetAppID";
    inline constexpr const char* SteamAPI_ISteamUtils_GetConnectedUniverse = "SteamAPI_ISteamUtils_GetConnectedUniverse";
    inline constexpr const char* SteamAPI_ISteamUtils_GetCurrentBatteryPower = "SteamAPI_ISteamUtils_GetCurrentBatteryPower";
    inline constexpr const char* SteamAPI_ISteamUtils_GetEnteredGamepadTextInput = "SteamAPI_ISteamUtils_GetEnteredGamepadTextInput";
    inline constexpr const char* SteamAPI_ISteamUtils_GetEnteredGamepadTextLength = "SteamAPI_ISteamUtils_GetEnteredGamepadTextLength";
    inline constexpr const char* SteamAPI_ISteamUtils_GetIPCCallCount = "SteamAPI_ISteamUtils_GetIPCCallCount";
    inline constexpr const char* SteamAPI_ISteamUtils_GetIPCountry = "SteamAPI_ISteamUtils_GetIPCountry";
    inline constexpr const char* SteamAPI_ISteamUtils_GetIPv6ConnectivityState = "SteamAPI_ISteamUtils_GetIPv6ConnectivityState";
    inline constexpr const char* SteamAPI_ISteamUtils_GetImageRGBA = "SteamAPI_ISteamUtils_GetImageRGBA";
    inline constexpr const char* SteamAPI_ISteamUtils_GetImageSize = "SteamAPI_ISteamUtils_GetImageSize";
    inline constexpr const char* SteamAPI_ISteamUtils_GetSecondsSinceAppActive = "SteamAPI_ISteamUtils_GetSecondsSinceAppActive";
    inline constexpr const char* SteamAPI_ISteamUtils_GetSecondsSinceComputerActive = "SteamAPI_ISteamUtils_GetSecondsSinceComputerActive";
    inline constexpr const char* SteamAPI_ISteamUtils_GetServerRealTime = "SteamAPI_ISteamUtils_GetServerRealTime";
    inline constexpr const char* SteamAPI_ISteamUtils_GetSteamUILanguage = "SteamAPI_ISteamUtils_GetSteamUILanguage";
    inline constexpr const char* SteamAPI_ISteamUtils_InitFilterText = "SteamAPI_ISteamUtils_InitFilterText";
    inline constexpr const char* SteamAPI_ISteamUtils_IsAPICallCompleted = "SteamAPI_ISteamUtils_IsAPICallCompleted";
    inline constexpr const char* SteamAPI_ISteamUtils_IsOverlayEnabled = "SteamAPI_ISteamUtils_IsOverlayEnabled";
    inline constexpr const char* SteamAPI_ISteamUtils_IsSteamChinaLauncher = "SteamAPI_ISteamUtils_IsSteamChinaLauncher";
    inline constexpr const char* SteamAPI_ISteamUtils_IsSteamInBigPictureMode = "SteamAPI_ISteamUtils_IsSteamInBigPictureMode";
    inline constexpr const char* SteamAPI_ISteamUtils_IsSteamRunningInVR = "SteamAPI_ISteamUtils_IsSteamRunningInVR";
    inline constexpr const char* SteamAPI_ISteamUtils_IsSteamRunningOnSteamDeck = "SteamAPI_ISteamUtils_IsSteamRunningOnSteamDeck";
    inline constexpr const char* SteamAPI_ISteamUtils_IsVRHeadsetStreamingEnabled = "SteamAPI_ISteamUtils_IsVRHeadsetStreamingEnabled";
    inline constexpr const char* SteamAPI_ISteamUtils_SetGameLauncherMode = "SteamAPI_ISteamUtils_SetGameLauncherMode";
    inline constexpr const char* SteamAPI_ISteamUtils_SetOverlayNotificationInset = "SteamAPI_ISteamUtils_SetOverlayNotificationInset";
    inline constexpr const char* SteamAPI_ISteamUtils_SetOverlayNotificationPosition = "SteamAPI_ISteamUtils_SetOverlayNotificationPosition";
    inline constexpr const char* SteamAPI_ISteamUtils_SetVRHeadsetStreamingEnabled = "SteamAPI_ISteamUtils_SetVRHeadsetStreamingEnabled";
    inline constexpr const char* SteamAPI_ISteamUtils_SetWarningMessageHook = "SteamAPI_ISteamUtils_SetWarningMessageHook";
    inline constexpr const char* SteamAPI_ISteamUtils_ShowFloatingGamepadTextInput = "SteamAPI_ISteamUtils_ShowFloatingGamepadTextInput";
    inline constexpr const char* SteamAPI_ISteamUtils_ShowGamepadTextInput = "SteamAPI_ISteamUtils_ShowGamepadTextInput";
    inline constexpr const char* SteamAPI_ISteamUtils_StartVRDashboard = "SteamAPI_ISteamUtils_StartVRDashboard";
} // namespace isteamutils

// ── ISteamVideo (4 fonctions) ───────────────────────────────────────

namespace isteamvideo {
    inline constexpr const char* SteamAPI_ISteamVideo_GetOPFSettings = "SteamAPI_ISteamVideo_GetOPFSettings";
    inline constexpr const char* SteamAPI_ISteamVideo_GetOPFStringForApp = "SteamAPI_ISteamVideo_GetOPFStringForApp";
    inline constexpr const char* SteamAPI_ISteamVideo_GetVideoURL = "SteamAPI_ISteamVideo_GetVideoURL";
    inline constexpr const char* SteamAPI_ISteamVideo_IsBroadcasting = "SteamAPI_ISteamVideo_IsBroadcasting";
} // namespace isteamvideo

// ── Internal (6 fonctions) ──────────────────────────────────────────

namespace internal {
    inline constexpr const char* SteamInternal_ContextInit = "SteamInternal_ContextInit";
    inline constexpr const char* SteamInternal_CreateInterface = "SteamInternal_CreateInterface";
    inline constexpr const char* SteamInternal_FindOrCreateGameServerInterface = "SteamInternal_FindOrCreateGameServerInterface";
    inline constexpr const char* SteamInternal_FindOrCreateUserInterface = "SteamInternal_FindOrCreateUserInterface";
    inline constexpr const char* SteamInternal_GameServer_Init_V2 = "SteamInternal_GameServer_Init_V2";
    inline constexpr const char* SteamInternal_SteamAPI_Init = "SteamInternal_SteamAPI_Init";
} // namespace internal

// ── Lifecycle (239 fonctions) ─────────────────────────────────────────

namespace lifecycle {
    inline constexpr const char* SteamAPI_GetHSteamPipe = "SteamAPI_GetHSteamPipe";
    inline constexpr const char* SteamAPI_GetHSteamUser = "SteamAPI_GetHSteamUser";
    inline constexpr const char* SteamAPI_GetSteamInstallPath = "SteamAPI_GetSteamInstallPath";
    inline constexpr const char* SteamAPI_ISteamClient_BReleaseSteamPipe = "SteamAPI_ISteamClient_BReleaseSteamPipe";
    inline constexpr const char* SteamAPI_ISteamClient_BShutdownIfAllPipesClosed = "SteamAPI_ISteamClient_BShutdownIfAllPipesClosed";
    inline constexpr const char* SteamAPI_ISteamClient_ConnectToGlobalUser = "SteamAPI_ISteamClient_ConnectToGlobalUser";
    inline constexpr const char* SteamAPI_ISteamClient_CreateLocalUser = "SteamAPI_ISteamClient_CreateLocalUser";
    inline constexpr const char* SteamAPI_ISteamClient_CreateSteamPipe = "SteamAPI_ISteamClient_CreateSteamPipe";
    inline constexpr const char* SteamAPI_ISteamClient_GetIPCCallCount = "SteamAPI_ISteamClient_GetIPCCallCount";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamApps = "SteamAPI_ISteamClient_GetISteamApps";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamController = "SteamAPI_ISteamClient_GetISteamController";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamFriends = "SteamAPI_ISteamClient_GetISteamFriends";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamGameSearch = "SteamAPI_ISteamClient_GetISteamGameSearch";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamGameServer = "SteamAPI_ISteamClient_GetISteamGameServer";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamGameServerStats = "SteamAPI_ISteamClient_GetISteamGameServerStats";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamGenericInterface = "SteamAPI_ISteamClient_GetISteamGenericInterface";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamHTMLSurface = "SteamAPI_ISteamClient_GetISteamHTMLSurface";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamHTTP = "SteamAPI_ISteamClient_GetISteamHTTP";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamInput = "SteamAPI_ISteamClient_GetISteamInput";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamInventory = "SteamAPI_ISteamClient_GetISteamInventory";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamMatchmaking = "SteamAPI_ISteamClient_GetISteamMatchmaking";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamMatchmakingServers = "SteamAPI_ISteamClient_GetISteamMatchmakingServers";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamMusic = "SteamAPI_ISteamClient_GetISteamMusic";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamMusicRemote = "SteamAPI_ISteamClient_GetISteamMusicRemote";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamNetworking = "SteamAPI_ISteamClient_GetISteamNetworking";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamParentalSettings = "SteamAPI_ISteamClient_GetISteamParentalSettings";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamParties = "SteamAPI_ISteamClient_GetISteamParties";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamRemotePlay = "SteamAPI_ISteamClient_GetISteamRemotePlay";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamRemoteStorage = "SteamAPI_ISteamClient_GetISteamRemoteStorage";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamScreenshots = "SteamAPI_ISteamClient_GetISteamScreenshots";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamUGC = "SteamAPI_ISteamClient_GetISteamUGC";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamUser = "SteamAPI_ISteamClient_GetISteamUser";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamUserStats = "SteamAPI_ISteamClient_GetISteamUserStats";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamUtils = "SteamAPI_ISteamClient_GetISteamUtils";
    inline constexpr const char* SteamAPI_ISteamClient_GetISteamVideo = "SteamAPI_ISteamClient_GetISteamVideo";
    inline constexpr const char* SteamAPI_ISteamClient_ReleaseUser = "SteamAPI_ISteamClient_ReleaseUser";
    inline constexpr const char* SteamAPI_ISteamClient_SetLocalIPBinding = "SteamAPI_ISteamClient_SetLocalIPBinding";
    inline constexpr const char* SteamAPI_ISteamClient_SetWarningMessageHook = "SteamAPI_ISteamClient_SetWarningMessageHook";
    inline constexpr const char* SteamAPI_ISteamController_ActivateActionSet = "SteamAPI_ISteamController_ActivateActionSet";
    inline constexpr const char* SteamAPI_ISteamController_ActivateActionSetLayer = "SteamAPI_ISteamController_ActivateActionSetLayer";
    inline constexpr const char* SteamAPI_ISteamController_DeactivateActionSetLayer = "SteamAPI_ISteamController_DeactivateActionSetLayer";
    inline constexpr const char* SteamAPI_ISteamController_DeactivateAllActionSetLayers = "SteamAPI_ISteamController_DeactivateAllActionSetLayers";
    inline constexpr const char* SteamAPI_ISteamController_GetActionOriginFromXboxOrigin = "SteamAPI_ISteamController_GetActionOriginFromXboxOrigin";
    inline constexpr const char* SteamAPI_ISteamController_GetActionSetHandle = "SteamAPI_ISteamController_GetActionSetHandle";
    inline constexpr const char* SteamAPI_ISteamController_GetActiveActionSetLayers = "SteamAPI_ISteamController_GetActiveActionSetLayers";
    inline constexpr const char* SteamAPI_ISteamController_GetAnalogActionData = "SteamAPI_ISteamController_GetAnalogActionData";
    inline constexpr const char* SteamAPI_ISteamController_GetAnalogActionHandle = "SteamAPI_ISteamController_GetAnalogActionHandle";
    inline constexpr const char* SteamAPI_ISteamController_GetAnalogActionOrigins = "SteamAPI_ISteamController_GetAnalogActionOrigins";
    inline constexpr const char* SteamAPI_ISteamController_GetConnectedControllers = "SteamAPI_ISteamController_GetConnectedControllers";
    inline constexpr const char* SteamAPI_ISteamController_GetControllerBindingRevision = "SteamAPI_ISteamController_GetControllerBindingRevision";
    inline constexpr const char* SteamAPI_ISteamController_GetControllerForGamepadIndex = "SteamAPI_ISteamController_GetControllerForGamepadIndex";
    inline constexpr const char* SteamAPI_ISteamController_GetCurrentActionSet = "SteamAPI_ISteamController_GetCurrentActionSet";
    inline constexpr const char* SteamAPI_ISteamController_GetDigitalActionData = "SteamAPI_ISteamController_GetDigitalActionData";
    inline constexpr const char* SteamAPI_ISteamController_GetDigitalActionHandle = "SteamAPI_ISteamController_GetDigitalActionHandle";
    inline constexpr const char* SteamAPI_ISteamController_GetDigitalActionOrigins = "SteamAPI_ISteamController_GetDigitalActionOrigins";
    inline constexpr const char* SteamAPI_ISteamController_GetGamepadIndexForController = "SteamAPI_ISteamController_GetGamepadIndexForController";
    inline constexpr const char* SteamAPI_ISteamController_GetGlyphForActionOrigin = "SteamAPI_ISteamController_GetGlyphForActionOrigin";
    inline constexpr const char* SteamAPI_ISteamController_GetGlyphForXboxOrigin = "SteamAPI_ISteamController_GetGlyphForXboxOrigin";
    inline constexpr const char* SteamAPI_ISteamController_GetInputTypeForHandle = "SteamAPI_ISteamController_GetInputTypeForHandle";
    inline constexpr const char* SteamAPI_ISteamController_GetMotionData = "SteamAPI_ISteamController_GetMotionData";
    inline constexpr const char* SteamAPI_ISteamController_GetStringForActionOrigin = "SteamAPI_ISteamController_GetStringForActionOrigin";
    inline constexpr const char* SteamAPI_ISteamController_GetStringForXboxOrigin = "SteamAPI_ISteamController_GetStringForXboxOrigin";
    inline constexpr const char* SteamAPI_ISteamController_Init = "SteamAPI_ISteamController_Init";
    inline constexpr const char* SteamAPI_ISteamController_RunFrame = "SteamAPI_ISteamController_RunFrame";
    inline constexpr const char* SteamAPI_ISteamController_SetLEDColor = "SteamAPI_ISteamController_SetLEDColor";
    inline constexpr const char* SteamAPI_ISteamController_ShowBindingPanel = "SteamAPI_ISteamController_ShowBindingPanel";
    inline constexpr const char* SteamAPI_ISteamController_Shutdown = "SteamAPI_ISteamController_Shutdown";
    inline constexpr const char* SteamAPI_ISteamController_StopAnalogActionMomentum = "SteamAPI_ISteamController_StopAnalogActionMomentum";
    inline constexpr const char* SteamAPI_ISteamController_TranslateActionOrigin = "SteamAPI_ISteamController_TranslateActionOrigin";
    inline constexpr const char* SteamAPI_ISteamController_TriggerHapticPulse = "SteamAPI_ISteamController_TriggerHapticPulse";
    inline constexpr const char* SteamAPI_ISteamController_TriggerRepeatedHapticPulse = "SteamAPI_ISteamController_TriggerRepeatedHapticPulse";
    inline constexpr const char* SteamAPI_ISteamController_TriggerVibration = "SteamAPI_ISteamController_TriggerVibration";
    inline constexpr const char* SteamAPI_ISteamGameSearch_AcceptGame = "SteamAPI_ISteamGameSearch_AcceptGame";
    inline constexpr const char* SteamAPI_ISteamGameSearch_AddGameSearchParams = "SteamAPI_ISteamGameSearch_AddGameSearchParams";
    inline constexpr const char* SteamAPI_ISteamGameSearch_CancelRequestPlayersForGame = "SteamAPI_ISteamGameSearch_CancelRequestPlayersForGame";
    inline constexpr const char* SteamAPI_ISteamGameSearch_DeclineGame = "SteamAPI_ISteamGameSearch_DeclineGame";
    inline constexpr const char* SteamAPI_ISteamGameSearch_EndGame = "SteamAPI_ISteamGameSearch_EndGame";
    inline constexpr const char* SteamAPI_ISteamGameSearch_EndGameSearch = "SteamAPI_ISteamGameSearch_EndGameSearch";
    inline constexpr const char* SteamAPI_ISteamGameSearch_HostConfirmGameStart = "SteamAPI_ISteamGameSearch_HostConfirmGameStart";
    inline constexpr const char* SteamAPI_ISteamGameSearch_RequestPlayersForGame = "SteamAPI_ISteamGameSearch_RequestPlayersForGame";
    inline constexpr const char* SteamAPI_ISteamGameSearch_RetrieveConnectionDetails = "SteamAPI_ISteamGameSearch_RetrieveConnectionDetails";
    inline constexpr const char* SteamAPI_ISteamGameSearch_SearchForGameSolo = "SteamAPI_ISteamGameSearch_SearchForGameSolo";
    inline constexpr const char* SteamAPI_ISteamGameSearch_SearchForGameWithLobby = "SteamAPI_ISteamGameSearch_SearchForGameWithLobby";
    inline constexpr const char* SteamAPI_ISteamGameSearch_SetConnectionDetails = "SteamAPI_ISteamGameSearch_SetConnectionDetails";
    inline constexpr const char* SteamAPI_ISteamGameSearch_SetGameHostParams = "SteamAPI_ISteamGameSearch_SetGameHostParams";
    inline constexpr const char* SteamAPI_ISteamGameSearch_SubmitPlayerResult = "SteamAPI_ISteamGameSearch_SubmitPlayerResult";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_ClearUserAchievement = "SteamAPI_ISteamGameServerStats_ClearUserAchievement";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_GetUserAchievement = "SteamAPI_ISteamGameServerStats_GetUserAchievement";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_GetUserStatFloat = "SteamAPI_ISteamGameServerStats_GetUserStatFloat";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_GetUserStatInt32 = "SteamAPI_ISteamGameServerStats_GetUserStatInt32";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_RequestUserStats = "SteamAPI_ISteamGameServerStats_RequestUserStats";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_SetUserAchievement = "SteamAPI_ISteamGameServerStats_SetUserAchievement";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_SetUserStatFloat = "SteamAPI_ISteamGameServerStats_SetUserStatFloat";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_SetUserStatInt32 = "SteamAPI_ISteamGameServerStats_SetUserStatInt32";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_StoreUserStats = "SteamAPI_ISteamGameServerStats_StoreUserStats";
    inline constexpr const char* SteamAPI_ISteamGameServerStats_UpdateUserAvgRateStat = "SteamAPI_ISteamGameServerStats_UpdateUserAvgRateStat";
    inline constexpr const char* SteamAPI_ISteamGameServer_AssociateWithClan = "SteamAPI_ISteamGameServer_AssociateWithClan";
    inline constexpr const char* SteamAPI_ISteamGameServer_BLoggedOn = "SteamAPI_ISteamGameServer_BLoggedOn";
    inline constexpr const char* SteamAPI_ISteamGameServer_BSecure = "SteamAPI_ISteamGameServer_BSecure";
    inline constexpr const char* SteamAPI_ISteamGameServer_BUpdateUserData = "SteamAPI_ISteamGameServer_BUpdateUserData";
    inline constexpr const char* SteamAPI_ISteamGameServer_BeginAuthSession = "SteamAPI_ISteamGameServer_BeginAuthSession";
    inline constexpr const char* SteamAPI_ISteamGameServer_CancelAuthTicket = "SteamAPI_ISteamGameServer_CancelAuthTicket";
    inline constexpr const char* SteamAPI_ISteamGameServer_ClearAllKeyValues = "SteamAPI_ISteamGameServer_ClearAllKeyValues";
    inline constexpr const char* SteamAPI_ISteamGameServer_ComputeNewPlayerCompatibility = "SteamAPI_ISteamGameServer_ComputeNewPlayerCompatibility";
    inline constexpr const char* SteamAPI_ISteamGameServer_CreateUnauthenticatedUserConnection = "SteamAPI_ISteamGameServer_CreateUnauthenticatedUserConnection";
    inline constexpr const char* SteamAPI_ISteamGameServer_EndAuthSession = "SteamAPI_ISteamGameServer_EndAuthSession";
    inline constexpr const char* SteamAPI_ISteamGameServer_GetAuthSessionTicket = "SteamAPI_ISteamGameServer_GetAuthSessionTicket";
    inline constexpr const char* SteamAPI_ISteamGameServer_GetGameplayStats = "SteamAPI_ISteamGameServer_GetGameplayStats";
    inline constexpr const char* SteamAPI_ISteamGameServer_GetNextOutgoingPacket = "SteamAPI_ISteamGameServer_GetNextOutgoingPacket";
    inline constexpr const char* SteamAPI_ISteamGameServer_GetPublicIP = "SteamAPI_ISteamGameServer_GetPublicIP";
    inline constexpr const char* SteamAPI_ISteamGameServer_GetServerReputation = "SteamAPI_ISteamGameServer_GetServerReputation";
    inline constexpr const char* SteamAPI_ISteamGameServer_GetSteamID = "SteamAPI_ISteamGameServer_GetSteamID";
    inline constexpr const char* SteamAPI_ISteamGameServer_HandleIncomingPacket = "SteamAPI_ISteamGameServer_HandleIncomingPacket";
    inline constexpr const char* SteamAPI_ISteamGameServer_LogOff = "SteamAPI_ISteamGameServer_LogOff";
    inline constexpr const char* SteamAPI_ISteamGameServer_LogOn = "SteamAPI_ISteamGameServer_LogOn";
    inline constexpr const char* SteamAPI_ISteamGameServer_LogOnAnonymous = "SteamAPI_ISteamGameServer_LogOnAnonymous";
    inline constexpr const char* SteamAPI_ISteamGameServer_RequestUserGroupStatus = "SteamAPI_ISteamGameServer_RequestUserGroupStatus";
    inline constexpr const char* SteamAPI_ISteamGameServer_SendUserConnectAndAuthenticate_DEPRECATED = "SteamAPI_ISteamGameServer_SendUserConnectAndAuthenticate_DEPRECATED";
    inline constexpr const char* SteamAPI_ISteamGameServer_SendUserDisconnect_DEPRECATED = "SteamAPI_ISteamGameServer_SendUserDisconnect_DEPRECATED";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetAdvertiseServerActive = "SteamAPI_ISteamGameServer_SetAdvertiseServerActive";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetBotPlayerCount = "SteamAPI_ISteamGameServer_SetBotPlayerCount";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetDedicatedServer = "SteamAPI_ISteamGameServer_SetDedicatedServer";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetGameData = "SteamAPI_ISteamGameServer_SetGameData";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetGameDescription = "SteamAPI_ISteamGameServer_SetGameDescription";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetGameTags = "SteamAPI_ISteamGameServer_SetGameTags";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetKeyValue = "SteamAPI_ISteamGameServer_SetKeyValue";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetMapName = "SteamAPI_ISteamGameServer_SetMapName";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetMaxPlayerCount = "SteamAPI_ISteamGameServer_SetMaxPlayerCount";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetModDir = "SteamAPI_ISteamGameServer_SetModDir";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetPasswordProtected = "SteamAPI_ISteamGameServer_SetPasswordProtected";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetProduct = "SteamAPI_ISteamGameServer_SetProduct";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetRegion = "SteamAPI_ISteamGameServer_SetRegion";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetServerName = "SteamAPI_ISteamGameServer_SetServerName";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetSpectatorPort = "SteamAPI_ISteamGameServer_SetSpectatorPort";
    inline constexpr const char* SteamAPI_ISteamGameServer_SetSpectatorServerName = "SteamAPI_ISteamGameServer_SetSpectatorServerName";
    inline constexpr const char* SteamAPI_ISteamGameServer_UserHasLicenseForApp = "SteamAPI_ISteamGameServer_UserHasLicenseForApp";
    inline constexpr const char* SteamAPI_ISteamGameServer_WasRestartRequested = "SteamAPI_ISteamGameServer_WasRestartRequested";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_AddHeader = "SteamAPI_ISteamHTMLSurface_AddHeader";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_AllowStartRequest = "SteamAPI_ISteamHTMLSurface_AllowStartRequest";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_CopyToClipboard = "SteamAPI_ISteamHTMLSurface_CopyToClipboard";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_CreateBrowser = "SteamAPI_ISteamHTMLSurface_CreateBrowser";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_ExecuteJavascript = "SteamAPI_ISteamHTMLSurface_ExecuteJavascript";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_FileLoadDialogResponse = "SteamAPI_ISteamHTMLSurface_FileLoadDialogResponse";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_Find = "SteamAPI_ISteamHTMLSurface_Find";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_GetLinkAtPosition = "SteamAPI_ISteamHTMLSurface_GetLinkAtPosition";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_GoBack = "SteamAPI_ISteamHTMLSurface_GoBack";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_GoForward = "SteamAPI_ISteamHTMLSurface_GoForward";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_Init = "SteamAPI_ISteamHTMLSurface_Init";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_JSDialogResponse = "SteamAPI_ISteamHTMLSurface_JSDialogResponse";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_KeyChar = "SteamAPI_ISteamHTMLSurface_KeyChar";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_KeyDown = "SteamAPI_ISteamHTMLSurface_KeyDown";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_KeyUp = "SteamAPI_ISteamHTMLSurface_KeyUp";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_LoadURL = "SteamAPI_ISteamHTMLSurface_LoadURL";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_MouseDoubleClick = "SteamAPI_ISteamHTMLSurface_MouseDoubleClick";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_MouseDown = "SteamAPI_ISteamHTMLSurface_MouseDown";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_MouseMove = "SteamAPI_ISteamHTMLSurface_MouseMove";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_MouseUp = "SteamAPI_ISteamHTMLSurface_MouseUp";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_MouseWheel = "SteamAPI_ISteamHTMLSurface_MouseWheel";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_OpenDeveloperTools = "SteamAPI_ISteamHTMLSurface_OpenDeveloperTools";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_PasteFromClipboard = "SteamAPI_ISteamHTMLSurface_PasteFromClipboard";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_Reload = "SteamAPI_ISteamHTMLSurface_Reload";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_RemoveBrowser = "SteamAPI_ISteamHTMLSurface_RemoveBrowser";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_SetBackgroundMode = "SteamAPI_ISteamHTMLSurface_SetBackgroundMode";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_SetCookie = "SteamAPI_ISteamHTMLSurface_SetCookie";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_SetDPIScalingFactor = "SteamAPI_ISteamHTMLSurface_SetDPIScalingFactor";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_SetHorizontalScroll = "SteamAPI_ISteamHTMLSurface_SetHorizontalScroll";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_SetKeyFocus = "SteamAPI_ISteamHTMLSurface_SetKeyFocus";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_SetPageScaleFactor = "SteamAPI_ISteamHTMLSurface_SetPageScaleFactor";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_SetSize = "SteamAPI_ISteamHTMLSurface_SetSize";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_SetVerticalScroll = "SteamAPI_ISteamHTMLSurface_SetVerticalScroll";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_Shutdown = "SteamAPI_ISteamHTMLSurface_Shutdown";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_StopFind = "SteamAPI_ISteamHTMLSurface_StopFind";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_StopLoad = "SteamAPI_ISteamHTMLSurface_StopLoad";
    inline constexpr const char* SteamAPI_ISteamHTMLSurface_ViewSource = "SteamAPI_ISteamHTMLSurface_ViewSource";
    inline constexpr const char* SteamAPI_ISteamParties_CancelReservation = "SteamAPI_ISteamParties_CancelReservation";
    inline constexpr const char* SteamAPI_ISteamParties_ChangeNumOpenSlots = "SteamAPI_ISteamParties_ChangeNumOpenSlots";
    inline constexpr const char* SteamAPI_ISteamParties_CreateBeacon = "SteamAPI_ISteamParties_CreateBeacon";
    inline constexpr const char* SteamAPI_ISteamParties_DestroyBeacon = "SteamAPI_ISteamParties_DestroyBeacon";
    inline constexpr const char* SteamAPI_ISteamParties_GetAvailableBeaconLocations = "SteamAPI_ISteamParties_GetAvailableBeaconLocations";
    inline constexpr const char* SteamAPI_ISteamParties_GetBeaconByIndex = "SteamAPI_ISteamParties_GetBeaconByIndex";
    inline constexpr const char* SteamAPI_ISteamParties_GetBeaconDetails = "SteamAPI_ISteamParties_GetBeaconDetails";
    inline constexpr const char* SteamAPI_ISteamParties_GetBeaconLocationData = "SteamAPI_ISteamParties_GetBeaconLocationData";
    inline constexpr const char* SteamAPI_ISteamParties_GetNumActiveBeacons = "SteamAPI_ISteamParties_GetNumActiveBeacons";
    inline constexpr const char* SteamAPI_ISteamParties_GetNumAvailableBeaconLocations = "SteamAPI_ISteamParties_GetNumAvailableBeaconLocations";
    inline constexpr const char* SteamAPI_ISteamParties_JoinParty = "SteamAPI_ISteamParties_JoinParty";
    inline constexpr const char* SteamAPI_ISteamParties_OnReservationCompleted = "SteamAPI_ISteamParties_OnReservationCompleted";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_BEnableRemotePlayTogetherDirectInput = "SteamAPI_ISteamRemotePlay_BEnableRemotePlayTogetherDirectInput";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_BGetSessionClientResolution = "SteamAPI_ISteamRemotePlay_BGetSessionClientResolution";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_BSendRemotePlayTogetherInvite = "SteamAPI_ISteamRemotePlay_BSendRemotePlayTogetherInvite";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_CreateMouseCursor = "SteamAPI_ISteamRemotePlay_CreateMouseCursor";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_DisableRemotePlayTogetherDirectInput = "SteamAPI_ISteamRemotePlay_DisableRemotePlayTogetherDirectInput";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_GetInput = "SteamAPI_ISteamRemotePlay_GetInput";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_GetSessionClientFormFactor = "SteamAPI_ISteamRemotePlay_GetSessionClientFormFactor";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_GetSessionClientName = "SteamAPI_ISteamRemotePlay_GetSessionClientName";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_GetSessionCount = "SteamAPI_ISteamRemotePlay_GetSessionCount";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_GetSessionID = "SteamAPI_ISteamRemotePlay_GetSessionID";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_GetSessionSteamID = "SteamAPI_ISteamRemotePlay_GetSessionSteamID";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_SetMouseCursor = "SteamAPI_ISteamRemotePlay_SetMouseCursor";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_SetMousePosition = "SteamAPI_ISteamRemotePlay_SetMousePosition";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_SetMouseVisibility = "SteamAPI_ISteamRemotePlay_SetMouseVisibility";
    inline constexpr const char* SteamAPI_ISteamRemotePlay_ShowRemotePlayTogetherUI = "SteamAPI_ISteamRemotePlay_ShowRemotePlayTogetherUI";
    inline constexpr const char* SteamAPI_InitAnonymousUser = "SteamAPI_InitAnonymousUser";
    inline constexpr const char* SteamAPI_InitFlat = "SteamAPI_InitFlat";
    inline constexpr const char* SteamAPI_InitSafe = "SteamAPI_InitSafe";
    inline constexpr const char* SteamAPI_IsSteamRunning = "SteamAPI_IsSteamRunning";
    inline constexpr const char* SteamAPI_ManualDispatch_FreeLastCallback = "SteamAPI_ManualDispatch_FreeLastCallback";
    inline constexpr const char* SteamAPI_ManualDispatch_GetAPICallResult = "SteamAPI_ManualDispatch_GetAPICallResult";
    inline constexpr const char* SteamAPI_ManualDispatch_GetNextCallback = "SteamAPI_ManualDispatch_GetNextCallback";
    inline constexpr const char* SteamAPI_ManualDispatch_Init = "SteamAPI_ManualDispatch_Init";
    inline constexpr const char* SteamAPI_ManualDispatch_RunFrame = "SteamAPI_ManualDispatch_RunFrame";
    inline constexpr const char* SteamAPI_MatchMakingKeyValuePair_t_Construct = "SteamAPI_MatchMakingKeyValuePair_t_Construct";
    inline constexpr const char* SteamAPI_RegisterCallResult = "SteamAPI_RegisterCallResult";
    inline constexpr const char* SteamAPI_RegisterCallback = "SteamAPI_RegisterCallback";
    inline constexpr const char* SteamAPI_ReleaseCurrentThreadMemory = "SteamAPI_ReleaseCurrentThreadMemory";
    inline constexpr const char* SteamAPI_RestartAppIfNecessary = "SteamAPI_RestartAppIfNecessary";
    inline constexpr const char* SteamAPI_RunCallbacks = "SteamAPI_RunCallbacks";
    inline constexpr const char* SteamAPI_SetBreakpadAppID = "SteamAPI_SetBreakpadAppID";
    inline constexpr const char* SteamAPI_SetMiniDumpComment = "SteamAPI_SetMiniDumpComment";
    inline constexpr const char* SteamAPI_SetTryCatchCallbacks = "SteamAPI_SetTryCatchCallbacks";
    inline constexpr const char* SteamAPI_Shutdown = "SteamAPI_Shutdown";
    inline constexpr const char* SteamAPI_UnregisterCallResult = "SteamAPI_UnregisterCallResult";
    inline constexpr const char* SteamAPI_UnregisterCallback = "SteamAPI_UnregisterCallback";
    inline constexpr const char* SteamAPI_UseBreakpadCrashHandler = "SteamAPI_UseBreakpadCrashHandler";
    inline constexpr const char* SteamAPI_WriteMiniDump = "SteamAPI_WriteMiniDump";
    inline constexpr const char* SteamAPI_gameserveritem_t_Construct = "SteamAPI_gameserveritem_t_Construct";
    inline constexpr const char* SteamAPI_gameserveritem_t_GetName = "SteamAPI_gameserveritem_t_GetName";
    inline constexpr const char* SteamAPI_gameserveritem_t_SetName = "SteamAPI_gameserveritem_t_SetName";
    inline constexpr const char* SteamAPI_servernetadr_t_Assign = "SteamAPI_servernetadr_t_Assign";
    inline constexpr const char* SteamAPI_servernetadr_t_Construct = "SteamAPI_servernetadr_t_Construct";
    inline constexpr const char* SteamAPI_servernetadr_t_GetConnectionAddressString = "SteamAPI_servernetadr_t_GetConnectionAddressString";
    inline constexpr const char* SteamAPI_servernetadr_t_GetConnectionPort = "SteamAPI_servernetadr_t_GetConnectionPort";
    inline constexpr const char* SteamAPI_servernetadr_t_GetIP = "SteamAPI_servernetadr_t_GetIP";
    inline constexpr const char* SteamAPI_servernetadr_t_GetQueryAddressString = "SteamAPI_servernetadr_t_GetQueryAddressString";
    inline constexpr const char* SteamAPI_servernetadr_t_GetQueryPort = "SteamAPI_servernetadr_t_GetQueryPort";
    inline constexpr const char* SteamAPI_servernetadr_t_Init = "SteamAPI_servernetadr_t_Init";
    inline constexpr const char* SteamAPI_servernetadr_t_IsLessThan = "SteamAPI_servernetadr_t_IsLessThan";
    inline constexpr const char* SteamAPI_servernetadr_t_SetConnectionPort = "SteamAPI_servernetadr_t_SetConnectionPort";
    inline constexpr const char* SteamAPI_servernetadr_t_SetIP = "SteamAPI_servernetadr_t_SetIP";
    inline constexpr const char* SteamAPI_servernetadr_t_SetQueryPort = "SteamAPI_servernetadr_t_SetQueryPort";
} // namespace lifecycle

// ── Other (12 fonctions) ─────────────────────────────────────────────

namespace other {
    inline constexpr const char* GetHSteamPipe = "GetHSteamPipe";
    inline constexpr const char* GetHSteamUser = "GetHSteamUser";
    inline constexpr const char* SteamClient = "SteamClient";
    inline constexpr const char* SteamGameServer_BSecure = "SteamGameServer_BSecure";
    inline constexpr const char* SteamGameServer_GetHSteamPipe = "SteamGameServer_GetHSteamPipe";
    inline constexpr const char* SteamGameServer_GetHSteamUser = "SteamGameServer_GetHSteamUser";
    inline constexpr const char* SteamGameServer_GetIPCCallCount = "SteamGameServer_GetIPCCallCount";
    inline constexpr const char* SteamGameServer_GetSteamID = "SteamGameServer_GetSteamID";
    inline constexpr const char* SteamGameServer_InitSafe = "SteamGameServer_InitSafe";
    inline constexpr const char* SteamGameServer_RunCallbacks = "SteamGameServer_RunCallbacks";
    inline constexpr const char* SteamGameServer_Shutdown = "SteamGameServer_Shutdown";
    inline constexpr const char* g_pSteamClientGameServer = "g_pSteamClientGameServer";
} // namespace other

} // namespace iecode::imports::steam_api
