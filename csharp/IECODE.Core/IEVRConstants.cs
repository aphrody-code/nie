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
    /// Steam install paths derived from the host environment.
    /// </summary>
    public static IEnumerable<string> SteamPaths
    {
        get
        {
            var roots = new[]
            {
                Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            };
            return roots.Where(static root => !string.IsNullOrWhiteSpace(root))
                .Select(static root => Path.Combine(root!, "Steam"))
                .Distinct(StringComparer.OrdinalIgnoreCase);
        }
    }
}
