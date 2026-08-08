using IECODE.Core;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande extract - Extraction de fichiers depuis un CPK.
/// </summary>
public static class ExtractCommand
{
    public static async Task ExecuteAsync(string? gamePath, string cpk, string output, string? filter, bool listOnly, bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            // Resolve CPK path
            string cpkPath = ResolveCpkPath(game, cpk);

            if (!File.Exists(cpkPath))
            {
                Console.Error.WriteLine($"Error: CPK file not found: {cpkPath}");
                Environment.ExitCode = 1;
                return;
            }

            Console.WriteLine($"CPK: {cpkPath}");

            var files = game.Cpk.GetFilesInCpk(cpkPath);

            // Apply filter
            if (!string.IsNullOrEmpty(filter))
            {
                string pattern = filter.Replace("*", ".*").Replace("?", ".");
                var regex = new System.Text.RegularExpressions.Regex(pattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                files = files.Where(f => regex.IsMatch(f.FullPath)).ToArray();
            }

            Console.WriteLine($"Files: {files.Length}");
            Console.WriteLine();

            if (listOnly)
            {
                // List mode
                Console.WriteLine("Directory/File                                              Size          Compressed");
                Console.WriteLine(new string('-', 90));

                foreach (var file in files.OrderBy(f => f.FullPath))
                {
                    string sizeStr = FormatBytes(file.ExtractSize);
                    string compStr = file.IsCompressed ? $"({FormatBytes(file.FileSize)})" : "";
                    Console.WriteLine($"{file.FullPath,-55} {sizeStr,12}  {compStr}");
                }

                Console.WriteLine();
                Console.WriteLine($"Total: {files.Length} files, {FormatBytes(files.Sum(f => f.ExtractSize))}");
            }
            else
            {
                // Extract mode
                Directory.CreateDirectory(output);

                var progress = new Progress<(int current, int total, string fileName)>(p =>
                {
                    Console.Write($"\r[{p.current}/{p.total}] {p.fileName,-60}");
                });

                await game.Cpk.ExtractAllAsync(cpkPath, output, progress);

                Console.WriteLine();
                Console.WriteLine();
                Console.WriteLine($"Done! Extracted {files.Length} files to: {Path.GetFullPath(output)}");
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

    private static string ResolveCpkPath(IEVRGame game, string cpk)
    {
        // If absolute path or file exists, use as-is
        if (Path.IsPathRooted(cpk) || File.Exists(cpk))
        {
            return cpk;
        }

        // Try relative to packs folder
        string packsPath = Path.Combine(game.PacksPath, cpk);
        if (File.Exists(packsPath))
        {
            return packsPath;
        }

        // Try relative to game data folder
        string dataPath = Path.Combine(game.DataPath, cpk);
        if (File.Exists(dataPath))
        {
            return dataPath;
        }

        // Return as-is (will fail with file not found)
        return cpk;
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
