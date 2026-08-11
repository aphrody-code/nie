using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace IECODE.Core.Steam;

/// <summary>
/// P/Invoke wrappers for Steam API (steam_api64.dll).
/// Provides access to Steam user info, remote storage, and app data.
/// </summary>
/// <remarks>
/// DLL: steam_api64.dll (1096 exports)
/// Documentation: https://partner.steamgames.com/doc/api
/// </remarks>
public static partial class SteamApi
{
    private const string DllName = "steam_api64.dll";

    static SteamApi()
    {
        NativeLibrary.SetDllImportResolver(typeof(SteamApi).Assembly, ImportResolver);
    }

    private static IntPtr ImportResolver(string libraryName, Assembly assembly, DllImportSearchPath? searchPath)
    {
        if (libraryName == DllName && OperatingSystem.IsLinux())
        {
            if (NativeLibrary.TryLoad("libsteam_api.so", assembly, searchPath, out IntPtr handle))
            {
                return handle;
            }
        }
        return IntPtr.Zero;
    }

    /// <summary>IEVR App ID on Steam. Use IEVRConstants.STEAM_APP_ID instead.</summary>
    [Obsolete("Use IEVRConstants.STEAM_APP_ID")]
    public const uint IEVR_APP_ID = IEVRConstants.STEAM_APP_ID;

    #region Initialization

    /// <summary>
    /// Initializes the Steam API. Must be called before any other Steam functions.
    /// </summary>
    /// <returns>True if Steam is running and initialization succeeded.</returns>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_Init")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool Init();

    /// <summary>
    /// Shuts down the Steam API. Should be called when the application exits.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_Shutdown")]
    public static partial void Shutdown();

    /// <summary>
    /// Checks if the Steam client is running.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_IsSteamRunning")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool IsSteamRunning();

    /// <summary>
    /// Checks if app should restart through Steam.
    /// </summary>
    /// <param name="appId">The Steam App ID.</param>
    /// <returns>True if the app should restart.</returns>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_RestartAppIfNecessary")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool RestartAppIfNecessary(uint appId);

    /// <summary>
    /// Gets the HSteamUser handle for the current user.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_GetHSteamUser")]
    public static partial int GetHSteamUser();

    /// <summary>
    /// Gets the HSteamPipe handle for the current pipe.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_GetHSteamPipe")]
    public static partial int GetHSteamPipe();

    #endregion

    #region ISteamUser

    /// <summary>
    /// Gets the Steam ID of the current user.
    /// </summary>
    /// <param name="steamUser">ISteamUser interface pointer.</param>
    /// <returns>64-bit Steam ID.</returns>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamUser_GetSteamID")]
    public static partial ulong ISteamUser_GetSteamID(IntPtr steamUser);

    /// <summary>
    /// Checks if the user is logged on to Steam.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamUser_BLoggedOn")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamUser_BLoggedOn(IntPtr steamUser);

    /// <summary>
    /// Gets the Steam level of the current player.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamUser_GetPlayerSteamLevel")]
    public static partial int ISteamUser_GetPlayerSteamLevel(IntPtr steamUser);

    #endregion

    #region ISteamApps

    /// <summary>
    /// Checks if the user owns the app and has a license.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamApps_BIsSubscribed")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamApps_BIsSubscribed(IntPtr steamApps);

    /// <summary>
    /// Checks if the user is subscribed to a specific app.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamApps_BIsSubscribedApp")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamApps_BIsSubscribedApp(IntPtr steamApps, uint appId);

    /// <summary>
    /// Checks if the app is being accessed via Family Sharing.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamApps_BIsSubscribedFromFamilySharing")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamApps_BIsSubscribedFromFamilySharing(IntPtr steamApps);

    /// <summary>
    /// Checks if a DLC is installed.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamApps_BIsDlcInstalled")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamApps_BIsDlcInstalled(IntPtr steamApps, uint appId);

    /// <summary>
    /// Gets the current game language.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamApps_GetCurrentGameLanguage", StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.LPStr)]
    public static partial string ISteamApps_GetCurrentGameLanguage(IntPtr steamApps);

    /// <summary>
    /// Gets the app's build ID.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamApps_GetAppBuildId")]
    public static partial int ISteamApps_GetAppBuildId(IntPtr steamApps);

    /// <summary>
    /// Gets the install directory of an app.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamApps_GetAppInstallDir")]
    public static partial uint ISteamApps_GetAppInstallDir(IntPtr steamApps, uint appId,
        [MarshalAs(UnmanagedType.LPStr)] out string folder, uint folderBufferSize);

    #endregion

    #region ISteamRemoteStorage - Core

