using System.Text.Json;
using System.Text.Json.Serialization;
using IECODE.Core.Serialization;

namespace IECODE.Core;

/// <summary>
/// Représente une instance du jeu Inazuma Eleven Victory Road.
/// Point d'entrée principal pour toutes les opérations de reverse engineering.
/// </summary>
public sealed class IEVRGame : IDisposable
{
    #region Constants

    /// <summary>
    /// Nom du dossier d'installation Steam du jeu.
    /// </summary>
    public const string SteamGameFolderName = "INAZUMA ELEVEN Victory Road";

    /// <summary>
    /// Nom de l'exécutable principal.
    /// </summary>
    public const string ExecutableName = "nie.exe";

    /// <summary>
    /// Clé de décryptage CRI pour IEVR.
    /// </summary>
    public const uint CriEncryptionKey = 0x1717E18E;

    #endregion

    #region Properties

    /// <summary>
    /// Chemin racine du jeu.
    /// </summary>
    public string GamePath { get; }

    /// <summary>
    /// Chemin vers le dossier data/.
    /// </summary>
    public string DataPath => Path.Combine(GamePath, "data");

    /// <summary>
    /// Chemin vers le dossier packs/ contenant les CPK.
    /// </summary>
    public string PacksPath => Path.Combine(DataPath, "packs");

    /// <summary>
    /// Chemin vers le fichier cpk_list.cfg.bin (racine de data/).
    /// </summary>
    public string CpkListPath => Path.Combine(DataPath, "cpk_list.cfg.bin");

    /// <summary>
    /// Chemin vers les fichiers de configuration système.
    /// </summary>
    public string SystemConfigPath => Path.Combine(DataPath, "common", "system");

    /// <summary>
    /// Chemin vers l'exécutable nie.exe.
    /// </summary>
    public string ExecutablePath => Path.Combine(GamePath, ExecutableName);

    /// <summary>
    /// Indique si le jeu est valide (chemins existent).
    /// </summary>
    public bool IsValid { get; private set; }

    /// <summary>
    /// Informations sur le jeu (lazy loaded).
    /// </summary>
    public GameInfo? Info { get; private set; }

    #endregion

    #region Services

    /// <summary>
    /// Service d'extraction CPK.
    /// </summary>
    public Archives.CpkService Cpk { get; }

    /// <summary>
    /// Service de configuration cfg.bin.
    /// </summary>
    public Config.CfgBinService CfgBin { get; }

    /// <summary>
    /// Service de cryptographie CRI.
    /// </summary>
    public Crypto.CriCryptoService Crypto { get; }

    /// <summary>
    /// Service de dump haute performance.
    /// </summary>
    public Dump.DumpService Dump { get; }

    #endregion

    #region Constructor

    /// <summary>
    /// Crée une nouvelle instance du gestionnaire IEVR.
    /// </summary>
    /// <param name="gamePath">Chemin racine du jeu (optionnel, utilise auto-détection ou chemin Steam par défaut)</param>
    public IEVRGame(string? gamePath = null)
    {
        // Auto-détection du chemin si non fourni
        GamePath = gamePath ?? ResolveDefaultGamePath();

        // Validate paths
        IsValid = Directory.Exists(GamePath) &&
                  Directory.Exists(DataPath) &&
                  File.Exists(ExecutablePath);

        // Initialize services
        Cpk = new Archives.CpkService(this);
        CfgBin = new Config.CfgBinService(this);
        Crypto = new Crypto.CriCryptoService(this);
        Dump = new Dump.DumpService(this);
    }

