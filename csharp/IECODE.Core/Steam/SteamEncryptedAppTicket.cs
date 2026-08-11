using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace IECODE.Core.Steam;

/// <summary>
/// P/Invoke wrappers for Steam Encrypted App Ticket DLL functions.
/// Used for DRM validation and save authentication.
/// </summary>
/// <remarks>
/// Source: docs/nie-analysis/STEAM_API_INTEGRATION.md
/// DLL: sdkencryptedappticket64.dll
/// 
/// Exported functions (12 total):
/// - SteamEncryptedAppTicket_BDecryptTicket
/// - SteamEncryptedAppTicket_BGetAppDefinedValue
/// - SteamEncryptedAppTicket_BIsLicenseBorrowed
/// - SteamEncryptedAppTicket_BIsLicenseTemporary
/// - SteamEncryptedAppTicket_BIsTicketForApp
/// - SteamEncryptedAppTicket_BIsTicketSigned
/// - SteamEncryptedAppTicket_BUserIsVacBanned
/// - SteamEncryptedAppTicket_BUserOwnsAppInTicket
/// - SteamEncryptedAppTicket_GetTicketAppID
/// - SteamEncryptedAppTicket_GetTicketIssueTime
/// - SteamEncryptedAppTicket_GetTicketSteamID
/// - SteamEncryptedAppTicket_GetUserVariableData
/// </remarks>
public static partial class SteamEncryptedAppTicket
{
    private const string DllName = "sdkencryptedappticket64.dll";

    static SteamEncryptedAppTicket()
    {
        NativeLibrary.SetDllImportResolver(typeof(SteamEncryptedAppTicket).Assembly, ImportResolver);
    }

    private static IntPtr ImportResolver(string libraryName, Assembly assembly, DllImportSearchPath? searchPath)
    {
        if (libraryName == DllName && OperatingSystem.IsLinux())
        {
            if (NativeLibrary.TryLoad("libsdkencryptedappticket.so", assembly, searchPath, out IntPtr handle))
            {
                return handle;
            }
        }
        return IntPtr.Zero;
    }

    /// <summary>IEVR App ID on Steam. Use IEVRConstants.STEAM_APP_ID instead.</summary>
    [Obsolete("Use IEVRConstants.STEAM_APP_ID")]
    public const uint IEVR_APP_ID = IEVRConstants.STEAM_APP_ID;

