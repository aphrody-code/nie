namespace IECODE.Core;

/// <summary>
/// Global constants for IECODE project.
/// </summary>
public static class IEVRConstants
{
    /// <summary>
    /// Steam App ID for Inazuma Eleven Victory Road.
    /// </summary>
    public const uint STEAM_APP_ID = 2799860;

    /// <summary>
    /// Game executable name.
    /// </summary>
    public const string GAME_EXECUTABLE = "nie.exe";

    /// <summary>
    /// Default Steam install paths to check.
    /// </summary>
    public static readonly string[] SteamPaths =
    [
        @"C:\Program Files (x86)\Steam",
        @"C:\Program Files\Steam",
        @"D:\Steam",
        @"E:\Steam"
    ];
}