    /// <summary>
    /// Checks if Steam Cloud is enabled for this user's account.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_IsCloudEnabledForAccount")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_IsCloudEnabledForAccount(IntPtr remoteStorage);

    /// <summary>
    /// Checks if Steam Cloud is enabled for this app.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_IsCloudEnabledForApp")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_IsCloudEnabledForApp(IntPtr remoteStorage);

    /// <summary>
    /// Gets the quota info for Steam Cloud storage.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_GetQuota")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_GetQuota(IntPtr remoteStorage,
        out ulong totalBytes, out ulong availableBytes);

    /// <summary>
    /// Gets the number of files in Steam Cloud.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_GetFileCount")]
    public static partial int ISteamRemoteStorage_GetFileCount(IntPtr remoteStorage);

    /// <summary>
    /// Gets file name and size by index.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_GetFileNameAndSize", StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.LPStr)]
    public static partial string ISteamRemoteStorage_GetFileNameAndSize(IntPtr remoteStorage,
        int fileIndex, out int fileSize);

    #endregion

    #region ISteamRemoteStorage - File Operations

    /// <summary>
    /// Checks if a file exists in Steam Cloud.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileExists", StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_FileExists(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName);

    /// <summary>
    /// Gets the size of a file in Steam Cloud.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_GetFileSize", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int ISteamRemoteStorage_GetFileSize(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName);

    /// <summary>
    /// Gets the timestamp of a file in Steam Cloud.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_GetFileTimestamp", StringMarshalling = StringMarshalling.Utf8)]
    public static partial long ISteamRemoteStorage_GetFileTimestamp(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName);

    /// <summary>
    /// Reads a file from Steam Cloud synchronously.
    /// </summary>
    /// <returns>Number of bytes read, or 0 on failure.</returns>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileRead", StringMarshalling = StringMarshalling.Utf8)]
    public static partial int ISteamRemoteStorage_FileRead(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName,
        byte[] data, int dataToRead);

    /// <summary>
    /// Writes a file to Steam Cloud synchronously.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileWrite", StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_FileWrite(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName,
        byte[] data, int dataSize);

    /// <summary>
    /// Deletes a file from Steam Cloud.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileDelete", StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_FileDelete(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName);

    /// <summary>
    /// Checks if a file is persisted in Steam Cloud.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FilePersisted", StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_FilePersisted(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName);

    #endregion

    #region ISteamRemoteStorage - Async Operations

    /// <summary>
    /// Starts an async file read.
    /// </summary>
    /// <returns>SteamAPICall_t handle for the async operation.</returns>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileReadAsync", StringMarshalling = StringMarshalling.Utf8)]
    public static partial ulong ISteamRemoteStorage_FileReadAsync(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName,
        uint offset, uint bytesToRead);

    /// <summary>
    /// Gets the result of an async file read.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileReadAsyncComplete")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_FileReadAsyncComplete(IntPtr remoteStorage,
        ulong readCall, byte[] buffer, uint bytesToRead);

    /// <summary>
    /// Starts an async file write.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileWriteAsync", StringMarshalling = StringMarshalling.Utf8)]
    public static partial ulong ISteamRemoteStorage_FileWriteAsync(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName,
        byte[] data, uint dataSize);

    /// <summary>
    /// Begins a batch file write operation for better performance.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_BeginFileWriteBatch")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_BeginFileWriteBatch(IntPtr remoteStorage);

    /// <summary>
    /// Ends a batch file write operation.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_EndFileWriteBatch")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_EndFileWriteBatch(IntPtr remoteStorage);

    #endregion

    #region ISteamRemoteStorage - Stream Write

    /// <summary>
    /// Opens a file write stream.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileWriteStreamOpen", StringMarshalling = StringMarshalling.Utf8)]
    public static partial ulong ISteamRemoteStorage_FileWriteStreamOpen(IntPtr remoteStorage,
        [MarshalAs(UnmanagedType.LPStr)] string fileName);

    /// <summary>
    /// Writes a chunk to the stream.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileWriteStreamWriteChunk")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_FileWriteStreamWriteChunk(IntPtr remoteStorage,
        ulong writeHandle, byte[] data, int dataSize);

    /// <summary>
    /// Closes and commits the write stream.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileWriteStreamClose")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_FileWriteStreamClose(IntPtr remoteStorage,
        ulong writeHandle);

    /// <summary>
    /// Cancels a write stream.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_FileWriteStreamCancel")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ISteamRemoteStorage_FileWriteStreamCancel(IntPtr remoteStorage,
        ulong writeHandle);

    #endregion

    #region ISteamRemoteStorage - Local Changes

    /// <summary>
    /// Gets the count of local file changes pending sync.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_GetLocalFileChangeCount")]
    public static partial int ISteamRemoteStorage_GetLocalFileChangeCount(IntPtr remoteStorage);

    /// <summary>
    /// Gets info about a local file change.
    /// </summary>
    [LibraryImport(DllName, EntryPoint = "SteamAPI_ISteamRemoteStorage_GetLocalFileChange", StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.LPStr)]
    public static partial string ISteamRemoteStorage_GetLocalFileChange(IntPtr remoteStorage,
        int fileIndex, out int changeType, out int syncDirection);

    #endregion
}

