using IECODE.Core;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande analyze - Analyse de la structure du jeu.
/// </summary>
public static class AnalyzeCommand
{
    public static async Task ExecuteAsync(string? gamePath, string? output, bool deep, bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!game.IsValid)
            {
                Console.Error.WriteLine($"Error: Game not found at: {game.GamePath}");
                Environment.ExitCode = 1;
                return;
            }

            Console.WriteLine($"Analyzing: {game.GamePath}");
            Console.WriteLine();

            var info = await game.LoadInfoAsync();

            // Basic stats
            Console.WriteLine("╔══════════════════════════════════════════════════════════════╗");
            Console.WriteLine("║                    IEVR Game Analysis                        ║");
            Console.WriteLine("╚══════════════════════════════════════════════════════════════╝");
            Console.WriteLine();

            Console.WriteLine("📁 File System:");
            Console.WriteLine($"   CPK Archives: {info.CpkCount}");
            Console.WriteLine($"   Total Size: {info.TotalCpkSizeFormatted}");
            Console.WriteLine();

            // Analyze CPK contents
            Console.WriteLine("📦 CPK Analysis:");

            var cpkFiles = game.Cpk.GetAllCpkFiles().Take(deep ? 1000 : 10).ToList();
            int totalFiles = 0;
            var extensions = new Dictionary<string, int>();

            foreach (var cpk in cpkFiles)
            {
                try
                {
                    var files = game.Cpk.GetFilesInCpk(cpk);
                    totalFiles += files.Length;

                    foreach (var file in files)
                    {
                        string ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                        if (string.IsNullOrEmpty(ext)) ext = "(no ext)";

                        if (extensions.TryGetValue(ext, out int count))
                        {
                            extensions[ext] = count + 1;
                        }
                        else
                        {
                            extensions[ext] = 1;
                        }
                    }

                    if (verbose)
                    {
                        Console.WriteLine($"   {Path.GetFileName(cpk)}: {files.Length} files");
                    }
                }
                catch
                {
                    // Skip problematic CPKs
                }
            }

            Console.WriteLine($"   Analyzed {cpkFiles.Count} CPKs, {totalFiles} files");
            Console.WriteLine();

            Console.WriteLine("📊 File Types:");
            foreach (var ext in extensions.OrderByDescending(e => e.Value).Take(15))
            {
                Console.WriteLine($"   {ext.Key,-15} : {ext.Value,6} files");
            }
            Console.WriteLine();

            // Read cpk_list if available
            if (info.HasCpkList)
            {
                Console.WriteLine("📋 CPK List (cpk_list.cfg.bin):");
                try
                {
                    var cpkList = game.CfgBin.ReadCpkList();
                    var looseFiles = cpkList.Files.Where(f => f.IsLoose).ToList();
                    var packFiles = cpkList.Files.Where(f => !f.IsLoose).ToList();
                    var uniqueCpks = packFiles.Select(f => f.CpkName).Distinct().ToList();

                    Console.WriteLine($"   Total entries: {cpkList.Files.Count}");
                    Console.WriteLine($"   Loose files: {looseFiles.Count}");
                    Console.WriteLine($"   Packed files: {packFiles.Count}");
                    Console.WriteLine($"   Unique CPKs: {uniqueCpks.Count}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"   Error reading: {ex.Message}");
                }
            }
            Console.WriteLine();

            // Save JSON report
            if (!string.IsNullOrEmpty(output))
            {
                var report = new GameAnalysisReport
                {
                    GamePath = info.GamePath,
                    PacksPath = info.GamePath,
                    CpkCount = info.CpkCount,
                    TotalCpkSize = info.TotalCpkSize,
                    AnalyzedAt = DateTime.UtcNow,
                    FileTypes = extensions.OrderByDescending(e => e.Value).ToDictionary(e => e.Key, e => e.Value)
                };

                string json = System.Text.Json.JsonSerializer.Serialize(report, JsonContext.Default.GameAnalysisReport);

                await File.WriteAllTextAsync(output, json);
                Console.WriteLine($"Report saved to: {output}");
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
}
