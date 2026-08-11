using IECODE.Core;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande info - Affiche les informations sur le jeu.
/// </summary>
public static class InfoCommand
{
    public static async Task ExecuteAsync(string? gamePath, bool verbose, bool json)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!game.IsValid)
            {
                Console.Error.WriteLine($"Error: Game not found at: {game.GamePath}");
                Console.Error.WriteLine("Use --game to specify the game directory.");
                Environment.ExitCode = 1;
                return;
            }

            if (verbose)
            {
                Console.WriteLine($"Loading game info from: {game.GamePath}");
            }

            var info = await game.LoadInfoAsync();

            if (json)
            {
                Console.WriteLine(await game.ExportInfoAsJsonAsync());
            }
            else
            {
                Console.WriteLine();
                Console.WriteLine("╔══════════════════════════════════════════════════════════════════╗");
                Console.WriteLine("║           IECODE - Inazuma Eleven Victory Road Info              ║");
                Console.WriteLine("╚══════════════════════════════════════════════════════════════════╝");
                Console.WriteLine();
                Console.WriteLine($"  Game Path:        {info.GamePath}");
                Console.WriteLine($"  Executable:       {Path.GetFileName(info.ExecutablePath)}");
                Console.WriteLine($"  Executable Size:  {FormatBytes(info.ExecutableSize)}");
                Console.WriteLine($"  Last Modified:    {info.ExecutableModified:yyyy-MM-dd HH:mm:ss}");
                Console.WriteLine();
                Console.WriteLine($"  CPK Archives:     {info.CpkCount}");
                Console.WriteLine($"  Total CPK Size:   {info.TotalCpkSizeFormatted}");
                Console.WriteLine($"  Has cpk_list:     {(info.HasCpkList ? "Yes" : "No")}");
                Console.WriteLine();
            }
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

    private static string FormatBytes(long bytes)
    {
        string[] sizes = ["B", "KB", "MB", "GB"];
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
