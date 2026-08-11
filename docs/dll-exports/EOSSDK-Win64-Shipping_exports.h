#pragma once

/// @file EOSSDK-Win64-Shipping_exports.h
/// Exports de EOSSDK-Win64-Shipping.dll (668 fonctions)
/// Genere automatiquement par analyze_game_dlls.py
///
/// Utilisation : chargement dynamique via LoadLibrary + GetProcAddress

#include <cstdint>

namespace iecode::imports::eossdk_win_shipping {

/// Nom de la DLL a charger.
inline constexpr const char* DLL_NAME = "EOSSDK-Win64-Shipping.dll";

/// Nombre total d'exports.
inline constexpr int EXPORT_COUNT = 668;

// ── Achievements (21 fonctions) ──────────────────────────────────────

namespace achievements {
    inline constexpr const char* EOS_Achievements_AddNotifyAchievementsUnlocked = "EOS_Achievements_AddNotifyAchievementsUnlocked";
    inline constexpr const char* EOS_Achievements_AddNotifyAchievementsUnlockedV2 = "EOS_Achievements_AddNotifyAchievementsUnlockedV2";
    inline constexpr const char* EOS_Achievements_CopyAchievementDefinitionByAchievementId = "EOS_Achievements_CopyAchievementDefinitionByAchievementId";
    inline constexpr const char* EOS_Achievements_CopyAchievementDefinitionByIndex = "EOS_Achievements_CopyAchievementDefinitionByIndex";
    inline constexpr const char* EOS_Achievements_CopyAchievementDefinitionV2ByAchievementId = "EOS_Achievements_CopyAchievementDefinitionV2ByAchievementId";
    inline constexpr const char* EOS_Achievements_CopyAchievementDefinitionV2ByIndex = "EOS_Achievements_CopyAchievementDefinitionV2ByIndex";
    inline constexpr const char* EOS_Achievements_CopyPlayerAchievementByAchievementId = "EOS_Achievements_CopyPlayerAchievementByAchievementId";
    inline constexpr const char* EOS_Achievements_CopyPlayerAchievementByIndex = "EOS_Achievements_CopyPlayerAchievementByIndex";
    inline constexpr const char* EOS_Achievements_CopyUnlockedAchievementByAchievementId = "EOS_Achievements_CopyUnlockedAchievementByAchievementId";
    inline constexpr const char* EOS_Achievements_CopyUnlockedAchievementByIndex = "EOS_Achievements_CopyUnlockedAchievementByIndex";
    inline constexpr const char* EOS_Achievements_DefinitionV2_Release = "EOS_Achievements_DefinitionV2_Release";
    inline constexpr const char* EOS_Achievements_Definition_Release = "EOS_Achievements_Definition_Release";
    inline constexpr const char* EOS_Achievements_GetAchievementDefinitionCount = "EOS_Achievements_GetAchievementDefinitionCount";
    inline constexpr const char* EOS_Achievements_GetPlayerAchievementCount = "EOS_Achievements_GetPlayerAchievementCount";
    inline constexpr const char* EOS_Achievements_GetUnlockedAchievementCount = "EOS_Achievements_GetUnlockedAchievementCount";
    inline constexpr const char* EOS_Achievements_PlayerAchievement_Release = "EOS_Achievements_PlayerAchievement_Release";
    inline constexpr const char* EOS_Achievements_QueryDefinitions = "EOS_Achievements_QueryDefinitions";
    inline constexpr const char* EOS_Achievements_QueryPlayerAchievements = "EOS_Achievements_QueryPlayerAchievements";
    inline constexpr const char* EOS_Achievements_RemoveNotifyAchievementsUnlocked = "EOS_Achievements_RemoveNotifyAchievementsUnlocked";
    inline constexpr const char* EOS_Achievements_UnlockAchievements = "EOS_Achievements_UnlockAchievements";
    inline constexpr const char* EOS_Achievements_UnlockedAchievement_Release = "EOS_Achievements_UnlockedAchievement_Release";
} // namespace achievements

// ── AntiCheat (50 fonctions) ─────────────────────────────────────────

namespace anticheat {
    inline constexpr const char* EOS_AntiCheatClient_AddExternalIntegrityCatalog = "EOS_AntiCheatClient_AddExternalIntegrityCatalog";
    inline constexpr const char* EOS_AntiCheatClient_AddNotifyClientIntegrityViolated = "EOS_AntiCheatClient_AddNotifyClientIntegrityViolated";
    inline constexpr const char* EOS_AntiCheatClient_AddNotifyMessageToPeer = "EOS_AntiCheatClient_AddNotifyMessageToPeer";
    inline constexpr const char* EOS_AntiCheatClient_AddNotifyMessageToServer = "EOS_AntiCheatClient_AddNotifyMessageToServer";
    inline constexpr const char* EOS_AntiCheatClient_AddNotifyPeerActionRequired = "EOS_AntiCheatClient_AddNotifyPeerActionRequired";
    inline constexpr const char* EOS_AntiCheatClient_AddNotifyPeerAuthStatusChanged = "EOS_AntiCheatClient_AddNotifyPeerAuthStatusChanged";
    inline constexpr const char* EOS_AntiCheatClient_BeginSession = "EOS_AntiCheatClient_BeginSession";
    inline constexpr const char* EOS_AntiCheatClient_EndSession = "EOS_AntiCheatClient_EndSession";
    inline constexpr const char* EOS_AntiCheatClient_GetProtectMessageOutputLength = "EOS_AntiCheatClient_GetProtectMessageOutputLength";
    inline constexpr const char* EOS_AntiCheatClient_PollStatus = "EOS_AntiCheatClient_PollStatus";
    inline constexpr const char* EOS_AntiCheatClient_ProtectMessage = "EOS_AntiCheatClient_ProtectMessage";
    inline constexpr const char* EOS_AntiCheatClient_ReceiveMessageFromPeer = "EOS_AntiCheatClient_ReceiveMessageFromPeer";
    inline constexpr const char* EOS_AntiCheatClient_ReceiveMessageFromServer = "EOS_AntiCheatClient_ReceiveMessageFromServer";
    inline constexpr const char* EOS_AntiCheatClient_RegisterPeer = "EOS_AntiCheatClient_RegisterPeer";
    inline constexpr const char* EOS_AntiCheatClient_RemoveNotifyClientIntegrityViolated = "EOS_AntiCheatClient_RemoveNotifyClientIntegrityViolated";
    inline constexpr const char* EOS_AntiCheatClient_RemoveNotifyMessageToPeer = "EOS_AntiCheatClient_RemoveNotifyMessageToPeer";
    inline constexpr const char* EOS_AntiCheatClient_RemoveNotifyMessageToServer = "EOS_AntiCheatClient_RemoveNotifyMessageToServer";
    inline constexpr const char* EOS_AntiCheatClient_RemoveNotifyPeerActionRequired = "EOS_AntiCheatClient_RemoveNotifyPeerActionRequired";
    inline constexpr const char* EOS_AntiCheatClient_RemoveNotifyPeerAuthStatusChanged = "EOS_AntiCheatClient_RemoveNotifyPeerAuthStatusChanged";
    inline constexpr const char* EOS_AntiCheatClient_Reserved01 = "EOS_AntiCheatClient_Reserved01";
    inline constexpr const char* EOS_AntiCheatClient_UnprotectMessage = "EOS_AntiCheatClient_UnprotectMessage";
    inline constexpr const char* EOS_AntiCheatClient_UnregisterPeer = "EOS_AntiCheatClient_UnregisterPeer";
    inline constexpr const char* EOS_AntiCheatServer_AddNotifyClientActionRequired = "EOS_AntiCheatServer_AddNotifyClientActionRequired";
    inline constexpr const char* EOS_AntiCheatServer_AddNotifyClientAuthStatusChanged = "EOS_AntiCheatServer_AddNotifyClientAuthStatusChanged";
    inline constexpr const char* EOS_AntiCheatServer_AddNotifyMessageToClient = "EOS_AntiCheatServer_AddNotifyMessageToClient";
    inline constexpr const char* EOS_AntiCheatServer_BeginSession = "EOS_AntiCheatServer_BeginSession";
    inline constexpr const char* EOS_AntiCheatServer_EndSession = "EOS_AntiCheatServer_EndSession";
    inline constexpr const char* EOS_AntiCheatServer_GetProtectMessageOutputLength = "EOS_AntiCheatServer_GetProtectMessageOutputLength";
    inline constexpr const char* EOS_AntiCheatServer_LogEvent = "EOS_AntiCheatServer_LogEvent";
    inline constexpr const char* EOS_AntiCheatServer_LogGameRoundEnd = "EOS_AntiCheatServer_LogGameRoundEnd";
    inline constexpr const char* EOS_AntiCheatServer_LogGameRoundStart = "EOS_AntiCheatServer_LogGameRoundStart";
    inline constexpr const char* EOS_AntiCheatServer_LogPlayerDespawn = "EOS_AntiCheatServer_LogPlayerDespawn";
    inline constexpr const char* EOS_AntiCheatServer_LogPlayerRevive = "EOS_AntiCheatServer_LogPlayerRevive";
    inline constexpr const char* EOS_AntiCheatServer_LogPlayerSpawn = "EOS_AntiCheatServer_LogPlayerSpawn";
    inline constexpr const char* EOS_AntiCheatServer_LogPlayerTakeDamage = "EOS_AntiCheatServer_LogPlayerTakeDamage";
    inline constexpr const char* EOS_AntiCheatServer_LogPlayerTick = "EOS_AntiCheatServer_LogPlayerTick";
    inline constexpr const char* EOS_AntiCheatServer_LogPlayerUseAbility = "EOS_AntiCheatServer_LogPlayerUseAbility";
    inline constexpr const char* EOS_AntiCheatServer_LogPlayerUseWeapon = "EOS_AntiCheatServer_LogPlayerUseWeapon";
    inline constexpr const char* EOS_AntiCheatServer_ProtectMessage = "EOS_AntiCheatServer_ProtectMessage";
    inline constexpr const char* EOS_AntiCheatServer_ReceiveMessageFromClient = "EOS_AntiCheatServer_ReceiveMessageFromClient";
    inline constexpr const char* EOS_AntiCheatServer_RegisterClient = "EOS_AntiCheatServer_RegisterClient";
    inline constexpr const char* EOS_AntiCheatServer_RegisterEvent = "EOS_AntiCheatServer_RegisterEvent";
    inline constexpr const char* EOS_AntiCheatServer_RemoveNotifyClientActionRequired = "EOS_AntiCheatServer_RemoveNotifyClientActionRequired";
    inline constexpr const char* EOS_AntiCheatServer_RemoveNotifyClientAuthStatusChanged = "EOS_AntiCheatServer_RemoveNotifyClientAuthStatusChanged";
    inline constexpr const char* EOS_AntiCheatServer_RemoveNotifyMessageToClient = "EOS_AntiCheatServer_RemoveNotifyMessageToClient";
    inline constexpr const char* EOS_AntiCheatServer_SetClientDetails = "EOS_AntiCheatServer_SetClientDetails";
    inline constexpr const char* EOS_AntiCheatServer_SetClientNetworkState = "EOS_AntiCheatServer_SetClientNetworkState";
    inline constexpr const char* EOS_AntiCheatServer_SetGameSessionId = "EOS_AntiCheatServer_SetGameSessionId";
    inline constexpr const char* EOS_AntiCheatServer_UnprotectMessage = "EOS_AntiCheatServer_UnprotectMessage";
    inline constexpr const char* EOS_AntiCheatServer_UnregisterClient = "EOS_AntiCheatServer_UnregisterClient";
} // namespace anticheat

// ── Auth (19 fonctions) ──────────────────────────────────────────────

namespace auth {
    inline constexpr const char* EOS_Auth_AddNotifyLoginStatusChanged = "EOS_Auth_AddNotifyLoginStatusChanged";
    inline constexpr const char* EOS_Auth_CopyIdToken = "EOS_Auth_CopyIdToken";
    inline constexpr const char* EOS_Auth_CopyUserAuthToken = "EOS_Auth_CopyUserAuthToken";
    inline constexpr const char* EOS_Auth_DeletePersistentAuth = "EOS_Auth_DeletePersistentAuth";
    inline constexpr const char* EOS_Auth_GetLoggedInAccountByIndex = "EOS_Auth_GetLoggedInAccountByIndex";
    inline constexpr const char* EOS_Auth_GetLoggedInAccountsCount = "EOS_Auth_GetLoggedInAccountsCount";
    inline constexpr const char* EOS_Auth_GetLoginStatus = "EOS_Auth_GetLoginStatus";
    inline constexpr const char* EOS_Auth_GetMergedAccountByIndex = "EOS_Auth_GetMergedAccountByIndex";
    inline constexpr const char* EOS_Auth_GetMergedAccountsCount = "EOS_Auth_GetMergedAccountsCount";
    inline constexpr const char* EOS_Auth_GetSelectedAccountId = "EOS_Auth_GetSelectedAccountId";
    inline constexpr const char* EOS_Auth_IdToken_Release = "EOS_Auth_IdToken_Release";
    inline constexpr const char* EOS_Auth_LinkAccount = "EOS_Auth_LinkAccount";
    inline constexpr const char* EOS_Auth_Login = "EOS_Auth_Login";
    inline constexpr const char* EOS_Auth_Logout = "EOS_Auth_Logout";
    inline constexpr const char* EOS_Auth_QueryIdToken = "EOS_Auth_QueryIdToken";
    inline constexpr const char* EOS_Auth_RemoveNotifyLoginStatusChanged = "EOS_Auth_RemoveNotifyLoginStatusChanged";
    inline constexpr const char* EOS_Auth_Token_Release = "EOS_Auth_Token_Release";
    inline constexpr const char* EOS_Auth_VerifyIdToken = "EOS_Auth_VerifyIdToken";
    inline constexpr const char* EOS_Auth_VerifyUserAuth = "EOS_Auth_VerifyUserAuth";
} // namespace auth

// ── Connect (28 fonctions) ───────────────────────────────────────────

namespace connect {
    inline constexpr const char* EOS_Connect_AddNotifyAuthExpiration = "EOS_Connect_AddNotifyAuthExpiration";
    inline constexpr const char* EOS_Connect_AddNotifyLoginStatusChanged = "EOS_Connect_AddNotifyLoginStatusChanged";
    inline constexpr const char* EOS_Connect_CopyIdToken = "EOS_Connect_CopyIdToken";
    inline constexpr const char* EOS_Connect_CopyProductUserExternalAccountByAccountId = "EOS_Connect_CopyProductUserExternalAccountByAccountId";
    inline constexpr const char* EOS_Connect_CopyProductUserExternalAccountByAccountType = "EOS_Connect_CopyProductUserExternalAccountByAccountType";
    inline constexpr const char* EOS_Connect_CopyProductUserExternalAccountByIndex = "EOS_Connect_CopyProductUserExternalAccountByIndex";
    inline constexpr const char* EOS_Connect_CopyProductUserInfo = "EOS_Connect_CopyProductUserInfo";
    inline constexpr const char* EOS_Connect_CreateDeviceId = "EOS_Connect_CreateDeviceId";
    inline constexpr const char* EOS_Connect_CreateUser = "EOS_Connect_CreateUser";
    inline constexpr const char* EOS_Connect_DeleteDeviceId = "EOS_Connect_DeleteDeviceId";
    inline constexpr const char* EOS_Connect_ExternalAccountInfo_Release = "EOS_Connect_ExternalAccountInfo_Release";
    inline constexpr const char* EOS_Connect_GetExternalAccountMapping = "EOS_Connect_GetExternalAccountMapping";
    inline constexpr const char* EOS_Connect_GetLoggedInUserByIndex = "EOS_Connect_GetLoggedInUserByIndex";
    inline constexpr const char* EOS_Connect_GetLoggedInUsersCount = "EOS_Connect_GetLoggedInUsersCount";
    inline constexpr const char* EOS_Connect_GetLoginStatus = "EOS_Connect_GetLoginStatus";
    inline constexpr const char* EOS_Connect_GetProductUserExternalAccountCount = "EOS_Connect_GetProductUserExternalAccountCount";
    inline constexpr const char* EOS_Connect_GetProductUserIdMapping = "EOS_Connect_GetProductUserIdMapping";
    inline constexpr const char* EOS_Connect_IdToken_Release = "EOS_Connect_IdToken_Release";
    inline constexpr const char* EOS_Connect_LinkAccount = "EOS_Connect_LinkAccount";
    inline constexpr const char* EOS_Connect_Login = "EOS_Connect_Login";
    inline constexpr const char* EOS_Connect_Logout = "EOS_Connect_Logout";
    inline constexpr const char* EOS_Connect_QueryExternalAccountMappings = "EOS_Connect_QueryExternalAccountMappings";
    inline constexpr const char* EOS_Connect_QueryProductUserIdMappings = "EOS_Connect_QueryProductUserIdMappings";
    inline constexpr const char* EOS_Connect_RemoveNotifyAuthExpiration = "EOS_Connect_RemoveNotifyAuthExpiration";
    inline constexpr const char* EOS_Connect_RemoveNotifyLoginStatusChanged = "EOS_Connect_RemoveNotifyLoginStatusChanged";
    inline constexpr const char* EOS_Connect_TransferDeviceIdAccount = "EOS_Connect_TransferDeviceIdAccount";
    inline constexpr const char* EOS_Connect_UnlinkAccount = "EOS_Connect_UnlinkAccount";
    inline constexpr const char* EOS_Connect_VerifyIdToken = "EOS_Connect_VerifyIdToken";
} // namespace connect

// ── Core (162 fonctions) ──────────────────────────────────────────────

namespace core {
    inline constexpr const char* EOS_ActiveSession_CopyInfo = "EOS_ActiveSession_CopyInfo";
    inline constexpr const char* EOS_ActiveSession_GetRegisteredPlayerByIndex = "EOS_ActiveSession_GetRegisteredPlayerByIndex";
    inline constexpr const char* EOS_ActiveSession_GetRegisteredPlayerCount = "EOS_ActiveSession_GetRegisteredPlayerCount";
    inline constexpr const char* EOS_ActiveSession_Info_Release = "EOS_ActiveSession_Info_Release";
    inline constexpr const char* EOS_ActiveSession_Release = "EOS_ActiveSession_Release";
    inline constexpr const char* EOS_Audio_CreateNewInputStream = "EOS_Audio_CreateNewInputStream";
    inline constexpr const char* EOS_Audio_CreateNewOutputStream = "EOS_Audio_CreateNewOutputStream";
    inline constexpr const char* EOS_Audio_DestroyInputStream = "EOS_Audio_DestroyInputStream";
    inline constexpr const char* EOS_Audio_DestroyOutputStream = "EOS_Audio_DestroyOutputStream";
    inline constexpr const char* EOS_Audio_EnableCommunicationsModeOutputDevices = "EOS_Audio_EnableCommunicationsModeOutputDevices";
    inline constexpr const char* EOS_Audio_GetInputDeviceInfo = "EOS_Audio_GetInputDeviceInfo";
    inline constexpr const char* EOS_Audio_GetInputStreamInfo = "EOS_Audio_GetInputStreamInfo";
    inline constexpr const char* EOS_Audio_GetOutputDeviceInfo = "EOS_Audio_GetOutputDeviceInfo";
    inline constexpr const char* EOS_Audio_GetOutputStreamInfo = "EOS_Audio_GetOutputStreamInfo";
    inline constexpr const char* EOS_Audio_IsInputStreamDeviceDisconnected = "EOS_Audio_IsInputStreamDeviceDisconnected";
    inline constexpr const char* EOS_Audio_IsInputStreamSilent = "EOS_Audio_IsInputStreamSilent";
    inline constexpr const char* EOS_Audio_QueryInputDevices = "EOS_Audio_QueryInputDevices";
    inline constexpr const char* EOS_Audio_QueryOutputDevices = "EOS_Audio_QueryOutputDevices";
    inline constexpr const char* EOS_Audio_RegisterUser = "EOS_Audio_RegisterUser";
    inline constexpr const char* EOS_Audio_RemoveNotifyDevicesChanged = "EOS_Audio_RemoveNotifyDevicesChanged";
    inline constexpr const char* EOS_Audio_SetFeatureEnabledForInputStream = "EOS_Audio_SetFeatureEnabledForInputStream";
    inline constexpr const char* EOS_Audio_SetNotifyDevicesChanged = "EOS_Audio_SetNotifyDevicesChanged";
    inline constexpr const char* EOS_Audio_StartInputStream = "EOS_Audio_StartInputStream";
    inline constexpr const char* EOS_Audio_StartOutputStream = "EOS_Audio_StartOutputStream";
    inline constexpr const char* EOS_Audio_StopInputStream = "EOS_Audio_StopInputStream";
    inline constexpr const char* EOS_Audio_StopOutputStream = "EOS_Audio_StopOutputStream";
    inline constexpr const char* EOS_Audio_UnregisterUser = "EOS_Audio_UnregisterUser";
    inline constexpr const char* EOS_BeginScopeEvent = "EOS_BeginScopeEvent";
    inline constexpr const char* EOS_BroadcastAudio_CreateNewInputStream = "EOS_BroadcastAudio_CreateNewInputStream";
    inline constexpr const char* EOS_BroadcastAudio_CreateNewOutputStream = "EOS_BroadcastAudio_CreateNewOutputStream";
    inline constexpr const char* EOS_BroadcastAudio_DestroyInputStream = "EOS_BroadcastAudio_DestroyInputStream";
    inline constexpr const char* EOS_BroadcastAudio_DestroyOutputStream = "EOS_BroadcastAudio_DestroyOutputStream";
    inline constexpr const char* EOS_BroadcastAudio_GetCurrentGainLevel = "EOS_BroadcastAudio_GetCurrentGainLevel";
    inline constexpr const char* EOS_BroadcastAudio_GetCurrentMicAmplitude = "EOS_BroadcastAudio_GetCurrentMicAmplitude";
    inline constexpr const char* EOS_BroadcastAudio_GetInputStreamInfo = "EOS_BroadcastAudio_GetInputStreamInfo";
    inline constexpr const char* EOS_BroadcastAudio_GetOutputStreamInfo = "EOS_BroadcastAudio_GetOutputStreamInfo";
    inline constexpr const char* EOS_BroadcastAudio_PushPacketToOutputStream = "EOS_BroadcastAudio_PushPacketToOutputStream";
    inline constexpr const char* EOS_BroadcastAudio_SetEncoderSettings = "EOS_BroadcastAudio_SetEncoderSettings";
    inline constexpr const char* EOS_BroadcastAudio_SetMicProcessingSettings = "EOS_BroadcastAudio_SetMicProcessingSettings";
    inline constexpr const char* EOS_BroadcastAudio_StartInputStream = "EOS_BroadcastAudio_StartInputStream";
    inline constexpr const char* EOS_BroadcastAudio_StartOutputStream = "EOS_BroadcastAudio_StartOutputStream";
    inline constexpr const char* EOS_BroadcastAudio_StopInputStream = "EOS_BroadcastAudio_StopInputStream";
    inline constexpr const char* EOS_BroadcastAudio_StopOutputStream = "EOS_BroadcastAudio_StopOutputStream";
    inline constexpr const char* EOS_ByteArray_ToString = "EOS_ByteArray_ToString";
    inline constexpr const char* EOS_ContinuanceToken_ToString = "EOS_ContinuanceToken_ToString";
    inline constexpr const char* EOS_EApplicationStatus_ToString = "EOS_EApplicationStatus_ToString";
    inline constexpr const char* EOS_ENetworkStatus_ToString = "EOS_ENetworkStatus_ToString";
    inline constexpr const char* EOS_EResult_IsOperationComplete = "EOS_EResult_IsOperationComplete";
    inline constexpr const char* EOS_EResult_ToString = "EOS_EResult_ToString";
    inline constexpr const char* EOS_EndScopeEvent = "EOS_EndScopeEvent";
    inline constexpr const char* EOS_EpicAccountId_FromString = "EOS_EpicAccountId_FromString";
    inline constexpr const char* EOS_EpicAccountId_IsValid = "EOS_EpicAccountId_IsValid";
    inline constexpr const char* EOS_EpicAccountId_ToString = "EOS_EpicAccountId_ToString";
    inline constexpr const char* EOS_GetVersion = "EOS_GetVersion";
    inline constexpr const char* EOS_Initialize = "EOS_Initialize";
    inline constexpr const char* EOS_IntegratedPlatformOptionsContainer_Add = "EOS_IntegratedPlatformOptionsContainer_Add";
    inline constexpr const char* EOS_IntegratedPlatformOptionsContainer_Release = "EOS_IntegratedPlatformOptionsContainer_Release";
    inline constexpr const char* EOS_IntegratedPlatform_AddNotifyUserLoginStatusChanged = "EOS_IntegratedPlatform_AddNotifyUserLoginStatusChanged";
    inline constexpr const char* EOS_IntegratedPlatform_ClearUserPreLogoutCallback = "EOS_IntegratedPlatform_ClearUserPreLogoutCallback";
    inline constexpr const char* EOS_IntegratedPlatform_CreateIntegratedPlatformOptionsContainer = "EOS_IntegratedPlatform_CreateIntegratedPlatformOptionsContainer";
    inline constexpr const char* EOS_IntegratedPlatform_FinalizeDeferredUserLogout = "EOS_IntegratedPlatform_FinalizeDeferredUserLogout";
    inline constexpr const char* EOS_IntegratedPlatform_RemoveNotifyUserLoginStatusChanged = "EOS_IntegratedPlatform_RemoveNotifyUserLoginStatusChanged";
    inline constexpr const char* EOS_IntegratedPlatform_SetUserLoginStatus = "EOS_IntegratedPlatform_SetUserLoginStatus";
    inline constexpr const char* EOS_IntegratedPlatform_SetUserPreLogoutCallback = "EOS_IntegratedPlatform_SetUserPreLogoutCallback";
    inline constexpr const char* EOS_LobbyDetails_CopyAttributeByIndex = "EOS_LobbyDetails_CopyAttributeByIndex";
    inline constexpr const char* EOS_LobbyDetails_CopyAttributeByKey = "EOS_LobbyDetails_CopyAttributeByKey";
    inline constexpr const char* EOS_LobbyDetails_CopyInfo = "EOS_LobbyDetails_CopyInfo";
    inline constexpr const char* EOS_LobbyDetails_CopyMemberAttributeByIndex = "EOS_LobbyDetails_CopyMemberAttributeByIndex";
    inline constexpr const char* EOS_LobbyDetails_CopyMemberAttributeByKey = "EOS_LobbyDetails_CopyMemberAttributeByKey";
    inline constexpr const char* EOS_LobbyDetails_CopyMemberInfo = "EOS_LobbyDetails_CopyMemberInfo";
    inline constexpr const char* EOS_LobbyDetails_GetAttributeCount = "EOS_LobbyDetails_GetAttributeCount";
    inline constexpr const char* EOS_LobbyDetails_GetLobbyOwner = "EOS_LobbyDetails_GetLobbyOwner";
    inline constexpr const char* EOS_LobbyDetails_GetMemberAttributeCount = "EOS_LobbyDetails_GetMemberAttributeCount";
    inline constexpr const char* EOS_LobbyDetails_GetMemberByIndex = "EOS_LobbyDetails_GetMemberByIndex";
    inline constexpr const char* EOS_LobbyDetails_GetMemberCount = "EOS_LobbyDetails_GetMemberCount";
    inline constexpr const char* EOS_LobbyDetails_Info_Release = "EOS_LobbyDetails_Info_Release";
    inline constexpr const char* EOS_LobbyDetails_MemberInfo_Release = "EOS_LobbyDetails_MemberInfo_Release";
    inline constexpr const char* EOS_LobbyDetails_Release = "EOS_LobbyDetails_Release";
    inline constexpr const char* EOS_LobbyModification_AddAttribute = "EOS_LobbyModification_AddAttribute";
    inline constexpr const char* EOS_LobbyModification_AddMemberAttribute = "EOS_LobbyModification_AddMemberAttribute";
    inline constexpr const char* EOS_LobbyModification_Release = "EOS_LobbyModification_Release";
    inline constexpr const char* EOS_LobbyModification_RemoveAttribute = "EOS_LobbyModification_RemoveAttribute";
    inline constexpr const char* EOS_LobbyModification_RemoveMemberAttribute = "EOS_LobbyModification_RemoveMemberAttribute";
    inline constexpr const char* EOS_LobbyModification_SetAllowedPlatformIds = "EOS_LobbyModification_SetAllowedPlatformIds";
    inline constexpr const char* EOS_LobbyModification_SetBucketId = "EOS_LobbyModification_SetBucketId";
    inline constexpr const char* EOS_LobbyModification_SetInvitesAllowed = "EOS_LobbyModification_SetInvitesAllowed";
    inline constexpr const char* EOS_LobbyModification_SetMaxMembers = "EOS_LobbyModification_SetMaxMembers";
    inline constexpr const char* EOS_LobbyModification_SetPermissionLevel = "EOS_LobbyModification_SetPermissionLevel";
    inline constexpr const char* EOS_LobbySearch_CopySearchResultByIndex = "EOS_LobbySearch_CopySearchResultByIndex";
    inline constexpr const char* EOS_LobbySearch_Find = "EOS_LobbySearch_Find";
    inline constexpr const char* EOS_LobbySearch_GetSearchResultCount = "EOS_LobbySearch_GetSearchResultCount";
    inline constexpr const char* EOS_LobbySearch_Release = "EOS_LobbySearch_Release";
    inline constexpr const char* EOS_LobbySearch_RemoveParameter = "EOS_LobbySearch_RemoveParameter";
    inline constexpr const char* EOS_LobbySearch_SetLobbyId = "EOS_LobbySearch_SetLobbyId";
    inline constexpr const char* EOS_LobbySearch_SetMaxResults = "EOS_LobbySearch_SetMaxResults";
    inline constexpr const char* EOS_LobbySearch_SetParameter = "EOS_LobbySearch_SetParameter";
    inline constexpr const char* EOS_LobbySearch_SetTargetUserId = "EOS_LobbySearch_SetTargetUserId";
    inline constexpr const char* EOS_Mercury_Initialize = "EOS_Mercury_Initialize";
    inline constexpr const char* EOS_Mercury_Shutdown = "EOS_Mercury_Shutdown";
    inline constexpr const char* EOS_Mercury_Tick = "EOS_Mercury_Tick";
    inline constexpr const char* EOS_PlayerDataStorageFileTransferRequest_CancelRequest = "EOS_PlayerDataStorageFileTransferRequest_CancelRequest";
    inline constexpr const char* EOS_PlayerDataStorageFileTransferRequest_GetFileRequestState = "EOS_PlayerDataStorageFileTransferRequest_GetFileRequestState";
    inline constexpr const char* EOS_PlayerDataStorageFileTransferRequest_GetFilename = "EOS_PlayerDataStorageFileTransferRequest_GetFilename";
    inline constexpr const char* EOS_PlayerDataStorageFileTransferRequest_Release = "EOS_PlayerDataStorageFileTransferRequest_Release";
    inline constexpr const char* EOS_PresenceModification_DeleteData = "EOS_PresenceModification_DeleteData";
    inline constexpr const char* EOS_PresenceModification_Release = "EOS_PresenceModification_Release";
    inline constexpr const char* EOS_PresenceModification_SetData = "EOS_PresenceModification_SetData";
    inline constexpr const char* EOS_PresenceModification_SetJoinInfo = "EOS_PresenceModification_SetJoinInfo";
    inline constexpr const char* EOS_PresenceModification_SetRawRichText = "EOS_PresenceModification_SetRawRichText";
    inline constexpr const char* EOS_PresenceModification_SetStatus = "EOS_PresenceModification_SetStatus";
    inline constexpr const char* EOS_ProductUserId_FromString = "EOS_ProductUserId_FromString";
    inline constexpr const char* EOS_ProductUserId_IsValid = "EOS_ProductUserId_IsValid";
    inline constexpr const char* EOS_ProductUserId_ToString = "EOS_ProductUserId_ToString";
    inline constexpr const char* EOS_ProgressionSnapshot_AddProgression = "EOS_ProgressionSnapshot_AddProgression";
    inline constexpr const char* EOS_ProgressionSnapshot_BeginSnapshot = "EOS_ProgressionSnapshot_BeginSnapshot";
    inline constexpr const char* EOS_ProgressionSnapshot_DeleteSnapshot = "EOS_ProgressionSnapshot_DeleteSnapshot";
    inline constexpr const char* EOS_ProgressionSnapshot_EndSnapshot = "EOS_ProgressionSnapshot_EndSnapshot";
    inline constexpr const char* EOS_ProgressionSnapshot_SubmitSnapshot = "EOS_ProgressionSnapshot_SubmitSnapshot";
    inline constexpr const char* EOS_RTCAdmin_CopyUserTokenByIndex = "EOS_RTCAdmin_CopyUserTokenByIndex";
    inline constexpr const char* EOS_RTCAdmin_CopyUserTokenByUserId = "EOS_RTCAdmin_CopyUserTokenByUserId";
    inline constexpr const char* EOS_RTCAdmin_Kick = "EOS_RTCAdmin_Kick";
    inline constexpr const char* EOS_RTCAdmin_QueryJoinRoomToken = "EOS_RTCAdmin_QueryJoinRoomToken";
    inline constexpr const char* EOS_RTCAdmin_SetParticipantHardMute = "EOS_RTCAdmin_SetParticipantHardMute";
    inline constexpr const char* EOS_RTCAdmin_UserToken_Release = "EOS_RTCAdmin_UserToken_Release";
    inline constexpr const char* EOS_RTCData_AddNotifyDataReceived = "EOS_RTCData_AddNotifyDataReceived";
    inline constexpr const char* EOS_RTCData_AddNotifyParticipantUpdated = "EOS_RTCData_AddNotifyParticipantUpdated";
    inline constexpr const char* EOS_RTCData_RemoveNotifyDataReceived = "EOS_RTCData_RemoveNotifyDataReceived";
    inline constexpr const char* EOS_RTCData_RemoveNotifyParticipantUpdated = "EOS_RTCData_RemoveNotifyParticipantUpdated";
    inline constexpr const char* EOS_RTCData_SendData = "EOS_RTCData_SendData";
    inline constexpr const char* EOS_RTCData_UpdateReceiving = "EOS_RTCData_UpdateReceiving";
    inline constexpr const char* EOS_RTCData_UpdateSending = "EOS_RTCData_UpdateSending";
    inline constexpr const char* EOS_SessionDetails_Attribute_Release = "EOS_SessionDetails_Attribute_Release";
    inline constexpr const char* EOS_SessionDetails_CopyInfo = "EOS_SessionDetails_CopyInfo";
    inline constexpr const char* EOS_SessionDetails_CopySessionAttributeByIndex = "EOS_SessionDetails_CopySessionAttributeByIndex";
    inline constexpr const char* EOS_SessionDetails_CopySessionAttributeByKey = "EOS_SessionDetails_CopySessionAttributeByKey";
    inline constexpr const char* EOS_SessionDetails_GetSessionAttributeCount = "EOS_SessionDetails_GetSessionAttributeCount";
    inline constexpr const char* EOS_SessionDetails_Info_Release = "EOS_SessionDetails_Info_Release";
    inline constexpr const char* EOS_SessionDetails_Release = "EOS_SessionDetails_Release";
    inline constexpr const char* EOS_SessionModification_AddAttribute = "EOS_SessionModification_AddAttribute";
    inline constexpr const char* EOS_SessionModification_Release = "EOS_SessionModification_Release";
    inline constexpr const char* EOS_SessionModification_RemoveAttribute = "EOS_SessionModification_RemoveAttribute";
    inline constexpr const char* EOS_SessionModification_SetAllowedPlatformIds = "EOS_SessionModification_SetAllowedPlatformIds";
    inline constexpr const char* EOS_SessionModification_SetBucketId = "EOS_SessionModification_SetBucketId";
    inline constexpr const char* EOS_SessionModification_SetHostAddress = "EOS_SessionModification_SetHostAddress";
    inline constexpr const char* EOS_SessionModification_SetInvitesAllowed = "EOS_SessionModification_SetInvitesAllowed";
    inline constexpr const char* EOS_SessionModification_SetJoinInProgressAllowed = "EOS_SessionModification_SetJoinInProgressAllowed";
    inline constexpr const char* EOS_SessionModification_SetMaxPlayers = "EOS_SessionModification_SetMaxPlayers";
    inline constexpr const char* EOS_SessionModification_SetPermissionLevel = "EOS_SessionModification_SetPermissionLevel";
    inline constexpr const char* EOS_SessionSearch_CopySearchResultByIndex = "EOS_SessionSearch_CopySearchResultByIndex";
    inline constexpr const char* EOS_SessionSearch_Find = "EOS_SessionSearch_Find";
    inline constexpr const char* EOS_SessionSearch_GetSearchResultCount = "EOS_SessionSearch_GetSearchResultCount";
    inline constexpr const char* EOS_SessionSearch_Release = "EOS_SessionSearch_Release";
    inline constexpr const char* EOS_SessionSearch_RemoveParameter = "EOS_SessionSearch_RemoveParameter";
    inline constexpr const char* EOS_SessionSearch_SetMaxResults = "EOS_SessionSearch_SetMaxResults";
    inline constexpr const char* EOS_SessionSearch_SetParameter = "EOS_SessionSearch_SetParameter";
    inline constexpr const char* EOS_SessionSearch_SetSessionId = "EOS_SessionSearch_SetSessionId";
    inline constexpr const char* EOS_SessionSearch_SetTargetUserId = "EOS_SessionSearch_SetTargetUserId";
    inline constexpr const char* EOS_Shutdown = "EOS_Shutdown";
    inline constexpr const char* EOS_TitleStorageFileTransferRequest_CancelRequest = "EOS_TitleStorageFileTransferRequest_CancelRequest";
    inline constexpr const char* EOS_TitleStorageFileTransferRequest_GetFileRequestState = "EOS_TitleStorageFileTransferRequest_GetFileRequestState";
    inline constexpr const char* EOS_TitleStorageFileTransferRequest_GetFilename = "EOS_TitleStorageFileTransferRequest_GetFilename";
    inline constexpr const char* EOS_TitleStorageFileTransferRequest_Release = "EOS_TitleStorageFileTransferRequest_Release";
} // namespace core

// ── CustomInvites (22 fonctions) ─────────────────────────────────────

namespace custominvites {
    inline constexpr const char* EOS_CustomInvites_AcceptRequestToJoin = "EOS_CustomInvites_AcceptRequestToJoin";
    inline constexpr const char* EOS_CustomInvites_AddNotifyCustomInviteAccepted = "EOS_CustomInvites_AddNotifyCustomInviteAccepted";
    inline constexpr const char* EOS_CustomInvites_AddNotifyCustomInviteReceived = "EOS_CustomInvites_AddNotifyCustomInviteReceived";
    inline constexpr const char* EOS_CustomInvites_AddNotifyCustomInviteRejected = "EOS_CustomInvites_AddNotifyCustomInviteRejected";
    inline constexpr const char* EOS_CustomInvites_AddNotifyRequestToJoinAccepted = "EOS_CustomInvites_AddNotifyRequestToJoinAccepted";
    inline constexpr const char* EOS_CustomInvites_AddNotifyRequestToJoinReceived = "EOS_CustomInvites_AddNotifyRequestToJoinReceived";
    inline constexpr const char* EOS_CustomInvites_AddNotifyRequestToJoinRejected = "EOS_CustomInvites_AddNotifyRequestToJoinRejected";
    inline constexpr const char* EOS_CustomInvites_AddNotifyRequestToJoinResponseReceived = "EOS_CustomInvites_AddNotifyRequestToJoinResponseReceived";
    inline constexpr const char* EOS_CustomInvites_AddNotifySendCustomNativeInviteRequested = "EOS_CustomInvites_AddNotifySendCustomNativeInviteRequested";
    inline constexpr const char* EOS_CustomInvites_FinalizeInvite = "EOS_CustomInvites_FinalizeInvite";
    inline constexpr const char* EOS_CustomInvites_RejectRequestToJoin = "EOS_CustomInvites_RejectRequestToJoin";
    inline constexpr const char* EOS_CustomInvites_RemoveNotifyCustomInviteAccepted = "EOS_CustomInvites_RemoveNotifyCustomInviteAccepted";
    inline constexpr const char* EOS_CustomInvites_RemoveNotifyCustomInviteReceived = "EOS_CustomInvites_RemoveNotifyCustomInviteReceived";
    inline constexpr const char* EOS_CustomInvites_RemoveNotifyCustomInviteRejected = "EOS_CustomInvites_RemoveNotifyCustomInviteRejected";
    inline constexpr const char* EOS_CustomInvites_RemoveNotifyRequestToJoinAccepted = "EOS_CustomInvites_RemoveNotifyRequestToJoinAccepted";
    inline constexpr const char* EOS_CustomInvites_RemoveNotifyRequestToJoinReceived = "EOS_CustomInvites_RemoveNotifyRequestToJoinReceived";
    inline constexpr const char* EOS_CustomInvites_RemoveNotifyRequestToJoinRejected = "EOS_CustomInvites_RemoveNotifyRequestToJoinRejected";
    inline constexpr const char* EOS_CustomInvites_RemoveNotifyRequestToJoinResponseReceived = "EOS_CustomInvites_RemoveNotifyRequestToJoinResponseReceived";
    inline constexpr const char* EOS_CustomInvites_RemoveNotifySendCustomNativeInviteRequested = "EOS_CustomInvites_RemoveNotifySendCustomNativeInviteRequested";
    inline constexpr const char* EOS_CustomInvites_SendCustomInvite = "EOS_CustomInvites_SendCustomInvite";
    inline constexpr const char* EOS_CustomInvites_SendRequestToJoin = "EOS_CustomInvites_SendRequestToJoin";
    inline constexpr const char* EOS_CustomInvites_SetCustomInvite = "EOS_CustomInvites_SetCustomInvite";
} // namespace custominvites

// ── Ecom (39 fonctions) ──────────────────────────────────────────────

namespace ecom {
    inline constexpr const char* EOS_Ecom_CatalogItem_Release = "EOS_Ecom_CatalogItem_Release";
    inline constexpr const char* EOS_Ecom_CatalogOffer_Release = "EOS_Ecom_CatalogOffer_Release";
    inline constexpr const char* EOS_Ecom_CatalogRelease_Release = "EOS_Ecom_CatalogRelease_Release";
    inline constexpr const char* EOS_Ecom_Checkout = "EOS_Ecom_Checkout";
    inline constexpr const char* EOS_Ecom_CopyEntitlementById = "EOS_Ecom_CopyEntitlementById";
    inline constexpr const char* EOS_Ecom_CopyEntitlementByIndex = "EOS_Ecom_CopyEntitlementByIndex";
    inline constexpr const char* EOS_Ecom_CopyEntitlementByNameAndIndex = "EOS_Ecom_CopyEntitlementByNameAndIndex";
    inline constexpr const char* EOS_Ecom_CopyItemById = "EOS_Ecom_CopyItemById";
    inline constexpr const char* EOS_Ecom_CopyItemImageInfoByIndex = "EOS_Ecom_CopyItemImageInfoByIndex";
    inline constexpr const char* EOS_Ecom_CopyItemReleaseByIndex = "EOS_Ecom_CopyItemReleaseByIndex";
    inline constexpr const char* EOS_Ecom_CopyLastRedeemedEntitlementByIndex = "EOS_Ecom_CopyLastRedeemedEntitlementByIndex";
    inline constexpr const char* EOS_Ecom_CopyOfferById = "EOS_Ecom_CopyOfferById";
    inline constexpr const char* EOS_Ecom_CopyOfferByIndex = "EOS_Ecom_CopyOfferByIndex";
    inline constexpr const char* EOS_Ecom_CopyOfferImageInfoByIndex = "EOS_Ecom_CopyOfferImageInfoByIndex";
    inline constexpr const char* EOS_Ecom_CopyOfferItemByIndex = "EOS_Ecom_CopyOfferItemByIndex";
    inline constexpr const char* EOS_Ecom_CopyTransactionById = "EOS_Ecom_CopyTransactionById";
    inline constexpr const char* EOS_Ecom_CopyTransactionByIndex = "EOS_Ecom_CopyTransactionByIndex";
    inline constexpr const char* EOS_Ecom_Entitlement_Release = "EOS_Ecom_Entitlement_Release";
    inline constexpr const char* EOS_Ecom_GetEntitlementsByNameCount = "EOS_Ecom_GetEntitlementsByNameCount";
    inline constexpr const char* EOS_Ecom_GetEntitlementsCount = "EOS_Ecom_GetEntitlementsCount";
    inline constexpr const char* EOS_Ecom_GetItemImageInfoCount = "EOS_Ecom_GetItemImageInfoCount";
    inline constexpr const char* EOS_Ecom_GetItemReleaseCount = "EOS_Ecom_GetItemReleaseCount";
    inline constexpr const char* EOS_Ecom_GetLastRedeemedEntitlementsCount = "EOS_Ecom_GetLastRedeemedEntitlementsCount";
    inline constexpr const char* EOS_Ecom_GetOfferCount = "EOS_Ecom_GetOfferCount";
    inline constexpr const char* EOS_Ecom_GetOfferImageInfoCount = "EOS_Ecom_GetOfferImageInfoCount";
    inline constexpr const char* EOS_Ecom_GetOfferItemCount = "EOS_Ecom_GetOfferItemCount";
    inline constexpr const char* EOS_Ecom_GetTransactionCount = "EOS_Ecom_GetTransactionCount";
    inline constexpr const char* EOS_Ecom_KeyImageInfo_Release = "EOS_Ecom_KeyImageInfo_Release";
    inline constexpr const char* EOS_Ecom_QueryEntitlementToken = "EOS_Ecom_QueryEntitlementToken";
    inline constexpr const char* EOS_Ecom_QueryEntitlements = "EOS_Ecom_QueryEntitlements";
    inline constexpr const char* EOS_Ecom_QueryOffers = "EOS_Ecom_QueryOffers";
    inline constexpr const char* EOS_Ecom_QueryOwnership = "EOS_Ecom_QueryOwnership";
    inline constexpr const char* EOS_Ecom_QueryOwnershipBySandboxIds = "EOS_Ecom_QueryOwnershipBySandboxIds";
    inline constexpr const char* EOS_Ecom_QueryOwnershipToken = "EOS_Ecom_QueryOwnershipToken";
    inline constexpr const char* EOS_Ecom_RedeemEntitlements = "EOS_Ecom_RedeemEntitlements";
    inline constexpr const char* EOS_Ecom_Transaction_CopyEntitlementByIndex = "EOS_Ecom_Transaction_CopyEntitlementByIndex";
    inline constexpr const char* EOS_Ecom_Transaction_GetEntitlementsCount = "EOS_Ecom_Transaction_GetEntitlementsCount";
    inline constexpr const char* EOS_Ecom_Transaction_GetTransactionId = "EOS_Ecom_Transaction_GetTransactionId";
    inline constexpr const char* EOS_Ecom_Transaction_Release = "EOS_Ecom_Transaction_Release";
} // namespace ecom

// ── Friends (13 fonctions) ───────────────────────────────────────────

namespace friends {
    inline constexpr const char* EOS_Friends_AcceptInvite = "EOS_Friends_AcceptInvite";
    inline constexpr const char* EOS_Friends_AddNotifyBlockedUsersUpdate = "EOS_Friends_AddNotifyBlockedUsersUpdate";
    inline constexpr const char* EOS_Friends_AddNotifyFriendsUpdate = "EOS_Friends_AddNotifyFriendsUpdate";
    inline constexpr const char* EOS_Friends_GetBlockedUserAtIndex = "EOS_Friends_GetBlockedUserAtIndex";
    inline constexpr const char* EOS_Friends_GetBlockedUsersCount = "EOS_Friends_GetBlockedUsersCount";
    inline constexpr const char* EOS_Friends_GetFriendAtIndex = "EOS_Friends_GetFriendAtIndex";
    inline constexpr const char* EOS_Friends_GetFriendsCount = "EOS_Friends_GetFriendsCount";
    inline constexpr const char* EOS_Friends_GetStatus = "EOS_Friends_GetStatus";
    inline constexpr const char* EOS_Friends_QueryFriends = "EOS_Friends_QueryFriends";
    inline constexpr const char* EOS_Friends_RejectInvite = "EOS_Friends_RejectInvite";
    inline constexpr const char* EOS_Friends_RemoveNotifyBlockedUsersUpdate = "EOS_Friends_RemoveNotifyBlockedUsersUpdate";
    inline constexpr const char* EOS_Friends_RemoveNotifyFriendsUpdate = "EOS_Friends_RemoveNotifyFriendsUpdate";
    inline constexpr const char* EOS_Friends_SendInvite = "EOS_Friends_SendInvite";
} // namespace friends

// ── KWS (11 fonctions) ───────────────────────────────────────────────

namespace kws {
    inline constexpr const char* EOS_KWS_AddNotifyPermissionsUpdateReceived = "EOS_KWS_AddNotifyPermissionsUpdateReceived";
    inline constexpr const char* EOS_KWS_CopyPermissionByIndex = "EOS_KWS_CopyPermissionByIndex";
    inline constexpr const char* EOS_KWS_CreateUser = "EOS_KWS_CreateUser";
    inline constexpr const char* EOS_KWS_GetPermissionByKey = "EOS_KWS_GetPermissionByKey";
    inline constexpr const char* EOS_KWS_GetPermissionsCount = "EOS_KWS_GetPermissionsCount";
    inline constexpr const char* EOS_KWS_PermissionStatus_Release = "EOS_KWS_PermissionStatus_Release";
    inline constexpr const char* EOS_KWS_QueryAgeGate = "EOS_KWS_QueryAgeGate";
    inline constexpr const char* EOS_KWS_QueryPermissions = "EOS_KWS_QueryPermissions";
    inline constexpr const char* EOS_KWS_RemoveNotifyPermissionsUpdateReceived = "EOS_KWS_RemoveNotifyPermissionsUpdateReceived";
    inline constexpr const char* EOS_KWS_RequestPermissions = "EOS_KWS_RequestPermissions";
    inline constexpr const char* EOS_KWS_UpdateParentEmail = "EOS_KWS_UpdateParentEmail";
} // namespace kws

// ── Leaderboards (16 fonctions) ──────────────────────────────────────

namespace leaderboards {
    inline constexpr const char* EOS_Leaderboards_CopyLeaderboardDefinitionByIndex = "EOS_Leaderboards_CopyLeaderboardDefinitionByIndex";
    inline constexpr const char* EOS_Leaderboards_CopyLeaderboardDefinitionByLeaderboardId = "EOS_Leaderboards_CopyLeaderboardDefinitionByLeaderboardId";
    inline constexpr const char* EOS_Leaderboards_CopyLeaderboardRecordByIndex = "EOS_Leaderboards_CopyLeaderboardRecordByIndex";
    inline constexpr const char* EOS_Leaderboards_CopyLeaderboardRecordByUserId = "EOS_Leaderboards_CopyLeaderboardRecordByUserId";
    inline constexpr const char* EOS_Leaderboards_CopyLeaderboardUserScoreByIndex = "EOS_Leaderboards_CopyLeaderboardUserScoreByIndex";
    inline constexpr const char* EOS_Leaderboards_CopyLeaderboardUserScoreByUserId = "EOS_Leaderboards_CopyLeaderboardUserScoreByUserId";
    inline constexpr const char* EOS_Leaderboards_Definition_Release = "EOS_Leaderboards_Definition_Release";
    inline constexpr const char* EOS_Leaderboards_GetLeaderboardDefinitionCount = "EOS_Leaderboards_GetLeaderboardDefinitionCount";
    inline constexpr const char* EOS_Leaderboards_GetLeaderboardRecordCount = "EOS_Leaderboards_GetLeaderboardRecordCount";
    inline constexpr const char* EOS_Leaderboards_GetLeaderboardUserScoreCount = "EOS_Leaderboards_GetLeaderboardUserScoreCount";
    inline constexpr const char* EOS_Leaderboards_LeaderboardDefinition_Release = "EOS_Leaderboards_LeaderboardDefinition_Release";
    inline constexpr const char* EOS_Leaderboards_LeaderboardRecord_Release = "EOS_Leaderboards_LeaderboardRecord_Release";
    inline constexpr const char* EOS_Leaderboards_LeaderboardUserScore_Release = "EOS_Leaderboards_LeaderboardUserScore_Release";
    inline constexpr const char* EOS_Leaderboards_QueryLeaderboardDefinitions = "EOS_Leaderboards_QueryLeaderboardDefinitions";
    inline constexpr const char* EOS_Leaderboards_QueryLeaderboardRanks = "EOS_Leaderboards_QueryLeaderboardRanks";
    inline constexpr const char* EOS_Leaderboards_QueryLeaderboardUserScores = "EOS_Leaderboards_QueryLeaderboardUserScores";
} // namespace leaderboards

// ── Lobby (46 fonctions) ─────────────────────────────────────────────

namespace lobby {
    inline constexpr const char* EOS_Lobby_AddNotifyJoinLobbyAccepted = "EOS_Lobby_AddNotifyJoinLobbyAccepted";
    inline constexpr const char* EOS_Lobby_AddNotifyLeaveLobbyRequested = "EOS_Lobby_AddNotifyLeaveLobbyRequested";
    inline constexpr const char* EOS_Lobby_AddNotifyLobbyInviteAccepted = "EOS_Lobby_AddNotifyLobbyInviteAccepted";
    inline constexpr const char* EOS_Lobby_AddNotifyLobbyInviteReceived = "EOS_Lobby_AddNotifyLobbyInviteReceived";
    inline constexpr const char* EOS_Lobby_AddNotifyLobbyInviteRejected = "EOS_Lobby_AddNotifyLobbyInviteRejected";
    inline constexpr const char* EOS_Lobby_AddNotifyLobbyMemberStatusReceived = "EOS_Lobby_AddNotifyLobbyMemberStatusReceived";
    inline constexpr const char* EOS_Lobby_AddNotifyLobbyMemberUpdateReceived = "EOS_Lobby_AddNotifyLobbyMemberUpdateReceived";
    inline constexpr const char* EOS_Lobby_AddNotifyLobbyUpdateReceived = "EOS_Lobby_AddNotifyLobbyUpdateReceived";
    inline constexpr const char* EOS_Lobby_AddNotifyRTCRoomConnectionChanged = "EOS_Lobby_AddNotifyRTCRoomConnectionChanged";
    inline constexpr const char* EOS_Lobby_AddNotifySendLobbyNativeInviteRequested = "EOS_Lobby_AddNotifySendLobbyNativeInviteRequested";
    inline constexpr const char* EOS_Lobby_Attribute_Release = "EOS_Lobby_Attribute_Release";
    inline constexpr const char* EOS_Lobby_CopyLobbyDetailsHandle = "EOS_Lobby_CopyLobbyDetailsHandle";
    inline constexpr const char* EOS_Lobby_CopyLobbyDetailsHandleByInviteId = "EOS_Lobby_CopyLobbyDetailsHandleByInviteId";
    inline constexpr const char* EOS_Lobby_CopyLobbyDetailsHandleByUiEventId = "EOS_Lobby_CopyLobbyDetailsHandleByUiEventId";
    inline constexpr const char* EOS_Lobby_CreateLobby = "EOS_Lobby_CreateLobby";
    inline constexpr const char* EOS_Lobby_CreateLobbySearch = "EOS_Lobby_CreateLobbySearch";
    inline constexpr const char* EOS_Lobby_DestroyLobby = "EOS_Lobby_DestroyLobby";
    inline constexpr const char* EOS_Lobby_GetConnectString = "EOS_Lobby_GetConnectString";
    inline constexpr const char* EOS_Lobby_GetInviteCount = "EOS_Lobby_GetInviteCount";
    inline constexpr const char* EOS_Lobby_GetInviteIdByIndex = "EOS_Lobby_GetInviteIdByIndex";
    inline constexpr const char* EOS_Lobby_GetRTCRoomName = "EOS_Lobby_GetRTCRoomName";
    inline constexpr const char* EOS_Lobby_HardMuteMember = "EOS_Lobby_HardMuteMember";
    inline constexpr const char* EOS_Lobby_IsRTCRoomConnected = "EOS_Lobby_IsRTCRoomConnected";
    inline constexpr const char* EOS_Lobby_JoinLobby = "EOS_Lobby_JoinLobby";
    inline constexpr const char* EOS_Lobby_JoinLobbyById = "EOS_Lobby_JoinLobbyById";
    inline constexpr const char* EOS_Lobby_JoinRTCRoom = "EOS_Lobby_JoinRTCRoom";
    inline constexpr const char* EOS_Lobby_KickMember = "EOS_Lobby_KickMember";
    inline constexpr const char* EOS_Lobby_LeaveLobby = "EOS_Lobby_LeaveLobby";
    inline constexpr const char* EOS_Lobby_LeaveRTCRoom = "EOS_Lobby_LeaveRTCRoom";
    inline constexpr const char* EOS_Lobby_ParseConnectString = "EOS_Lobby_ParseConnectString";
    inline constexpr const char* EOS_Lobby_PromoteMember = "EOS_Lobby_PromoteMember";
    inline constexpr const char* EOS_Lobby_QueryInvites = "EOS_Lobby_QueryInvites";
    inline constexpr const char* EOS_Lobby_RejectInvite = "EOS_Lobby_RejectInvite";
    inline constexpr const char* EOS_Lobby_RemoveNotifyJoinLobbyAccepted = "EOS_Lobby_RemoveNotifyJoinLobbyAccepted";
    inline constexpr const char* EOS_Lobby_RemoveNotifyLeaveLobbyRequested = "EOS_Lobby_RemoveNotifyLeaveLobbyRequested";
    inline constexpr const char* EOS_Lobby_RemoveNotifyLobbyInviteAccepted = "EOS_Lobby_RemoveNotifyLobbyInviteAccepted";
    inline constexpr const char* EOS_Lobby_RemoveNotifyLobbyInviteReceived = "EOS_Lobby_RemoveNotifyLobbyInviteReceived";
    inline constexpr const char* EOS_Lobby_RemoveNotifyLobbyInviteRejected = "EOS_Lobby_RemoveNotifyLobbyInviteRejected";
    inline constexpr const char* EOS_Lobby_RemoveNotifyLobbyMemberStatusReceived = "EOS_Lobby_RemoveNotifyLobbyMemberStatusReceived";
    inline constexpr const char* EOS_Lobby_RemoveNotifyLobbyMemberUpdateReceived = "EOS_Lobby_RemoveNotifyLobbyMemberUpdateReceived";
    inline constexpr const char* EOS_Lobby_RemoveNotifyLobbyUpdateReceived = "EOS_Lobby_RemoveNotifyLobbyUpdateReceived";
    inline constexpr const char* EOS_Lobby_RemoveNotifyRTCRoomConnectionChanged = "EOS_Lobby_RemoveNotifyRTCRoomConnectionChanged";
    inline constexpr const char* EOS_Lobby_RemoveNotifySendLobbyNativeInviteRequested = "EOS_Lobby_RemoveNotifySendLobbyNativeInviteRequested";
    inline constexpr const char* EOS_Lobby_SendInvite = "EOS_Lobby_SendInvite";
    inline constexpr const char* EOS_Lobby_UpdateLobby = "EOS_Lobby_UpdateLobby";
    inline constexpr const char* EOS_Lobby_UpdateLobbyModification = "EOS_Lobby_UpdateLobbyModification";
} // namespace lobby

// ── Logging (2 fonctions) ───────────────────────────────────────────

namespace logging {
    inline constexpr const char* EOS_Logging_SetCallback = "EOS_Logging_SetCallback";
    inline constexpr const char* EOS_Logging_SetLogLevel = "EOS_Logging_SetLogLevel";
} // namespace logging

// ── Metrics (2 fonctions) ───────────────────────────────────────────

namespace metrics {
    inline constexpr const char* EOS_Metrics_BeginPlayerSession = "EOS_Metrics_BeginPlayerSession";
    inline constexpr const char* EOS_Metrics_EndPlayerSession = "EOS_Metrics_EndPlayerSession";
} // namespace metrics

// ── Mods (6 fonctions) ──────────────────────────────────────────────

namespace mods {
    inline constexpr const char* EOS_Mods_CopyModInfo = "EOS_Mods_CopyModInfo";
    inline constexpr const char* EOS_Mods_EnumerateMods = "EOS_Mods_EnumerateMods";
    inline constexpr const char* EOS_Mods_InstallMod = "EOS_Mods_InstallMod";
    inline constexpr const char* EOS_Mods_ModInfo_Release = "EOS_Mods_ModInfo_Release";
    inline constexpr const char* EOS_Mods_UninstallMod = "EOS_Mods_UninstallMod";
    inline constexpr const char* EOS_Mods_UpdateMod = "EOS_Mods_UpdateMod";
} // namespace mods

// ── P2P (25 fonctions) ───────────────────────────────────────────────

namespace p2p {
    inline constexpr const char* EOS_P2P_AcceptConnection = "EOS_P2P_AcceptConnection";
    inline constexpr const char* EOS_P2P_AddNotifyIncomingPacketQueueFull = "EOS_P2P_AddNotifyIncomingPacketQueueFull";
    inline constexpr const char* EOS_P2P_AddNotifyPeerConnectionClosed = "EOS_P2P_AddNotifyPeerConnectionClosed";
    inline constexpr const char* EOS_P2P_AddNotifyPeerConnectionEstablished = "EOS_P2P_AddNotifyPeerConnectionEstablished";
    inline constexpr const char* EOS_P2P_AddNotifyPeerConnectionInterrupted = "EOS_P2P_AddNotifyPeerConnectionInterrupted";
    inline constexpr const char* EOS_P2P_AddNotifyPeerConnectionRequest = "EOS_P2P_AddNotifyPeerConnectionRequest";
    inline constexpr const char* EOS_P2P_ClearPacketQueue = "EOS_P2P_ClearPacketQueue";
    inline constexpr const char* EOS_P2P_CloseConnection = "EOS_P2P_CloseConnection";
    inline constexpr const char* EOS_P2P_CloseConnections = "EOS_P2P_CloseConnections";
    inline constexpr const char* EOS_P2P_GetNATType = "EOS_P2P_GetNATType";
    inline constexpr const char* EOS_P2P_GetNextReceivedPacketSize = "EOS_P2P_GetNextReceivedPacketSize";
    inline constexpr const char* EOS_P2P_GetPacketQueueInfo = "EOS_P2P_GetPacketQueueInfo";
    inline constexpr const char* EOS_P2P_GetPortRange = "EOS_P2P_GetPortRange";
    inline constexpr const char* EOS_P2P_GetRelayControl = "EOS_P2P_GetRelayControl";
    inline constexpr const char* EOS_P2P_QueryNATType = "EOS_P2P_QueryNATType";
    inline constexpr const char* EOS_P2P_ReceivePacket = "EOS_P2P_ReceivePacket";
    inline constexpr const char* EOS_P2P_RemoveNotifyIncomingPacketQueueFull = "EOS_P2P_RemoveNotifyIncomingPacketQueueFull";
    inline constexpr const char* EOS_P2P_RemoveNotifyPeerConnectionClosed = "EOS_P2P_RemoveNotifyPeerConnectionClosed";
    inline constexpr const char* EOS_P2P_RemoveNotifyPeerConnectionEstablished = "EOS_P2P_RemoveNotifyPeerConnectionEstablished";
    inline constexpr const char* EOS_P2P_RemoveNotifyPeerConnectionInterrupted = "EOS_P2P_RemoveNotifyPeerConnectionInterrupted";
    inline constexpr const char* EOS_P2P_RemoveNotifyPeerConnectionRequest = "EOS_P2P_RemoveNotifyPeerConnectionRequest";
    inline constexpr const char* EOS_P2P_SendPacket = "EOS_P2P_SendPacket";
    inline constexpr const char* EOS_P2P_SetPacketQueueSize = "EOS_P2P_SetPacketQueueSize";
    inline constexpr const char* EOS_P2P_SetPortRange = "EOS_P2P_SetPortRange";
    inline constexpr const char* EOS_P2P_SetRelayControl = "EOS_P2P_SetRelayControl";
} // namespace p2p

// ── Platform (42 fonctions) ──────────────────────────────────────────

namespace platform {
    inline constexpr const char* EOS_Platform_CheckForLauncherAndRestart = "EOS_Platform_CheckForLauncherAndRestart";
    inline constexpr const char* EOS_Platform_Create = "EOS_Platform_Create";
    inline constexpr const char* EOS_Platform_GetAchievementsInterface = "EOS_Platform_GetAchievementsInterface";
    inline constexpr const char* EOS_Platform_GetActiveCountryCode = "EOS_Platform_GetActiveCountryCode";
    inline constexpr const char* EOS_Platform_GetActiveLocaleCode = "EOS_Platform_GetActiveLocaleCode";
    inline constexpr const char* EOS_Platform_GetAntiCheatClientInterface = "EOS_Platform_GetAntiCheatClientInterface";
    inline constexpr const char* EOS_Platform_GetAntiCheatServerInterface = "EOS_Platform_GetAntiCheatServerInterface";
    inline constexpr const char* EOS_Platform_GetApplicationStatus = "EOS_Platform_GetApplicationStatus";
    inline constexpr const char* EOS_Platform_GetAuthInterface = "EOS_Platform_GetAuthInterface";
    inline constexpr const char* EOS_Platform_GetConnectInterface = "EOS_Platform_GetConnectInterface";
    inline constexpr const char* EOS_Platform_GetCustomInvitesInterface = "EOS_Platform_GetCustomInvitesInterface";
    inline constexpr const char* EOS_Platform_GetDesktopCrossplayStatus = "EOS_Platform_GetDesktopCrossplayStatus";
    inline constexpr const char* EOS_Platform_GetEcomInterface = "EOS_Platform_GetEcomInterface";
    inline constexpr const char* EOS_Platform_GetFriendsInterface = "EOS_Platform_GetFriendsInterface";
    inline constexpr const char* EOS_Platform_GetIntegratedPlatformInterface = "EOS_Platform_GetIntegratedPlatformInterface";
    inline constexpr const char* EOS_Platform_GetKWSInterface = "EOS_Platform_GetKWSInterface";
    inline constexpr const char* EOS_Platform_GetLeaderboardsInterface = "EOS_Platform_GetLeaderboardsInterface";
    inline constexpr const char* EOS_Platform_GetLobbyInterface = "EOS_Platform_GetLobbyInterface";
    inline constexpr const char* EOS_Platform_GetMetricsInterface = "EOS_Platform_GetMetricsInterface";
    inline constexpr const char* EOS_Platform_GetModsInterface = "EOS_Platform_GetModsInterface";
    inline constexpr const char* EOS_Platform_GetNetworkStatus = "EOS_Platform_GetNetworkStatus";
    inline constexpr const char* EOS_Platform_GetOverrideCountryCode = "EOS_Platform_GetOverrideCountryCode";
    inline constexpr const char* EOS_Platform_GetOverrideLocaleCode = "EOS_Platform_GetOverrideLocaleCode";
    inline constexpr const char* EOS_Platform_GetP2PInterface = "EOS_Platform_GetP2PInterface";
    inline constexpr const char* EOS_Platform_GetPlayerDataStorageInterface = "EOS_Platform_GetPlayerDataStorageInterface";
    inline constexpr const char* EOS_Platform_GetPresenceInterface = "EOS_Platform_GetPresenceInterface";
    inline constexpr const char* EOS_Platform_GetProgressionSnapshotInterface = "EOS_Platform_GetProgressionSnapshotInterface";
    inline constexpr const char* EOS_Platform_GetRTCAdminInterface = "EOS_Platform_GetRTCAdminInterface";
    inline constexpr const char* EOS_Platform_GetRTCInterface = "EOS_Platform_GetRTCInterface";
    inline constexpr const char* EOS_Platform_GetReportsInterface = "EOS_Platform_GetReportsInterface";
    inline constexpr const char* EOS_Platform_GetSanctionsInterface = "EOS_Platform_GetSanctionsInterface";
    inline constexpr const char* EOS_Platform_GetSessionsInterface = "EOS_Platform_GetSessionsInterface";
    inline constexpr const char* EOS_Platform_GetStatsInterface = "EOS_Platform_GetStatsInterface";
    inline constexpr const char* EOS_Platform_GetTitleStorageInterface = "EOS_Platform_GetTitleStorageInterface";
    inline constexpr const char* EOS_Platform_GetUIInterface = "EOS_Platform_GetUIInterface";
    inline constexpr const char* EOS_Platform_GetUserInfoInterface = "EOS_Platform_GetUserInfoInterface";
    inline constexpr const char* EOS_Platform_Release = "EOS_Platform_Release";
    inline constexpr const char* EOS_Platform_SetApplicationStatus = "EOS_Platform_SetApplicationStatus";
    inline constexpr const char* EOS_Platform_SetNetworkStatus = "EOS_Platform_SetNetworkStatus";
    inline constexpr const char* EOS_Platform_SetOverrideCountryCode = "EOS_Platform_SetOverrideCountryCode";
    inline constexpr const char* EOS_Platform_SetOverrideLocaleCode = "EOS_Platform_SetOverrideLocaleCode";
    inline constexpr const char* EOS_Platform_Tick = "EOS_Platform_Tick";
} // namespace platform

// ── PlayerDataStorage (11 fonctions) ─────────────────────────────────

namespace playerdatastorage {
    inline constexpr const char* EOS_PlayerDataStorage_CopyFileMetadataAtIndex = "EOS_PlayerDataStorage_CopyFileMetadataAtIndex";
    inline constexpr const char* EOS_PlayerDataStorage_CopyFileMetadataByFilename = "EOS_PlayerDataStorage_CopyFileMetadataByFilename";
    inline constexpr const char* EOS_PlayerDataStorage_DeleteCache = "EOS_PlayerDataStorage_DeleteCache";
    inline constexpr const char* EOS_PlayerDataStorage_DeleteFile = "EOS_PlayerDataStorage_DeleteFile";
    inline constexpr const char* EOS_PlayerDataStorage_DuplicateFile = "EOS_PlayerDataStorage_DuplicateFile";
    inline constexpr const char* EOS_PlayerDataStorage_FileMetadata_Release = "EOS_PlayerDataStorage_FileMetadata_Release";
    inline constexpr const char* EOS_PlayerDataStorage_GetFileMetadataCount = "EOS_PlayerDataStorage_GetFileMetadataCount";
    inline constexpr const char* EOS_PlayerDataStorage_QueryFile = "EOS_PlayerDataStorage_QueryFile";
    inline constexpr const char* EOS_PlayerDataStorage_QueryFileList = "EOS_PlayerDataStorage_QueryFileList";
    inline constexpr const char* EOS_PlayerDataStorage_ReadFile = "EOS_PlayerDataStorage_ReadFile";
    inline constexpr const char* EOS_PlayerDataStorage_WriteFile = "EOS_PlayerDataStorage_WriteFile";
} // namespace playerdatastorage

// ── Presence (11 fonctions) ──────────────────────────────────────────

namespace presence {
    inline constexpr const char* EOS_Presence_AddNotifyJoinGameAccepted = "EOS_Presence_AddNotifyJoinGameAccepted";
    inline constexpr const char* EOS_Presence_AddNotifyOnPresenceChanged = "EOS_Presence_AddNotifyOnPresenceChanged";
    inline constexpr const char* EOS_Presence_CopyPresence = "EOS_Presence_CopyPresence";
    inline constexpr const char* EOS_Presence_CreatePresenceModification = "EOS_Presence_CreatePresenceModification";
    inline constexpr const char* EOS_Presence_GetJoinInfo = "EOS_Presence_GetJoinInfo";
    inline constexpr const char* EOS_Presence_HasPresence = "EOS_Presence_HasPresence";
    inline constexpr const char* EOS_Presence_Info_Release = "EOS_Presence_Info_Release";
    inline constexpr const char* EOS_Presence_QueryPresence = "EOS_Presence_QueryPresence";
    inline constexpr const char* EOS_Presence_RemoveNotifyJoinGameAccepted = "EOS_Presence_RemoveNotifyJoinGameAccepted";
    inline constexpr const char* EOS_Presence_RemoveNotifyOnPresenceChanged = "EOS_Presence_RemoveNotifyOnPresenceChanged";
    inline constexpr const char* EOS_Presence_SetPresence = "EOS_Presence_SetPresence";
} // namespace presence

// ── RTC (13 fonctions) ───────────────────────────────────────────────

namespace rtc {
    inline constexpr const char* EOS_RTC_AddNotifyDisconnected = "EOS_RTC_AddNotifyDisconnected";
    inline constexpr const char* EOS_RTC_AddNotifyParticipantStatusChanged = "EOS_RTC_AddNotifyParticipantStatusChanged";
    inline constexpr const char* EOS_RTC_AddNotifyRoomStatisticsUpdated = "EOS_RTC_AddNotifyRoomStatisticsUpdated";
    inline constexpr const char* EOS_RTC_BlockParticipant = "EOS_RTC_BlockParticipant";
    inline constexpr const char* EOS_RTC_GetAudioInterface = "EOS_RTC_GetAudioInterface";
    inline constexpr const char* EOS_RTC_GetDataInterface = "EOS_RTC_GetDataInterface";
    inline constexpr const char* EOS_RTC_JoinRoom = "EOS_RTC_JoinRoom";
    inline constexpr const char* EOS_RTC_LeaveRoom = "EOS_RTC_LeaveRoom";
    inline constexpr const char* EOS_RTC_RemoveNotifyDisconnected = "EOS_RTC_RemoveNotifyDisconnected";
    inline constexpr const char* EOS_RTC_RemoveNotifyParticipantStatusChanged = "EOS_RTC_RemoveNotifyParticipantStatusChanged";
    inline constexpr const char* EOS_RTC_RemoveNotifyRoomStatisticsUpdated = "EOS_RTC_RemoveNotifyRoomStatisticsUpdated";
    inline constexpr const char* EOS_RTC_SetRoomSetting = "EOS_RTC_SetRoomSetting";
    inline constexpr const char* EOS_RTC_SetSetting = "EOS_RTC_SetSetting";
} // namespace rtc

// ── RTCAudio (38 fonctions) ──────────────────────────────────────────

namespace rtcaudio {
    inline constexpr const char* EOS_RTCAudio_AddNotifyAudioBeforeRender = "EOS_RTCAudio_AddNotifyAudioBeforeRender";
    inline constexpr const char* EOS_RTCAudio_AddNotifyAudioBeforeSend = "EOS_RTCAudio_AddNotifyAudioBeforeSend";
    inline constexpr const char* EOS_RTCAudio_AddNotifyAudioDevicesChanged = "EOS_RTCAudio_AddNotifyAudioDevicesChanged";
    inline constexpr const char* EOS_RTCAudio_AddNotifyAudioInputState = "EOS_RTCAudio_AddNotifyAudioInputState";
    inline constexpr const char* EOS_RTCAudio_AddNotifyAudioOutputState = "EOS_RTCAudio_AddNotifyAudioOutputState";
    inline constexpr const char* EOS_RTCAudio_AddNotifyParticipantUpdated = "EOS_RTCAudio_AddNotifyParticipantUpdated";
    inline constexpr const char* EOS_RTCAudio_CopyInputDeviceInformationByIndex = "EOS_RTCAudio_CopyInputDeviceInformationByIndex";
    inline constexpr const char* EOS_RTCAudio_CopyOutputDeviceInformationByIndex = "EOS_RTCAudio_CopyOutputDeviceInformationByIndex";
    inline constexpr const char* EOS_RTCAudio_GetAudioInputDeviceByIndex = "EOS_RTCAudio_GetAudioInputDeviceByIndex";
    inline constexpr const char* EOS_RTCAudio_GetAudioInputDevicesCount = "EOS_RTCAudio_GetAudioInputDevicesCount";
    inline constexpr const char* EOS_RTCAudio_GetAudioOutputDeviceByIndex = "EOS_RTCAudio_GetAudioOutputDeviceByIndex";
    inline constexpr const char* EOS_RTCAudio_GetAudioOutputDevicesCount = "EOS_RTCAudio_GetAudioOutputDevicesCount";
    inline constexpr const char* EOS_RTCAudio_GetInputDevicesCount = "EOS_RTCAudio_GetInputDevicesCount";
    inline constexpr const char* EOS_RTCAudio_GetOutputDevicesCount = "EOS_RTCAudio_GetOutputDevicesCount";
    inline constexpr const char* EOS_RTCAudio_InputDeviceInformation_Release = "EOS_RTCAudio_InputDeviceInformation_Release";
    inline constexpr const char* EOS_RTCAudio_OutputDeviceInformation_Release = "EOS_RTCAudio_OutputDeviceInformation_Release";
    inline constexpr const char* EOS_RTCAudio_QueryInputDevicesInformation = "EOS_RTCAudio_QueryInputDevicesInformation";
    inline constexpr const char* EOS_RTCAudio_QueryOutputDevicesInformation = "EOS_RTCAudio_QueryOutputDevicesInformation";
    inline constexpr const char* EOS_RTCAudio_RegisterPlatformAudioUser = "EOS_RTCAudio_RegisterPlatformAudioUser";
    inline constexpr const char* EOS_RTCAudio_RegisterPlatformUser = "EOS_RTCAudio_RegisterPlatformUser";
    inline constexpr const char* EOS_RTCAudio_RemoveNotifyAudioBeforeRender = "EOS_RTCAudio_RemoveNotifyAudioBeforeRender";
    inline constexpr const char* EOS_RTCAudio_RemoveNotifyAudioBeforeSend = "EOS_RTCAudio_RemoveNotifyAudioBeforeSend";
    inline constexpr const char* EOS_RTCAudio_RemoveNotifyAudioDevicesChanged = "EOS_RTCAudio_RemoveNotifyAudioDevicesChanged";
    inline constexpr const char* EOS_RTCAudio_RemoveNotifyAudioInputState = "EOS_RTCAudio_RemoveNotifyAudioInputState";
    inline constexpr const char* EOS_RTCAudio_RemoveNotifyAudioOutputState = "EOS_RTCAudio_RemoveNotifyAudioOutputState";
    inline constexpr const char* EOS_RTCAudio_RemoveNotifyParticipantUpdated = "EOS_RTCAudio_RemoveNotifyParticipantUpdated";
    inline constexpr const char* EOS_RTCAudio_SendAudio = "EOS_RTCAudio_SendAudio";
    inline constexpr const char* EOS_RTCAudio_SetAudioInputSettings = "EOS_RTCAudio_SetAudioInputSettings";
    inline constexpr const char* EOS_RTCAudio_SetAudioOutputSettings = "EOS_RTCAudio_SetAudioOutputSettings";
    inline constexpr const char* EOS_RTCAudio_SetInputDeviceSettings = "EOS_RTCAudio_SetInputDeviceSettings";
    inline constexpr const char* EOS_RTCAudio_SetOutputDeviceSettings = "EOS_RTCAudio_SetOutputDeviceSettings";
    inline constexpr const char* EOS_RTCAudio_UnregisterPlatformAudioUser = "EOS_RTCAudio_UnregisterPlatformAudioUser";
    inline constexpr const char* EOS_RTCAudio_UnregisterPlatformUser = "EOS_RTCAudio_UnregisterPlatformUser";
    inline constexpr const char* EOS_RTCAudio_UpdateParticipantVolume = "EOS_RTCAudio_UpdateParticipantVolume";
    inline constexpr const char* EOS_RTCAudio_UpdateReceiving = "EOS_RTCAudio_UpdateReceiving";
    inline constexpr const char* EOS_RTCAudio_UpdateReceivingVolume = "EOS_RTCAudio_UpdateReceivingVolume";
    inline constexpr const char* EOS_RTCAudio_UpdateSending = "EOS_RTCAudio_UpdateSending";
    inline constexpr const char* EOS_RTCAudio_UpdateSendingVolume = "EOS_RTCAudio_UpdateSendingVolume";
} // namespace rtcaudio

// ── Reports (1 fonctions) ───────────────────────────────────────────

namespace reports {
    inline constexpr const char* EOS_Reports_SendPlayerBehaviorReport = "EOS_Reports_SendPlayerBehaviorReport";
} // namespace reports

// ── Sanctions (5 fonctions) ─────────────────────────────────────────

namespace sanctions {
    inline constexpr const char* EOS_Sanctions_CopyPlayerSanctionByIndex = "EOS_Sanctions_CopyPlayerSanctionByIndex";
    inline constexpr const char* EOS_Sanctions_CreatePlayerSanctionAppeal = "EOS_Sanctions_CreatePlayerSanctionAppeal";
    inline constexpr const char* EOS_Sanctions_GetPlayerSanctionCount = "EOS_Sanctions_GetPlayerSanctionCount";
    inline constexpr const char* EOS_Sanctions_PlayerSanction_Release = "EOS_Sanctions_PlayerSanction_Release";
    inline constexpr const char* EOS_Sanctions_QueryActivePlayerSanctions = "EOS_Sanctions_QueryActivePlayerSanctions";
} // namespace sanctions

// ── Sessions (33 fonctions) ──────────────────────────────────────────

namespace sessions {
    inline constexpr const char* EOS_Sessions_AddNotifyJoinSessionAccepted = "EOS_Sessions_AddNotifyJoinSessionAccepted";
    inline constexpr const char* EOS_Sessions_AddNotifyLeaveSessionRequested = "EOS_Sessions_AddNotifyLeaveSessionRequested";
    inline constexpr const char* EOS_Sessions_AddNotifySendSessionNativeInviteRequested = "EOS_Sessions_AddNotifySendSessionNativeInviteRequested";
    inline constexpr const char* EOS_Sessions_AddNotifySessionInviteAccepted = "EOS_Sessions_AddNotifySessionInviteAccepted";
    inline constexpr const char* EOS_Sessions_AddNotifySessionInviteReceived = "EOS_Sessions_AddNotifySessionInviteReceived";
    inline constexpr const char* EOS_Sessions_AddNotifySessionInviteRejected = "EOS_Sessions_AddNotifySessionInviteRejected";
    inline constexpr const char* EOS_Sessions_CopyActiveSessionHandle = "EOS_Sessions_CopyActiveSessionHandle";
    inline constexpr const char* EOS_Sessions_CopySessionHandleByInviteId = "EOS_Sessions_CopySessionHandleByInviteId";
    inline constexpr const char* EOS_Sessions_CopySessionHandleByUiEventId = "EOS_Sessions_CopySessionHandleByUiEventId";
    inline constexpr const char* EOS_Sessions_CopySessionHandleForPresence = "EOS_Sessions_CopySessionHandleForPresence";
    inline constexpr const char* EOS_Sessions_CreateSessionModification = "EOS_Sessions_CreateSessionModification";
    inline constexpr const char* EOS_Sessions_CreateSessionSearch = "EOS_Sessions_CreateSessionSearch";
    inline constexpr const char* EOS_Sessions_DestroySession = "EOS_Sessions_DestroySession";
    inline constexpr const char* EOS_Sessions_DumpSessionState = "EOS_Sessions_DumpSessionState";
    inline constexpr const char* EOS_Sessions_EndSession = "EOS_Sessions_EndSession";
    inline constexpr const char* EOS_Sessions_GetInviteCount = "EOS_Sessions_GetInviteCount";
    inline constexpr const char* EOS_Sessions_GetInviteIdByIndex = "EOS_Sessions_GetInviteIdByIndex";
    inline constexpr const char* EOS_Sessions_IsUserInSession = "EOS_Sessions_IsUserInSession";
    inline constexpr const char* EOS_Sessions_JoinSession = "EOS_Sessions_JoinSession";
    inline constexpr const char* EOS_Sessions_QueryInvites = "EOS_Sessions_QueryInvites";
    inline constexpr const char* EOS_Sessions_RegisterPlayers = "EOS_Sessions_RegisterPlayers";
    inline constexpr const char* EOS_Sessions_RejectInvite = "EOS_Sessions_RejectInvite";
    inline constexpr const char* EOS_Sessions_RemoveNotifyJoinSessionAccepted = "EOS_Sessions_RemoveNotifyJoinSessionAccepted";
    inline constexpr const char* EOS_Sessions_RemoveNotifyLeaveSessionRequested = "EOS_Sessions_RemoveNotifyLeaveSessionRequested";
    inline constexpr const char* EOS_Sessions_RemoveNotifySendSessionNativeInviteRequested = "EOS_Sessions_RemoveNotifySendSessionNativeInviteRequested";
    inline constexpr const char* EOS_Sessions_RemoveNotifySessionInviteAccepted = "EOS_Sessions_RemoveNotifySessionInviteAccepted";
    inline constexpr const char* EOS_Sessions_RemoveNotifySessionInviteReceived = "EOS_Sessions_RemoveNotifySessionInviteReceived";
    inline constexpr const char* EOS_Sessions_RemoveNotifySessionInviteRejected = "EOS_Sessions_RemoveNotifySessionInviteRejected";
    inline constexpr const char* EOS_Sessions_SendInvite = "EOS_Sessions_SendInvite";
    inline constexpr const char* EOS_Sessions_StartSession = "EOS_Sessions_StartSession";
    inline constexpr const char* EOS_Sessions_UnregisterPlayers = "EOS_Sessions_UnregisterPlayers";
    inline constexpr const char* EOS_Sessions_UpdateSession = "EOS_Sessions_UpdateSession";
    inline constexpr const char* EOS_Sessions_UpdateSessionModification = "EOS_Sessions_UpdateSessionModification";
} // namespace sessions

// ── Stats (6 fonctions) ─────────────────────────────────────────────

namespace stats {
    inline constexpr const char* EOS_Stats_CopyStatByIndex = "EOS_Stats_CopyStatByIndex";
    inline constexpr const char* EOS_Stats_CopyStatByName = "EOS_Stats_CopyStatByName";
    inline constexpr const char* EOS_Stats_GetStatsCount = "EOS_Stats_GetStatsCount";
    inline constexpr const char* EOS_Stats_IngestStat = "EOS_Stats_IngestStat";
    inline constexpr const char* EOS_Stats_QueryStats = "EOS_Stats_QueryStats";
    inline constexpr const char* EOS_Stats_Stat_Release = "EOS_Stats_Stat_Release";
} // namespace stats

// ── TitleStorage (8 fonctions) ──────────────────────────────────────

namespace titlestorage {
    inline constexpr const char* EOS_TitleStorage_CopyFileMetadataAtIndex = "EOS_TitleStorage_CopyFileMetadataAtIndex";
    inline constexpr const char* EOS_TitleStorage_CopyFileMetadataByFilename = "EOS_TitleStorage_CopyFileMetadataByFilename";
    inline constexpr const char* EOS_TitleStorage_DeleteCache = "EOS_TitleStorage_DeleteCache";
    inline constexpr const char* EOS_TitleStorage_FileMetadata_Release = "EOS_TitleStorage_FileMetadata_Release";
    inline constexpr const char* EOS_TitleStorage_GetFileMetadataCount = "EOS_TitleStorage_GetFileMetadataCount";
    inline constexpr const char* EOS_TitleStorage_QueryFile = "EOS_TitleStorage_QueryFile";
    inline constexpr const char* EOS_TitleStorage_QueryFileList = "EOS_TitleStorage_QueryFileList";
    inline constexpr const char* EOS_TitleStorage_ReadFile = "EOS_TitleStorage_ReadFile";
} // namespace titlestorage

// ── UI (24 fonctions) ────────────────────────────────────────────────

namespace ui {
    inline constexpr const char* EOS_UI_AcknowledgeEventId = "EOS_UI_AcknowledgeEventId";
    inline constexpr const char* EOS_UI_AddNotifyDisplaySettingsUpdated = "EOS_UI_AddNotifyDisplaySettingsUpdated";
    inline constexpr const char* EOS_UI_AddNotifyMemoryMonitor = "EOS_UI_AddNotifyMemoryMonitor";
    inline constexpr const char* EOS_UI_GetFriendsExclusiveInput = "EOS_UI_GetFriendsExclusiveInput";
    inline constexpr const char* EOS_UI_GetFriendsVisible = "EOS_UI_GetFriendsVisible";
    inline constexpr const char* EOS_UI_GetNotificationLocationPreference = "EOS_UI_GetNotificationLocationPreference";
    inline constexpr const char* EOS_UI_GetToggleFriendsButton = "EOS_UI_GetToggleFriendsButton";
    inline constexpr const char* EOS_UI_GetToggleFriendsKey = "EOS_UI_GetToggleFriendsKey";
    inline constexpr const char* EOS_UI_HideFriends = "EOS_UI_HideFriends";
    inline constexpr const char* EOS_UI_IsSocialOverlayPaused = "EOS_UI_IsSocialOverlayPaused";
    inline constexpr const char* EOS_UI_IsValidButtonCombination = "EOS_UI_IsValidButtonCombination";
    inline constexpr const char* EOS_UI_IsValidKeyCombination = "EOS_UI_IsValidKeyCombination";
    inline constexpr const char* EOS_UI_PauseSocialOverlay = "EOS_UI_PauseSocialOverlay";
    inline constexpr const char* EOS_UI_PrePresent = "EOS_UI_PrePresent";
    inline constexpr const char* EOS_UI_RemoveNotifyDisplaySettingsUpdated = "EOS_UI_RemoveNotifyDisplaySettingsUpdated";
    inline constexpr const char* EOS_UI_RemoveNotifyMemoryMonitor = "EOS_UI_RemoveNotifyMemoryMonitor";
    inline constexpr const char* EOS_UI_ReportInputState = "EOS_UI_ReportInputState";
    inline constexpr const char* EOS_UI_SetDisplayPreference = "EOS_UI_SetDisplayPreference";
    inline constexpr const char* EOS_UI_SetToggleFriendsButton = "EOS_UI_SetToggleFriendsButton";
    inline constexpr const char* EOS_UI_SetToggleFriendsKey = "EOS_UI_SetToggleFriendsKey";
    inline constexpr const char* EOS_UI_ShowBlockPlayer = "EOS_UI_ShowBlockPlayer";
    inline constexpr const char* EOS_UI_ShowFriends = "EOS_UI_ShowFriends";
    inline constexpr const char* EOS_UI_ShowNativeProfile = "EOS_UI_ShowNativeProfile";
    inline constexpr const char* EOS_UI_ShowReportPlayer = "EOS_UI_ShowReportPlayer";
} // namespace ui

// ── UserInfo (14 fonctions) ──────────────────────────────────────────

namespace userinfo {
    inline constexpr const char* EOS_UserInfo_BestDisplayName_Release = "EOS_UserInfo_BestDisplayName_Release";
    inline constexpr const char* EOS_UserInfo_CopyBestDisplayName = "EOS_UserInfo_CopyBestDisplayName";
    inline constexpr const char* EOS_UserInfo_CopyBestDisplayNameWithPlatform = "EOS_UserInfo_CopyBestDisplayNameWithPlatform";
    inline constexpr const char* EOS_UserInfo_CopyExternalUserInfoByAccountId = "EOS_UserInfo_CopyExternalUserInfoByAccountId";
    inline constexpr const char* EOS_UserInfo_CopyExternalUserInfoByAccountType = "EOS_UserInfo_CopyExternalUserInfoByAccountType";
    inline constexpr const char* EOS_UserInfo_CopyExternalUserInfoByIndex = "EOS_UserInfo_CopyExternalUserInfoByIndex";
    inline constexpr const char* EOS_UserInfo_CopyUserInfo = "EOS_UserInfo_CopyUserInfo";
    inline constexpr const char* EOS_UserInfo_ExternalUserInfo_Release = "EOS_UserInfo_ExternalUserInfo_Release";
    inline constexpr const char* EOS_UserInfo_GetExternalUserInfoCount = "EOS_UserInfo_GetExternalUserInfoCount";
    inline constexpr const char* EOS_UserInfo_GetLocalPlatformType = "EOS_UserInfo_GetLocalPlatformType";
    inline constexpr const char* EOS_UserInfo_QueryUserInfo = "EOS_UserInfo_QueryUserInfo";
    inline constexpr const char* EOS_UserInfo_QueryUserInfoByDisplayName = "EOS_UserInfo_QueryUserInfoByDisplayName";
    inline constexpr const char* EOS_UserInfo_QueryUserInfoByExternalAccount = "EOS_UserInfo_QueryUserInfoByExternalAccount";
    inline constexpr const char* EOS_UserInfo_Release = "EOS_UserInfo_Release";
} // namespace userinfo

} // namespace iecode::imports::eossdk_win_shipping
