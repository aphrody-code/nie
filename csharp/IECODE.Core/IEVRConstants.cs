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
    /// Racines Steam dérivées de l'environnement hôte, jamais codées en dur.
    /// </summary>
    /// <remarks>
    /// Les répertoires système ne suffisent pas : Steam s'installe couramment sur un second
    /// volume, et une liste figée (<c>D:\Steam</c>, <c>E:\Steam</c>) ne couvrait que deux
    /// lettres devinées. On énumère donc les volumes réellement montés — ce qui couvre aussi
    /// F:, G: et les points de montage Linux — au lieu d'en supposer aucun ou deux.
    /// <para>
    /// <see cref="DriveInfo.IsReady"/> est obligatoire : interroger un lecteur optique vide
    /// ou une carte absente lève une exception d'E/S.
    /// </para>
    /// </remarks>
    public static IEnumerable<string> SteamPaths
    {
        get
        {
            var roots = new List<string?>
            {
                Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            };

            try
            {
                foreach (var drive in DriveInfo.GetDrives())
                    if (drive.IsReady)
                        roots.Add(drive.RootDirectory.FullName);
            }
            catch (IOException)
            {
                // Volumes illisibles : les répertoires système ci-dessus restent exploitables.
            }
            catch (UnauthorizedAccessException)
            {
                // Idem — l'absence de droits sur un volume ne doit pas casser la résolution.
            }

            return roots.Where(static root => !string.IsNullOrWhiteSpace(root))
                .Select(static root => Path.Combine(root!, "Steam"))
                .Distinct(StringComparer.OrdinalIgnoreCase);
        }
    }
}