    /// <summary>
    /// Résout le chemin du jeu par défaut (aucun chemin explicite fourni). Ordre :
    /// 1. variable d'env <c>IECODE_GAME_PATH</c> (override explicite) ;
    /// 2. premier candidat existant (install Linux steamcmd, libs Steam usuelles) contenant
    ///    <c>data/cpk_list.cfg.bin</c> ;
    /// 3. les racines Steam dérivées de l'environnement hôte ;
    /// 4. le répertoire courant en dernier recours.
    /// Permet d'utiliser la CLI sans <c>--game</c> sur un hôte Linux (cf. install VPS).
    /// </summary>
    public static string ResolveDefaultGamePath()
    {
        var env = Environment.GetEnvironmentVariable("IECODE_GAME_PATH");
        if (!string.IsNullOrWhiteSpace(env))
            return env;

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string[] candidates =
        [
            Path.Combine(home, ".local", "share", "Steam", "iecode", "inazuma"),
            Path.Combine(home, ".local", "share", "Steam", "steamapps", "common", "INAZUMA ELEVEN Victory Road"),
            Path.Combine(home, ".steam", "steam", "steamapps", "common", "INAZUMA ELEVEN Victory Road"),
        ];

        foreach (var candidate in candidates)
            if (File.Exists(Path.Combine(candidate, "data", "cpk_list.cfg.bin")))
                return candidate;

        foreach (var steamPath in IEVRConstants.SteamPaths)
        {
            var candidate = Path.Combine(steamPath, "steamapps", "common", SteamGameFolderName);
            if (Directory.Exists(candidate))
                return candidate;
        }

        return Directory.GetCurrentDirectory();
    }

    #endregion

    #region Methods

    /// <summary>
    /// Charge les informations du jeu (analyse lazy).
    /// </summary>
    public async Task<GameInfo> LoadInfoAsync(CancellationToken ct = default)
    {
        if (Info != null) return Info;

        if (!IsValid)
        {
            throw new InvalidOperationException($"Game path is not valid: {GamePath}");
        }

        Info = await Task.Run(() => AnalyzeGame(), ct);
        return Info;
    }

    /// <summary>
    /// Analyse la structure du jeu.
    /// </summary>
    private GameInfo AnalyzeGame()
    {
        var info = new GameInfo
        {
            GamePath = GamePath,
            ExecutablePath = ExecutablePath,
            AnalyzedAt = DateTime.UtcNow
        };

        // Count files
        if (Directory.Exists(PacksPath))
        {
            var cpkFiles = Directory.GetFiles(PacksPath, "*.cpk", SearchOption.AllDirectories);
            info.CpkCount = cpkFiles.Length;
            info.TotalCpkSize = cpkFiles.Sum(f => new FileInfo(f).Length);
        }

        // Get executable info
        if (File.Exists(ExecutablePath))
        {
            var exeInfo = new FileInfo(ExecutablePath);
            info.ExecutableSize = exeInfo.Length;
            info.ExecutableModified = exeInfo.LastWriteTimeUtc;
        }

        // Check for cpk_list
        info.HasCpkList = File.Exists(CpkListPath);

        return info;
    }

    /// <summary>
    /// Exporte les informations du jeu en JSON.
    /// </summary>
    public async Task<string> ExportInfoAsJsonAsync(CancellationToken ct = default)
    {
        var info = await LoadInfoAsync(ct);
        return JsonSerializer.Serialize(info, AppJsonContext.Default.GameInfo);
    }

    #endregion

    #region IDisposable

    private bool _disposed;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    ~IEVRGame()
    {
        Dispose();
    }

    #endregion
}

/// <summary>
/// Informations sur le jeu IEVR.
/// </summary>
public sealed class GameInfo
{
    public string GamePath { get; set; } = string.Empty;
    public string ExecutablePath { get; set; } = string.Empty;
    public long ExecutableSize { get; set; }
    public DateTime ExecutableModified { get; set; }
    public int CpkCount { get; set; }
    public long TotalCpkSize { get; set; }
    public bool HasCpkList { get; set; }
    public DateTime AnalyzedAt { get; set; }

    [JsonIgnore]
    public string TotalCpkSizeFormatted => FormatBytes(TotalCpkSize);

    private static string FormatBytes(long bytes)
    {
        string[] sizes = ["B", "KB", "MB", "GB", "TB"];
        int order = 0;
        double size = bytes;
        while (size >= 1024 && order < sizes.Length - 1)
        {
            order++;
            size /= 1024;
        }
        return $"{size:0.##} {sizes[order]}";
    }
}
