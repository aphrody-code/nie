using System.Diagnostics;
using IECODE.Core;
using IECODE.Core.Dump;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande dump - Dump complet du jeu (extraction de tous les CPK).
/// </summary>
public static class DumpCommand
{
    public static async Task ExecuteAsync(
        string? gamePath,
        string output,
        bool smart,
        bool verbose,
        int threads = 0,
        bool includeLoose = true,
        string? fileFilter = null,
        long? maxDiskBytes = null,
        bool noSpaceCheck = false)
    {
        if (threads <= 0) threads = IECODE.Core.Runtime.HostProfile.Parallelism;

        try
        {
            using var game = new IEVRGame(gamePath);

            if (!game.IsValid)
            {
                Console.Error.WriteLine($"Error: Game not found at: {game.GamePath}");
                Environment.ExitCode = 1;
                return;
            }

            Console.WriteLine();
            Console.WriteLine("╔══════════════════════════════════════════════════════════════════╗");
            Console.WriteLine("║           IECODE - Inazuma Eleven Victory Road Dump              ║");
            Console.WriteLine("╚══════════════════════════════════════════════════════════════════╝");
            Console.WriteLine();
            Console.WriteLine($"  Game Path:   {game.GamePath}");
            Console.WriteLine($"  Output:      {Path.GetFullPath(output)}");
            Console.WriteLine($"  Smart Dump:  {(smart ? "Yes (skip existing)" : "No (overwrite all)")}");
            Console.WriteLine($"  Threads:     {threads}");
            Console.WriteLine($"  Loose Files: {(includeLoose ? "Yes" : "No")}");
            Console.WriteLine($"  Filtre:      {(string.IsNullOrWhiteSpace(fileFilter) ? "tout (aucun)" : fileFilter)}");
            Console.WriteLine($"  Espace:      {(noSpaceCheck ? "contrôle désactivé (--no-space-check)" : maxDiskBytes is long c ? $"plafond {FormatBytes(c)} + partition" : "garde-fou partition")}");
            Console.WriteLine();

            Directory.CreateDirectory(output);

            var lastProgressLine = "";
            var spinnerChars = new[] { '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏' };
            var spinnerIndex = 0;
            var stopwatch = Stopwatch.StartNew();

            var options = new DumpOptions
            {
                OutputPath = output,
                SmartDump = smart,
                UseCpkList = true,
                IncludeLooseFiles = includeLoose,
                MaxParallelism = threads,
                FileFilter = fileFilter,
                MaxDiskBytes = maxDiskBytes,
                IgnoreSpaceCheck = noSpaceCheck,
                OnProgress = progress =>
                {
                    spinnerIndex = (spinnerIndex + 1) % spinnerChars.Length;
                    var spinner = spinnerChars[spinnerIndex];

                    string line = progress.Phase switch
                    {
                        DumpPhase.Loading => $"  {spinner} Chargement du manifest...",
                        DumpPhase.Planning => $"  {spinner} {progress.Message}",
                        DumpPhase.Extracting => FormatExtractionProgress(progress, spinner, stopwatch.Elapsed),
                        DumpPhase.CopyingLoose => $"  {spinner} Copie des loose files...",
                        DumpPhase.Completed => "  ✓ Dump terminé!",
                        DumpPhase.Cancelled => "  ✗ Dump annulé",
                        DumpPhase.Error => $"  ✗ Erreur: {progress.Message}",
                        _ => progress.Message
                    };

                    if (line != lastProgressLine)
                    {
                        // Effacer la ligne précédente et écrire la nouvelle
                        try
                        {
                            int clearWidth = Math.Min(Console.WindowWidth - 1, 100);
                            Console.Write($"\r{new string(' ', clearWidth)}\r");
                        }
                        catch
                        {
                            Console.Write("\r");
                        }
                        Console.Write(line);
                        lastProgressLine = line;

                        if (verbose && progress.Phase == DumpPhase.Extracting && progress.CurrentCpk != null)
                        {
                            Console.WriteLine();
                            lastProgressLine = "";
                        }
                    }
                }
            };

            var result = await game.Dump.ExecuteAsync(options);

            Console.WriteLine();
            Console.WriteLine();

            // Afficher le résumé
            PrintResult(result);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    private static string FormatExtractionProgress(DumpProgress progress, char spinner, TimeSpan elapsed)
    {
        var percent = progress.PercentComplete;
        var bar = CreateProgressBar(percent, 30);
        var speed = progress.MBPerSecond;
        var eta = CalculateEta(progress, elapsed);

        return $"  {spinner} [{bar}] {percent:F1}% | {progress.ExtractedFiles:N0}/{progress.TotalFiles:N0} | {speed:F1} MB/s | ETA: {eta}";
    }

    private static string CreateProgressBar(double percent, int width)
    {
        int filled = (int)(percent * width / 100);
        int empty = width - filled;
        return new string('█', filled) + new string('░', empty);
    }

    private static string CalculateEta(DumpProgress progress, TimeSpan elapsed)
    {
        if (progress.ExtractedFiles == 0 || progress.PercentComplete < 0.1)
            return "--:--";

        var remainingPercent = 100 - progress.PercentComplete;
        var secondsPerPercent = elapsed.TotalSeconds / progress.PercentComplete;
        var remainingSeconds = remainingPercent * secondsPerPercent;

        if (remainingSeconds > 3600)
            return $"{remainingSeconds / 3600:F0}h{(remainingSeconds % 3600) / 60:00}m";
        if (remainingSeconds > 60)
            return $"{remainingSeconds / 60:F0}m{remainingSeconds % 60:00}s";
        return $"{remainingSeconds:F0}s";
    }

    private static void PrintResult(DumpResult result)
    {
        Console.WriteLine("╔══════════════════════════════════════════════════════════════════╗");
        Console.WriteLine("║                          RÉSUMÉ DU DUMP                          ║");
        Console.WriteLine("╠══════════════════════════════════════════════════════════════════╣");

        if (result.Success)
        {
            Console.WriteLine($"║  Status:          ✓ Succès{(result.IsResume ? " (reprise)" : ""),-38}║");
        }
        else if (result.WasCancelled)
        {
            Console.WriteLine("║  Status:          ✗ Annulé                                      ║");
        }
        else
        {
            Console.WriteLine($"║  Status:          ✗ Erreur: {result.Error,-35}║");
        }

        Console.WriteLine($"║  Durée:           {FormatDuration(result.Duration),-47}║");
        Console.WriteLine($"║  CPKs traités:    {result.TotalCpks,-47}║");
        Console.WriteLine($"║  Fichiers:        {result.ExtractedFiles:N0} extraits, {result.SkippedFiles:N0} ignorés{GetPadding(result)}║");
        Console.WriteLine($"║  Données:         {FormatBytes(result.ExtractedBytes),-47}║");
        Console.WriteLine($"║  Estimé:          {FormatBytes(result.EstimatedBytes),-47}║");
        if (result.DiskAborted)
        {
            Console.WriteLine("║  ⚠ Espace:        ARRÊT garde-fou disque (réserve atteinte)      ║");
        }
        Console.WriteLine($"║  Vitesse:         {result.MBPerSecond:F1} MB/s ({result.FilesPerSecond:F0} fichiers/s){GetSpeedPadding(result)}║");

        if (result.LooseFilesCopied > 0)
        {
            Console.WriteLine($"║  Loose files:     {result.LooseFilesCopied} copiés{new string(' ', 40 - result.LooseFilesCopied.ToString().Length)}║");
        }

        if (result.Errors.Count > 0)
        {
            Console.WriteLine($"║  Erreurs:         {result.Errors.Count} (voir ci-dessous){new string(' ', 30 - result.Errors.Count.ToString().Length)}║");
        }

        Console.WriteLine("╚══════════════════════════════════════════════════════════════════╝");

        if (result.Errors.Count > 0)
        {
            Console.WriteLine();
            Console.WriteLine("Erreurs rencontrées:");
            foreach (var error in result.Errors.Take(10))
            {
                Console.WriteLine($"  • {error}");
            }
            if (result.Errors.Count > 10)
            {
                Console.WriteLine($"  ... et {result.Errors.Count - 10} autres erreurs");
            }
        }

        Console.WriteLine();
        Console.WriteLine($"Fichiers extraits vers: {result.OutputPath}");
    }

    private static string GetPadding(DumpResult result)
    {
        var text = $"{result.ExtractedFiles:N0} extraits, {result.SkippedFiles:N0} ignorés";
        return new string(' ', Math.Max(0, 47 - text.Length));
    }

    private static string GetSpeedPadding(DumpResult result)
    {
        var text = $"{result.MBPerSecond:F1} MB/s ({result.FilesPerSecond:F0} fichiers/s)";
        return new string(' ', Math.Max(0, 47 - text.Length));
    }

    private static string FormatDuration(TimeSpan duration)
    {
        if (duration.TotalHours >= 1)
            return $"{duration.Hours}h {duration.Minutes:00}m {duration.Seconds:00}s";
        if (duration.TotalMinutes >= 1)
            return $"{duration.Minutes}m {duration.Seconds:00}s";
        return $"{duration.TotalSeconds:F1}s";
    }

    /// <summary>
    /// Parse une taille humaine (ex: "30G", "500M", "1024K", "2048") en octets.
    /// Renvoie <c>null</c> si <paramref name="text"/> est vide. Lève si le format est invalide.
    /// </summary>
    public static long? ParseSize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        text = text.Trim();
        char suffix = char.ToUpperInvariant(text[^1]);
        long mult = suffix switch
        {
            'K' => 1024L,
            'M' => 1024L * 1024,
            'G' => 1024L * 1024 * 1024,
            'T' => 1024L * 1024 * 1024 * 1024,
            _ => 1
        };
        string num = char.IsLetter(suffix) ? text[..^1] : text;
        if (!double.TryParse(num, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value))
            throw new ArgumentException($"Taille invalide : '{text}' (attendu ex: 30G, 500M, 1024).");
        return (long)(value * mult);
    }

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
        return $"{size:F2} {sizes[order]}";
    }
}
