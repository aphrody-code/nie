using System.Runtime.InteropServices;

namespace IECODE.Core.EOS;

/// <summary>
/// P/Invoke wrappers for Epic Online Services SDK (EOSSDK-Win64-Shipping.dll).
/// Implements PlayerDataStorage interface for cloud saves.
/// </summary>
/// <remarks>
/// EOS SDK Documentation: https://dev.epicgames.com/docs/game-services/player-data-storage
/// 
/// Key Concepts:
/// - EOS_Initialize() must be called before any other EOS API calls
/// - EOS_Platform_Create() creates a platform handle for API access
/// - EOS_Platform_Tick() must be called regularly to process callbacks (typically every frame or ~100ms)
/// - EOS_Shutdown() should be called on application exit
/// 
/// Native AOT: Uses LibraryImport for source generation compatibility
/// </remarks>
[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public static partial class EOSSDK
{
    private const string LibraryName = "EOSSDK-Win64-Shipping.dll";

    #region Handle Types (Type-Safe Wrappers)

    /// <summary>
    /// Handle to an EOS Platform instance. Required for most API calls.
    /// </summary>
    /// <remarks>
    /// Created via EOS_Platform_Create(), released via EOS_Platform_Release().
    /// Must call EOS_Platform_Tick() regularly while active.
    /// </remarks>
    public readonly struct EOS_HPlatform : IEquatable<EOS_HPlatform>
    {
        public readonly IntPtr Value;
        public EOS_HPlatform(IntPtr value) => Value = value;
        public bool Equals(EOS_HPlatform other) => Value == other.Value;
        public override bool Equals(object? obj) => obj is EOS_HPlatform other && Equals(other);
        public override int GetHashCode() => Value.GetHashCode();
        public static bool operator ==(EOS_HPlatform left, EOS_HPlatform right) => left.Equals(right);
        public static bool operator !=(EOS_HPlatform left, EOS_HPlatform right) => !left.Equals(right);
        public bool IsValid => Value != IntPtr.Zero;
    }

    /// <summary>
    /// Handle to the Player Data Storage interface for cloud save operations.
    /// </summary>
    public readonly struct EOS_HPlayerDataStorage : IEquatable<EOS_HPlayerDataStorage>
    {
        public readonly IntPtr Value;
        public EOS_HPlayerDataStorage(IntPtr value) => Value = value;
        public bool Equals(EOS_HPlayerDataStorage other) => Value == other.Value;
        public override bool Equals(object? obj) => obj is EOS_HPlayerDataStorage other && Equals(other);
        public override int GetHashCode() => Value.GetHashCode();
        public static bool operator ==(EOS_HPlayerDataStorage left, EOS_HPlayerDataStorage right) => left.Equals(right);
        public static bool operator !=(EOS_HPlayerDataStorage left, EOS_HPlayerDataStorage right) => !left.Equals(right);
        public bool IsValid => Value != IntPtr.Zero;
    }

    /// <summary>
    /// Handle to an active file transfer request (read or write operation).
    /// </summary>
    public readonly struct EOS_HPlayerDataStorageFileTransferRequest : IEquatable<EOS_HPlayerDataStorageFileTransferRequest>
    {
        public readonly IntPtr Value;
        public EOS_HPlayerDataStorageFileTransferRequest(IntPtr value) => Value = value;
        public bool Equals(EOS_HPlayerDataStorageFileTransferRequest other) => Value == other.Value;
        public override bool Equals(object? obj) => obj is EOS_HPlayerDataStorageFileTransferRequest other && Equals(other);
        public override int GetHashCode() => Value.GetHashCode();
        public static bool operator ==(EOS_HPlayerDataStorageFileTransferRequest left, EOS_HPlayerDataStorageFileTransferRequest right) => left.Equals(right);
        public static bool operator !=(EOS_HPlayerDataStorageFileTransferRequest left, EOS_HPlayerDataStorageFileTransferRequest right) => !left.Equals(right);
        public bool IsValid => Value != IntPtr.Zero;
    }

    /// <summary>
    /// Handle to the Auth interface for authentication operations.
    /// </summary>
    public readonly struct EOS_HAuth : IEquatable<EOS_HAuth>
    {
        public readonly IntPtr Value;
        public EOS_HAuth(IntPtr value) => Value = value;
        public bool Equals(EOS_HAuth other) => Value == other.Value;
        public override bool Equals(object? obj) => obj is EOS_HAuth other && Equals(other);
        public override int GetHashCode() => Value.GetHashCode();
        public static bool operator ==(EOS_HAuth left, EOS_HAuth right) => left.Equals(right);
        public static bool operator !=(EOS_HAuth left, EOS_HAuth right) => !left.Equals(right);
        public bool IsValid => Value != IntPtr.Zero;
    }

    /// <summary>
    /// Product User ID - identifies a user within EOS services.
    /// </summary>
    /// <remarks>
    /// This is different from EOS_EpicAccountId which represents an Epic Games account.
    /// EOS_ProductUserId is obtained after successful login and is required for Player Data Storage.
    /// </remarks>
    public readonly struct EOS_ProductUserId : IEquatable<EOS_ProductUserId>
    {
        public readonly IntPtr Value;
        public EOS_ProductUserId(IntPtr value) => Value = value;
        public bool Equals(EOS_ProductUserId other) => Value == other.Value;
        public override bool Equals(object? obj) => obj is EOS_ProductUserId other && Equals(other);
        public override int GetHashCode() => Value.GetHashCode();
        public static bool operator ==(EOS_ProductUserId left, EOS_ProductUserId right) => left.Equals(right);
        public static bool operator !=(EOS_ProductUserId left, EOS_ProductUserId right) => !left.Equals(right);
        public bool IsValid => Value != IntPtr.Zero;
    }

    #endregion

    #region Enums

    /// <summary>
    /// Result codes for EOS API calls.
    /// </summary>
    /// <remarks>
    /// Always check the result of EOS API calls. Success (0) indicates the operation completed successfully.
    /// For async operations, check the result in the callback's ResultCode field.
    /// </remarks>
    public enum EOS_EResult : int
    {
        /// <summary>The operation succeeded.</summary>
        Success = 0,
        /// <summary>No connection to the EOS backend.</summary>
        NoConnection = 1,
        /// <summary>Invalid credentials provided.</summary>
        InvalidCredentials = 2,
        /// <summary>Invalid user.</summary>
        InvalidUser = 3,
        /// <summary>Invalid auth token.</summary>
        InvalidAuth = 4,
        /// <summary>Access denied.</summary>
        AccessDenied = 5,
        /// <summary>Missing permissions.</summary>
        MissingPermissions = 6,
        /// <summary>Token not for account.</summary>
        TokenNotAccount = 7,
        /// <summary>Rate limit exceeded.</summary>
        TooManyRequests = 8,
        /// <summary>Operation already pending.</summary>
        AlreadyPending = 9,
        /// <summary>Invalid parameters provided.</summary>
        InvalidParameters = 10,
        /// <summary>Unrecognized response from server.</summary>
        UnrecognizedResponse = 11,
        /// <summary>SDK version mismatch.</summary>
        IncompatibleVersion = 12,
        /// <summary>SDK not configured.</summary>
        NotConfigured = 13,
        /// <summary>SDK already configured (EOS_Initialize called twice).</summary>
        AlreadyConfigured = 14,
        /// <summary>Feature not implemented.</summary>
        NotImplemented = 15,
        /// <summary>Operation was canceled.</summary>
        Canceled = 16,
        /// <summary>Resource not found.</summary>
        NotFound = 17,
        /// <summary>Operation will be retried.</summary>
        OperationWillRetry = 18,
        /// <summary>No change detected.</summary>
        NoChange = 19,
        /// <summary>Version mismatch.</summary>
        VersionMismatch = 20,
        /// <summary>Limit exceeded.</summary>
        LimitExceeded = 21,
        /// <summary>Feature disabled.</summary>
        Disabled = 22,
        /// <summary>Duplicate not allowed.</summary>
        DuplicateNotAllowed = 23,
        /// <summary>Missing parameters (deprecated).</summary>
        MissingParameters_DEPRECATED = 24,
        /// <summary>Invalid sandbox ID.</summary>
        InvalidSandboxId = 25,
        /// <summary>Operation timed out.</summary>
        TimedOut = 26,
        /// <summary>Partial result returned.</summary>
        PartialResult = 27,
        /// <summary>Missing role.</summary>
        MissingRole = 28,
        /// <summary>Missing feature.</summary>
        MissingFeature = 29,
        /// <summary>Invalid sandbox.</summary>
        InvalidSandbox = 30,
        /// <summary>Invalid deployment.</summary>
        InvalidDeployment = 31,
        /// <summary>Invalid product.</summary>
        InvalidProduct = 32,
        /// <summary>Invalid product user ID.</summary>
        InvalidProductUserID = 33,
        /// <summary>Service failure.</summary>
        ServiceFailure = 34,
        /// <summary>Cache directory invalid.</summary>
        CacheDirectoryInvalid = 35,
        /// <summary>Cache directory not supported.</summary>
        CacheDirectoryNotSupported = 36,
        /// <summary>Invalid state.</summary>
        InvalidState = 37,
        /// <summary>Request in progress.</summary>
        RequestInProgress = 38,
        /// <summary>Application suspended.</summary>
        ApplicationSuspended = 39,
        /// <summary>Network disconnected.</summary>
        NetworkDisconnected = 40,
        /// <summary>Offline mode.</summary>
        Offline = 41,
        /// <summary>Invalid auth client.</summary>
        InvalidAuthClient = 42,
        /// <summary>Invalid auth scope.</summary>
        InvalidAuthScope = 43,
        /// <summary>Invalid auth token.</summary>
        InvalidAuthToken = 44,
        /// <summary>Target user not found.</summary>
        TargetUserNotFound = 45,
        /// <summary>Account locked.</summary>
        AccountLocked = 46,
        /// <summary>Account portal load error.</summary>
        AccountPortalLoadError = 47,
        /// <summary>Account portal close error.</summary>
        AccountPortalCloseError = 48,

        // ═══════════════════════════════════════════════════════════════════════════════
        // PlayerDataStorage specific error codes (1000+)
        // ═══════════════════════════════════════════════════════════════════════════════

        /// <summary>Filename is invalid.</summary>
        PlayerDataStorage_FilenameInvalid = 1000,
        /// <summary>Filename is too long (max 64 chars).</summary>
        PlayerDataStorage_FilenameTooLong = 1001,
        /// <summary>Filename contains invalid characters.</summary>
        PlayerDataStorage_FilenameInvalidChars = 1002,
        /// <summary>File size exceeds maximum (usually 200MB per file, 400MB total).</summary>
        PlayerDataStorage_FileSizeTooLarge = 1003,
        /// <summary>File not found in cloud storage.</summary>
        PlayerDataStorage_FileNotFound = 1004,
        /// <summary>Invalid handle.</summary>
        PlayerDataStorage_HandleInvalid = 1005,
        /// <summary>Data is invalid.</summary>
        PlayerDataStorage_DataInvalid = 1006,
        /// <summary>Data length is invalid.</summary>
        PlayerDataStorage_DataLengthInvalid = 1007,
        /// <summary>Start index is invalid.</summary>
        PlayerDataStorage_StartIndexInvalid = 1008,
        /// <summary>Request already in progress for this file.</summary>
        PlayerDataStorage_RequestInProgress = 1009,
        /// <summary>User is throttled due to too many requests.</summary>
        PlayerDataStorage_UserThrottled = 1010,
        /// <summary>Encryption key not set.</summary>
        PlayerDataStorage_EncryptionKeyNotSet = 1011,
        /// <summary>User returned error from data callback.</summary>
        PlayerDataStorage_UserErrorFromDataCallback = 1012,
        /// <summary>File write operation failed.</summary>
        PlayerDataStorage_FileWriteFailed = 1013,
        /// <summary>File read operation failed.</summary>
        PlayerDataStorage_FileReadFailed = 1014,
    }

    /// <summary>
    /// Login credential types for EOS authentication.
    /// </summary>
    public enum EOS_ELoginCredentialType : int
    {
        /// <summary>Email + Password login.</summary>
        Password = 0,
        /// <summary>Exchange code from Epic Games Launcher.</summary>
        ExchangeCode = 1,
        /// <summary>Persistent auth token (device-based).</summary>
        PersistentAuth = 2,
        /// <summary>Device code for limited input devices.</summary>
        DeviceCode = 3,
        /// <summary>Developer auth tool credentials.</summary>
        Developer = 4,
        /// <summary>Refresh token from previous session.</summary>
        RefreshToken = 5,
        /// <summary>Account portal (web-based login).</summary>
        AccountPortal = 6,
        /// <summary>External platform auth (Steam, PSN, Xbox, etc.).</summary>
        ExternalAuth = 7
    }

    /// <summary>
    /// Scope flags for authentication - determines what data access is granted.
    /// </summary>
    [Flags]
    public enum EOS_EAuthScopeFlags : int
    {
        /// <summary>No additional scope.</summary>
        None = 0x0,
        /// <summary>Basic profile info (display name, etc.).</summary>
        BasicProfile = 0x1,
        /// <summary>Friends list access.</summary>
        FriendsList = 0x2,
        /// <summary>Presence (online status) access.</summary>
        Presence = 0x4,
        /// <summary>Friends management (add/remove).</summary>
        FriendsManagement = 0x8,
        /// <summary>Email address access.</summary>
        Email = 0x10,
        /// <summary>Country code access.</summary>
        Country = 0x20
    }

    #endregion

    // Structures
    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_InitializeOptions
    {
        public int ApiVersion;
        public IntPtr AllocateMemoryFunction;
        public IntPtr ReallocateMemoryFunction;
        public IntPtr ReleaseMemoryFunction;
        public IntPtr ProductName; // const char*
        public IntPtr ProductVersion; // const char*
        public IntPtr Reserved;
        public IntPtr SystemInitializeOptions;
        public IntPtr OverrideThreadAffinity;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_Platform_Options
    {
        public int ApiVersion;
        public IntPtr Reserved;
        public IntPtr ProductId; // const char*
        public IntPtr SandboxId; // const char*
        public int ClientCredentials_ApiVersion; // EOS_Platform_ClientCredentials
        public IntPtr ClientId; // const char*
        public IntPtr ClientSecret; // const char*
        public int bIsServer;
        public IntPtr EncryptionKey; // const char*
        public IntPtr OverrideCountryCode;
        public IntPtr OverrideLocaleCode;
        public IntPtr DeploymentId; // const char*
        public uint Flags;
        public IntPtr CacheDirectory; // const char*
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_Auth_Credentials
    {
        public int ApiVersion;
        public IntPtr Id; // const char*
        public IntPtr Token; // const char*
        public EOS_ELoginCredentialType Type;
        public IntPtr SystemAuthCredentialsOptions;
        public int ExternalType; // EOS_EExternalCredentialType
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_Auth_LoginOptions
    {
        public int ApiVersion;
        public IntPtr Credentials; // const EOS_Auth_Credentials*
        public EOS_EAuthScopeFlags ScopeFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_Auth_LoginCallbackInfo
    {
        public EOS_EResult ResultCode;
        public IntPtr ClientData;
        public EOS_ProductUserId LocalUserId;
        public IntPtr SelectedAccountId; // EOS_EpicAccountId
        public IntPtr SystemAuthCredentialsOptions;
    }

    // Delegates
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void EOS_Auth_OnLoginCallback(ref EOS_Auth_LoginCallbackInfo data);

    // Functions
    [LibraryImport(LibraryName)]
    public static partial EOS_EResult EOS_Initialize(ref EOS_InitializeOptions options);

    [LibraryImport(LibraryName)]
    public static partial EOS_EResult EOS_Shutdown();

    [LibraryImport(LibraryName)]
    public static partial EOS_HPlatform EOS_Platform_Create(ref EOS_Platform_Options options);

    [LibraryImport(LibraryName)]
    public static partial void EOS_Platform_Release(EOS_HPlatform handle);

    [LibraryImport(LibraryName)]
    public static partial void EOS_Platform_Tick(EOS_HPlatform handle);

    [LibraryImport(LibraryName)]
    public static partial IntPtr EOS_Platform_GetAuthInterface(EOS_HPlatform handle);

    [LibraryImport(LibraryName)]
    public static partial void EOS_Auth_Login(
        IntPtr handle, // EOS_HAuth
        ref EOS_Auth_LoginOptions options,
        IntPtr clientData,
        IntPtr completionCallback // EOS_Auth_OnLoginCallback
    );

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_QueryFileListOptions
    {
        public int ApiVersion;
        public EOS_ProductUserId LocalUserId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_ReadFileOptions
    {
        public int ApiVersion;
        public EOS_ProductUserId LocalUserId;
        public IntPtr Filename; // const char*
        public uint ReadChunkLengthBytes;
        public IntPtr ReadFileDataCallback;
        public IntPtr FileTransferProgressCallback;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_WriteFileOptions
    {
        public int ApiVersion;
        public EOS_ProductUserId LocalUserId;
        public IntPtr Filename; // const char*
        public uint ChunkLengthBytes;
        public IntPtr WriteFileDataCallback;
        public IntPtr FileTransferProgressCallback;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_FileMetadata
    {
        public int ApiVersion;
        public uint FileSizeBytes;
        public IntPtr Filename; // const char*
        public long LastModifiedTime;
        public IntPtr MD5Hash; // const char*
        public uint UnencryptedDataSizeBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_ReadFileDataCallbackInfo
    {
        public IntPtr ClientData;
        public EOS_HPlayerDataStorageFileTransferRequest Handle;
        [MarshalAs(UnmanagedType.LPStr)]
        public string Filename;
        public uint TotalFileSizeBytes;
        public bool IsLastChunk;
        public uint DataChunkLengthBytes;
        public IntPtr DataChunk; // const void*
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_WriteFileDataCallbackInfo
    {
        public IntPtr ClientData;
        public EOS_HPlayerDataStorageFileTransferRequest Handle;
        [MarshalAs(UnmanagedType.LPStr)]
        public string Filename;
        public uint DataBufferLengthBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_QueryFileListCallbackInfo
    {
        public IntPtr ClientData;
        public EOS_ProductUserId LocalUserId;
        public uint FileCount;
        public IntPtr FileMetadata; // const EOS_PlayerDataStorage_FileMetadata*
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_ReadFileCallbackInfo
    {
        public EOS_EResult ResultCode;
        public IntPtr ClientData;
        public EOS_ProductUserId LocalUserId;
        [MarshalAs(UnmanagedType.LPStr)]
        public string Filename;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_WriteFileCallbackInfo
    {
        public EOS_EResult ResultCode;
        public IntPtr ClientData;
        public EOS_ProductUserId LocalUserId;
        [MarshalAs(UnmanagedType.LPStr)]
        public string Filename;
    }

    // Delegates
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate EOS_EResult EOS_PlayerDataStorage_OnReadFileDataCallback(ref EOS_PlayerDataStorage_ReadFileDataCallbackInfo data);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate EOS_EResult EOS_PlayerDataStorage_OnWriteFileDataCallback(ref EOS_PlayerDataStorage_WriteFileDataCallbackInfo data, IntPtr outDataBuffer, ref uint outDataWritten);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void EOS_PlayerDataStorage_OnQueryFileListCompleteCallback(ref EOS_PlayerDataStorage_QueryFileListCallbackInfo data);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void EOS_PlayerDataStorage_OnReadFileCompleteCallback(ref EOS_PlayerDataStorage_ReadFileCallbackInfo data);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void EOS_PlayerDataStorage_OnWriteFileCompleteCallback(ref EOS_PlayerDataStorage_WriteFileCallbackInfo data);

    // Functions

    [LibraryImport(LibraryName)]
    public static partial EOS_HPlayerDataStorage EOS_Platform_GetPlayerDataStorageInterface(EOS_HPlatform handle);

    [LibraryImport(LibraryName)]
    public static partial void EOS_PlayerDataStorage_QueryFileList(
        EOS_HPlayerDataStorage handle,
        ref EOS_PlayerDataStorage_QueryFileListOptions options,
        IntPtr clientData,
        IntPtr completionCallback // EOS_PlayerDataStorage_OnQueryFileListCompleteCallback
    );

    [LibraryImport(LibraryName)]
    public static partial EOS_HPlayerDataStorageFileTransferRequest EOS_PlayerDataStorage_ReadFile(
        EOS_HPlayerDataStorage handle,
        ref EOS_PlayerDataStorage_ReadFileOptions options,
        IntPtr clientData,
        IntPtr completionCallback
    );

    [LibraryImport(LibraryName)]
    public static partial EOS_HPlayerDataStorageFileTransferRequest EOS_PlayerDataStorage_WriteFile(
        EOS_HPlayerDataStorage handle,
        ref EOS_PlayerDataStorage_WriteFileOptions options,
        IntPtr clientData,
        IntPtr completionCallback
    );

    [LibraryImport(LibraryName)]
    public static partial EOS_EResult EOS_PlayerDataStorage_CopyFileMetadataAtIndex(
        EOS_HPlayerDataStorage handle,
        ref EOS_PlayerDataStorage_QueryFileListOptions options, // Note: Check if this is the correct options struct for this call, usually it takes a separate options struct or just index
        uint index,
        out IntPtr outMetadata // EOS_PlayerDataStorage_FileMetadata*
    );

    // Correction: CopyFileMetadataAtIndex usually takes a specific options struct
    [StructLayout(LayoutKind.Sequential)]
    public struct EOS_PlayerDataStorage_CopyFileMetadataAtIndexOptions
    {
        public int ApiVersion;
        public EOS_ProductUserId LocalUserId;
        public uint Index;
    }

    [LibraryImport(LibraryName)]
    public static partial EOS_EResult EOS_PlayerDataStorage_CopyFileMetadataAtIndex(
        EOS_HPlayerDataStorage handle,
        ref EOS_PlayerDataStorage_CopyFileMetadataAtIndexOptions options,
        out IntPtr outMetadata
    );

    [LibraryImport(LibraryName)]
    public static partial void EOS_PlayerDataStorage_FileMetadata_Release(IntPtr metadata);

    [LibraryImport(LibraryName)]
    public static partial void EOS_PlayerDataStorageFileTransferRequest_Release(EOS_HPlayerDataStorageFileTransferRequest handle);
}
