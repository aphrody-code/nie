using IECODE.Core.Steam.Content;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande download — téléchargement natif d'une app Steam (depots → disque),
/// sans steamcmd. Login compte (2FA), résolution depots/manifests, chunks CDN.
/// </summary>
public static class DownloadCommand
{
    public static async Task ExecuteAsync(
        uint appId,
        string output,
        string? user,
        string? password,
        string? guardCode,
        string branch,
        string os,
        bool allPlatforms,
        IReadOnlyList<uint> depots,
        int threads,
        string? tokenStore,
        bool list,
        bool verbose)
    {
        if (threads <= 0) threads = IECODE.Core.Runtime.HostProfile.Parallelism;

        Console.WriteLine();
        Console.WriteLine("╔══════════════════════════════════════════════════════════════════╗");
        Console.WriteLine("║        IECODE — Téléchargement natif Steam (sans steamcmd)        ║");
        Console.WriteLine("╚══════════════════════════════════════════════════════════════════╝");
        Console.WriteLine($"  App ID:   {appId}");
        if (!list) Console.WriteLine($"  Output:   {Path.GetFullPath(output)}");
        Console.WriteLine($"  Compte:   {(string.IsNullOrEmpty(user) ? "anonyme" : user)}");
        Console.WriteLine($"  Branche:  {branch}   OS: {(allPlatforms ? "tous" : os)}");
        Console.WriteLine($"  Threads:  {threads}");
        if (depots.Count > 0) Console.WriteLine($"  Depots:   {string.Join(", ", depots)}");
        Console.WriteLine();

        var options = new SteamDownloadOptions
        {
            AppId = appId,
            InstallDir = output,
            Username = string.IsNullOrEmpty(user) ? null : user,
            Password = string.IsNullOrEmpty(password) ? null : password,
            Branch = branch,
            Os = os,
            AllPlatforms = allPlatforms,
            DepotIds = depots,
            MaxDownloads = threads,
            TokenStorePath = tokenStore,
            GuardProvider = new ConsoleSteamGuardProvider(guardCode),
        };

        var lastLine = "";
        var progress = new Progress<SteamDownloadProgress>(p =>
        {
            string line = p.Phase switch
            {
                SteamDownloadPhase.Downloading =>
                    $"  ⏬ [{Bar(p.PercentComplete, 30)}] {p.PercentComplete:F1}%  {Bytes(p.DownloadedBytes)}/{Bytes(p.TotalBytes)}  {p.Message}",
                SteamDownloadPhase.Completed => "  ✓ Téléchargement terminé.",
                SteamDownloadPhase.Error => $"  ✗ {p.Message}",
                _ => $"  • {p.Message}",
            };
            if (line == lastLine) return;
            lastLine = line;
            if (p.Phase == SteamDownloadPhase.Downloading)
            {
                try { Console.Write($"\r{new string(' ', Math.Min(Console.WindowWidth - 1, 110))}\r"); }
                catch { Console.Write("\r"); }
                Console.Write(line);
            }
            else
            {
                Console.WriteLine(line);
            }
        });

        var downloader = new SteamDepotDownloader(msg => { if (verbose) Console.WriteLine($"    {msg}"); });

        // Mode inspection : liste les depots/manifests/tailles sans rien télécharger.
        if (list)
        {
            try
            {
                var depotInfos = await downloader.ListDepotsAsync(options);
                long grand = 0;
                Console.WriteLine($"  {"Depot",-10} {"Manifest",-20} {"Fichiers",10} {"Taille",14}  Nom");
                foreach (var d in depotInfos)
                {
                    grand += d.TotalBytes;
                    Console.WriteLine($"  {d.DepotId,-10} {d.ManifestId,-20} {d.FileCount,10:N0} {Bytes(d.TotalBytes),14}  {d.Name}");
                }
                Console.WriteLine($"\n  {depotInfos.Count} depot(s) — total {Bytes(grand)}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"✗ Échec: {ex.Message}");
                Environment.ExitCode = 1;
            }
            return;
        }

        var result = await downloader.DownloadAppAsync(options, progress);

        Console.WriteLine();
        Console.WriteLine();
        if (result.Success)
        {
            Console.WriteLine($"✓ {result.FileCount:N0} fichier(s), {Bytes(result.DownloadedBytes)} en {result.Duration.TotalSeconds:F0}s");
            Console.WriteLine($"  Depots: {string.Join(", ", result.Depots)}");
            Console.WriteLine($"  Install: {result.InstallDir}");
        }
        else
        {
            Console.Error.WriteLine($"✗ Échec: {result.Error}");
            Environment.ExitCode = 1;
        }
    }

    /// <summary>Affiche le buildid courant de l'app (check de mise à jour rapide).</summary>
    public static async Task PrintBuildIdAsync(uint appId, string? user, string? password, string? guard, string branch, string? tokenStore, bool json)
    {
        var options = new SteamDownloadOptions
        {
            AppId = appId,
            InstallDir = ".",
            Username = string.IsNullOrEmpty(user) ? null : user,
            Password = string.IsNullOrEmpty(password) ? null : password,
            Branch = branch,
            TokenStorePath = tokenStore,
            GuardProvider = new ConsoleSteamGuardProvider(guard),
        };
        try
        {
            var buildId = await new SteamDepotDownloader().GetBuildIdAsync(options);
            if (json) Console.WriteLine($"{{\"appId\":{appId},\"branch\":\"{branch}\",\"buildId\":{buildId}}}");
            else Console.WriteLine(buildId);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"✗ {ex.Message}");
            Environment.ExitCode = 1;
        }
    }

    private static string Bar(double percent, int width)
    {
        int filled = (int)(percent * width / 100);
        return new string('█', Math.Clamp(filled, 0, width)) + new string('░', Math.Clamp(width - filled, 0, width));
    }

    private static string Bytes(long bytes)
    {
        string[] sizes = ["B", "KB", "MB", "GB", "TB"];
        int order = 0;
        double size = bytes;
        while (size >= 1024 && order < sizes.Length - 1) { order++; size /= 1024; }
        return $"{size:F2} {sizes[order]}";
    }

    /// <summary>
    /// Fournit le code Steam Guard : d'abord <c>--guard</c>, puis <c>STEAM_GUARD_CODE</c>,
    /// puis saisie interactive (si un terminal est disponible).
    /// </summary>
    private sealed class ConsoleSteamGuardProvider(string? initialCode) : ISteamGuardProvider
    {
        private string? _pending = string.IsNullOrEmpty(initialCode)
            ? Environment.GetEnvironmentVariable("STEAM_GUARD_CODE")
            : initialCode;

        public Task<string> GetCodeAsync(SteamGuardKind kind, string? email, bool previousIncorrect, CancellationToken ct)
        {
            if (!previousIncorrect && !string.IsNullOrEmpty(_pending))
            {
                var code = _pending;
                _pending = null; // usage unique : ne pas resoumettre un code rejeté
                return Task.FromResult(code);
            }

            var label = kind == SteamGuardKind.Email
                ? $"Entrez le code Steam Guard envoyé à {email} : "
                : "Entrez le code Steam Guard (app mobile) : ";
            if (previousIncorrect) Console.WriteLine("Code précédent invalide.");

            if (Console.IsInputRedirected)
            {
                throw new InvalidOperationException(
                    "Steam Guard (2FA) requis mais pas de terminal interactif. " +
                    "Passez --guard <code> ou STEAM_GUARD_CODE=<code>.");
            }

            string? input;
            do { Console.Write(label); input = Console.ReadLine()?.Trim(); }
            while (string.IsNullOrEmpty(input));
            return Task.FromResult(input);
        }
    }
}