/// <summary>
/// High-level Steam Cloud helper using SteamApi P/Invoke.
/// </summary>
public sealed class SteamCloudHelper : IDisposable
{
#pragma warning disable CS0649 // Field is never assigned
#pragma warning disable CS0169 // Field is never used
    private IntPtr _steamUser;
    private IntPtr _steamApps;
    private IntPtr _remoteStorage;
#pragma warning restore CS0169
#pragma warning restore CS0649
    private bool _initialized;

    /// <summary>
    /// Initializes Steam API and gets interface pointers.
    /// </summary>
    public bool Initialize()
    {
        if (_initialized) return true;

        if (!SteamApi.IsSteamRunning())
            return false;

        if (!SteamApi.Init())
            return false;

        _initialized = true;

        // Note: Interface pointers need to be obtained via SteamClient accessor
        // This is a simplified version - full implementation requires SteamClient

        return true;
    }

    /// <summary>
    /// Gets the current user's Steam ID.
    /// </summary>
    public ulong GetSteamID()
    {
        if (!_initialized || _steamUser == IntPtr.Zero)
            return 0;

        return SteamApi.ISteamUser_GetSteamID(_steamUser);
    }

    /// <summary>
    /// Lists all files in Steam Cloud for this app.
    /// </summary>
    public List<CloudFileInfo> ListCloudFiles()
    {
        var files = new List<CloudFileInfo>();

        if (!_initialized || _remoteStorage == IntPtr.Zero)
            return files;

        int count = SteamApi.ISteamRemoteStorage_GetFileCount(_remoteStorage);

        for (int i = 0; i < count; i++)
        {
            string name = SteamApi.ISteamRemoteStorage_GetFileNameAndSize(_remoteStorage, i, out int size);
            long timestamp = SteamApi.ISteamRemoteStorage_GetFileTimestamp(_remoteStorage, name);
            bool persisted = SteamApi.ISteamRemoteStorage_FilePersisted(_remoteStorage, name);

            files.Add(new CloudFileInfo
            {
                Name = name,
                Size = size,
                Timestamp = DateTimeOffset.FromUnixTimeSeconds(timestamp).DateTime,
                IsPersisted = persisted
            });
        }

        return files;
    }

    /// <summary>
    /// Reads a file from Steam Cloud.
    /// </summary>
    public byte[]? ReadFile(string fileName)
    {
        if (!_initialized || _remoteStorage == IntPtr.Zero)
            return null;

        if (!SteamApi.ISteamRemoteStorage_FileExists(_remoteStorage, fileName))
            return null;

        int size = SteamApi.ISteamRemoteStorage_GetFileSize(_remoteStorage, fileName);
        if (size <= 0) return null;

        byte[] data = new byte[size];
        int bytesRead = SteamApi.ISteamRemoteStorage_FileRead(_remoteStorage, fileName, data, size);

        if (bytesRead != size)
            return null;

        return data;
    }

    /// <summary>
    /// Writes a file to Steam Cloud.
    /// </summary>
    public bool WriteFile(string fileName, byte[] data)
    {
        if (!_initialized || _remoteStorage == IntPtr.Zero)
            return false;

        return SteamApi.ISteamRemoteStorage_FileWrite(_remoteStorage, fileName, data, data.Length);
    }

    /// <summary>
    /// Gets Steam Cloud quota info.
    /// </summary>
    public (ulong total, ulong available) GetQuota()
    {
        if (!_initialized || _remoteStorage == IntPtr.Zero)
            return (0, 0);

        SteamApi.ISteamRemoteStorage_GetQuota(_remoteStorage, out ulong total, out ulong available);
        return (total, available);
    }

    public void Dispose()
    {
        if (_initialized)
        {
            SteamApi.Shutdown();
            _initialized = false;
        }
    }
}

/// <summary>
/// Info about a file in Steam Cloud.
/// </summary>
public record CloudFileInfo
{
    public required string Name { get; init; }
    public int Size { get; init; }
    public DateTime Timestamp { get; init; }
    public bool IsPersisted { get; init; }
}
