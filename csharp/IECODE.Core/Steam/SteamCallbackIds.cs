using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace IECODE.Core.Steam;

/// <summary>
/// Steam API callback IDs discovered through reverse engineering.
/// </summary>
/// <remarks>
/// Source: docs/nie-analysis/STEAM_API_INTEGRATION.md
/// Lines: 697152-698000
/// </remarks>
[SupportedOSPlatform("windows")]
public static class SteamCallbackIds
{
    /// <summary>
    /// User achievement stored callback (ID: 1102, Hex: 0x44e).
    /// Triggered when an achievement is unlocked.
    /// </summary>
    public const int UserAchievementStored = 0x44e;

    /// <summary>
    /// User stats stored callback (ID: 1103, Hex: 0x44f).
    /// Triggered when stats are saved to Steam cloud.
    /// </summary>
    public const int UserStatsStored = 0x44f;

    /// <summary>
    /// Overlay activated callback (ID: 331, Hex: 0x14b).
    /// Triggered when Steam overlay opens/closes.
    /// </summary>
    public const int OverlayActivated = 0x14b;

    /// <summary>
    /// Game overlay activated (legacy) callback (ID: 168, Hex: 0xa8).
    /// </summary>
    public const int GameOverlayActivated = 0xa8;

    /// <summary>
    /// User stats received callback (ID: 714, Hex: 0x2ca).
    /// Triggered when user stats/achievements are loaded.
    /// </summary>
    public const int UserStatsReceived = 0x2ca;

    /// <summary>
    /// Unknown callback 1 (ID: 2302, Hex: 0x8fe).
    /// Possibly networking callback.
    /// </summary>
    public const int Unknown8FE = 0x8fe;

    /// <summary>
    /// Unknown callback 2 (ID: 2801, Hex: 0xaf1).
    /// Possibly DLC or inventory callback.
    /// </summary>
    public const int UnknownAF1 = 0xaf1;

    /// <summary>
    /// Unknown callback 3 (ID: 2802, Hex: 0xaf2).
    /// Related to 0xaf1.
    /// </summary>
    public const int UnknownAF2 = 0xaf2;
}