    /// <summary>
    /// Decrypts an encrypted app ticket with a 32-byte key.
    /// </summary>
    /// <param name="rgubTicketEncrypted">Encrypted ticket data</param>
    /// <param name="cubTicketEncrypted">Size of encrypted data</param>
    /// <param name="rgubTicketDecrypted">Output buffer for decrypted data</param>
    /// <param name="pcubTicketDecrypted">Size of decrypted data (output)</param>
    /// <param name="rgubKey">32-byte decryption key</param>
    /// <param name="cubKey">Size of key (must be 32)</param>
    /// <returns>True if decryption succeeds</returns>
    [LibraryImport(DllName, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool BDecryptTicket(
        ReadOnlySpan<byte> rgubTicketEncrypted,
        uint cubTicketEncrypted,
        Span<byte> rgubTicketDecrypted,
        ref uint pcubTicketDecrypted,
        ReadOnlySpan<byte> rgubKey,
        int cubKey);

    /// <summary>
    /// Verifies the decrypted ticket belongs to the specified app ID.
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool BIsTicketForApp(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted,
        uint nAppID);

    /// <summary>
    /// Gets app-defined value from a decrypted ticket.
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool BGetAppDefinedValue(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted,
        out uint pValue);

    /// <summary>
    /// Checks if the license is borrowed (Family Sharing).
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool BIsLicenseBorrowed(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted);

    /// <summary>
    /// Checks if the license is temporary (Free Weekend, etc).
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool BIsLicenseTemporary(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted);

    /// <summary>
    /// Checks if the ticket has a valid signature.
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool BIsTicketSigned(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted,
        ReadOnlySpan<byte> pubRSAKey,
        uint cubRSAKey);

    /// <summary>
    /// Checks if the user has a VAC ban.
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool BUserIsVacBanned(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted);

    /// <summary>
    /// Checks if the user owns the specified app.
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool BUserOwnsAppInTicket(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted,
        uint nAppID);

    /// <summary>
    /// Gets the App ID from the decrypted ticket.
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    public static partial uint GetTicketAppID(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted);

    /// <summary>
    /// Gets the ticket issue time as Unix timestamp.
    /// </summary>
    [LibraryImport(DllName, SetLastError = true)]
    public static partial uint GetTicketIssueTime(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted);

    /// <summary>
    /// Extracts the Steam ID from a decrypted ticket.
    /// </summary>
    /// <param name="rgubTicketDecrypted">Decrypted ticket data</param>
    /// <param name="cubTicketDecrypted">Size of decrypted data</param>
    /// <param name="psteamID">Output Steam ID (64-bit)</param>
    [LibraryImport(DllName, SetLastError = true)]
    public static partial void GetTicketSteamID(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted,
        out ulong psteamID);

    /// <summary>
    /// Gets custom user variable data from the decrypted ticket.
    /// Returns pointer to data within the ticket buffer.
    /// </summary>
    /// <param name="rgubTicketDecrypted">Decrypted ticket data</param>
    /// <param name="cubTicketDecrypted">Size of decrypted data</param>
    /// <param name="pcubUserData">Size of user data (output)</param>
    /// <returns>Pointer to user data within ticket</returns>
    [LibraryImport(DllName, SetLastError = true)]
    public static partial IntPtr GetUserVariableData(
        ReadOnlySpan<byte> rgubTicketDecrypted,
        uint cubTicketDecrypted,
        out uint pcubUserData);

    /// <summary>
    /// Validates a save file's encrypted ticket.
    /// </summary>
    /// <param name="encryptedTicket">Encrypted ticket bytes</param>
    /// <param name="decryptionKey">32-byte decryption key</param>
    /// <param name="appId">Expected Steam App ID</param>
    /// <param name="expectedSteamId">Expected Steam user ID</param>
    /// <param name="expectedUserData">Expected custom user data (save metadata)</param>
    /// <returns>True if ticket is valid and matches expected values</returns>
    public static bool ValidateSaveTicket(
        ReadOnlySpan<byte> encryptedTicket,
        ReadOnlySpan<byte> decryptionKey,
        uint appId,
        ulong expectedSteamId,
        ReadOnlySpan<byte> expectedUserData)
    {
        if (decryptionKey.Length != 32)
            throw new ArgumentException("Decryption key must be 32 bytes", nameof(decryptionKey));

        // Decrypt ticket
        Span<byte> decryptedTicket = stackalloc byte[1024];
        uint decryptedSize = (uint)decryptedTicket.Length;

        if (!BDecryptTicket(
            encryptedTicket,
            (uint)encryptedTicket.Length,
            decryptedTicket,
            ref decryptedSize,
            decryptionKey,
            32))
        {
            return false;
        }

        // Verify app ID
        if (!BIsTicketForApp(decryptedTicket[..(int)decryptedSize], decryptedSize, appId))
        {
            return false;
        }

        // Verify Steam ID
        GetTicketSteamID(decryptedTicket[..(int)decryptedSize], decryptedSize, out ulong ticketSteamId);
        if (ticketSteamId != expectedSteamId)
        {
            return false;
        }

        // Verify user variable data
        IntPtr userDataPtr = GetUserVariableData(
            decryptedTicket[..(int)decryptedSize],
            decryptedSize,
            out uint userDataSize);

        if (userDataSize != expectedUserData.Length)
        {
            return false;
        }

        unsafe
        {
            var actualUserData = new ReadOnlySpan<byte>((byte*)userDataPtr, (int)userDataSize);
            return actualUserData.SequenceEqual(expectedUserData);
        }
    }

    /// <summary>
    /// Parses ticket info from decrypted ticket data.
    /// </summary>
    public static TicketInfo? GetTicketInfo(ReadOnlySpan<byte> decryptedTicket)
    {
        try
        {
            uint size = (uint)decryptedTicket.Length;

            GetTicketSteamID(decryptedTicket, size, out ulong steamId);
            uint appId = GetTicketAppID(decryptedTicket, size);
            uint issueTime = GetTicketIssueTime(decryptedTicket, size);
            bool isVacBanned = BUserIsVacBanned(decryptedTicket, size);
            bool isBorrowed = BIsLicenseBorrowed(decryptedTicket, size);
            bool isTemporary = BIsLicenseTemporary(decryptedTicket, size);
            BGetAppDefinedValue(decryptedTicket, size, out uint appDefinedValue);

            return new TicketInfo
            {
                SteamID = steamId,
                AppID = appId,
                IssueTime = DateTimeOffset.FromUnixTimeSeconds(issueTime).DateTime,
                IsVacBanned = isVacBanned,
                IsLicenseBorrowed = isBorrowed,
                IsLicenseTemporary = isTemporary,
                AppDefinedValue = appDefinedValue
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Attempts to decrypt ticket with given key and returns info.
    /// </summary>
    public static (bool Success, TicketInfo? Info) TryDecryptAndParse(
        ReadOnlySpan<byte> encryptedTicket,
        ReadOnlySpan<byte> key32)
    {
        if (key32.Length != 32)
            return (false, null);

        Span<byte> decrypted = stackalloc byte[2048];
        uint decryptedSize = (uint)decrypted.Length;

        if (!BDecryptTicket(encryptedTicket, (uint)encryptedTicket.Length,
            decrypted, ref decryptedSize, key32, 32))
        {
            return (false, null);
        }

        var info = GetTicketInfo(decrypted[..(int)decryptedSize]);
        return (info != null, info);
    }
}

/// <summary>
/// Parsed Steam encrypted app ticket information.
/// </summary>
public sealed record TicketInfo
{
    public ulong SteamID { get; init; }
    public uint AppID { get; init; }
    public DateTime IssueTime { get; init; }
    public bool IsVacBanned { get; init; }
    public bool IsLicenseBorrowed { get; init; }
    public bool IsLicenseTemporary { get; init; }
    public uint AppDefinedValue { get; init; }

    public override string ToString() =>
        $"SteamID: {SteamID}, AppID: {AppID}, Issued: {IssueTime:yyyy-MM-dd HH:mm:ss}, " +
        $"VAC: {IsVacBanned}, Borrowed: {IsLicenseBorrowed}, Temporary: {IsLicenseTemporary}, " +
        $"AppValue: {AppDefinedValue}";
}
