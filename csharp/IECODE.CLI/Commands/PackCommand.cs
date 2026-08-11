using IECODE.Core;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande pack - Pack un mod pour IEVR.
/// </summary>
public static class PackCommand
{
    public static Task ExecuteAsync(string? gamePath, string input, string output, string? cpkList, string platform, bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!Directory.Exists(input))
            {
                Console.Error.WriteLine($"Error: Mod folder not found: {input}");
                Environment.ExitCode = 1;
                return Task.CompletedTask;
            }

            // Resolve cpk_list path
            string cpkListPath = cpkList ?? game.CpkListPath;

            if (!File.Exists(cpkListPath))
            {
                Console.Error.WriteLine($"Error: cpk_list.cfg.bin not found: {cpkListPath}");
                Console.Error.WriteLine("Use --cpklist to specify the path.");
                Environment.ExitCode = 1;
                return Task.CompletedTask;
            }

            Console.WriteLine($"Packing mod from: {input}");
            Console.WriteLine($"Using cpk_list: {cpkListPath}");
            Console.WriteLine($"Platform: {platform}");
            Console.WriteLine($"Output: {output}");
            Console.WriteLine();

            // Read cpk_list
            var cpkListData = game.CfgBin.ReadCpkList();

            // Get mod files
            var modFiles = Directory.GetFiles(input, "*", SearchOption.AllDirectories)
                .Where(f => !f.EndsWith("cpk_list.cfg.bin", StringComparison.OrdinalIgnoreCase))
                .ToList();

            Console.WriteLine($"Found {modFiles.Count} files to pack");

            // Create output structure
            string outputRoot = platform.Equals("SWITCH", StringComparison.OrdinalIgnoreCase)
                ? Path.Combine(output, "romfs")
                : output;

            Directory.CreateDirectory(outputRoot);

            int processed = 0;
            foreach (var file in modFiles)
            {
                processed++;
                string relativePath = Path.GetRelativePath(input, file).Replace('\\', '/');

                if (verbose)
                {
                    Console.WriteLine($"  [{processed}/{modFiles.Count}] {relativePath}");
                }

                string destPath = Path.Combine(outputRoot, relativePath);
                Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
                File.Copy(file, destPath, true);
            }

            // Update and save cpk_list
            // TODO: Implement cpk_list update logic from Viola

            Console.WriteLine();
            Console.WriteLine($"Done! Mod packed to: {Path.GetFullPath(output)}");
            Console.WriteLine();
            Console.WriteLine("Note: Install by copying the output folder contents to your game directory.");
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
        return Task.CompletedTask;
    }
}
