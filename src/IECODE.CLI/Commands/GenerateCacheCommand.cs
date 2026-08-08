using System.CommandLine;
using IECODE.Core.GameData;

namespace IECODE.CLI.Commands;

public static class GenerateCacheCommand
{
    public static Command Create()
    {
        var command = new Command("generate-cache", "Generate optimized cache files from dumped game data");

        var typeOption = new Option<string>(
            aliases: ["--type", "-t"],
            description: "Type of cache to generate (character)",
            getDefaultValue: () => "character");
        command.AddOption(typeOption);

        var dumpOption = new Option<string?>(
            aliases: ["--dump", "-d"],
            description: "Path to dump folder (auto-detects C:\\iecode\\dump)");
        command.AddOption(dumpOption);

        var outputOption = new Option<string?>(
            aliases: ["--output", "-o"],
            description: "Output JSON file path (default: character_names_localized.json)");
        command.AddOption(outputOption);

        command.SetHandler(ExecuteAsync, typeOption, dumpOption, outputOption);

        return command;
    }

    private static async Task ExecuteAsync(string type, string? dumpPath, string? outputPath)
    {
        try
        {
            string basePath = ResolveDumpPath(dumpPath);
            Console.WriteLine($"Using dump path: {basePath}");

            if (type.ToLower() == "character")
            {
                string outputFile = outputPath ?? "character_names_localized.json";
                Console.WriteLine("Initializing CharacterNameResolver...");

                using var resolver = new CharacterNameResolver();
                int count = await resolver.LoadFromGameDataAsync(basePath);

                Console.WriteLine($"Loaded {count} characters. Generating cache...");
                await resolver.ExportToCacheAsync(outputFile);

                Console.WriteLine($"Cache generated successfully at: {Path.GetFullPath(outputFile)}");
            }
            else
            {
                Console.Error.WriteLine($"Unknown cache type: {type}. Supported: character");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Console.Error.WriteLine(ex.StackTrace);
        }
    }

    private static string ResolveDumpPath(string? userPath)
    {
        if (!string.IsNullOrEmpty(userPath) && Directory.Exists(userPath))
            return userPath;

        string[] defaultPaths = [@"C:\iecode\dump", @"C:\iecode", Directory.GetCurrentDirectory()];
        foreach (var path in defaultPaths)
        {
            if (Directory.Exists(Path.Combine(path, "data")))
                return path;
        }

        throw new DirectoryNotFoundException("Dump folder not found. Specify path with --dump option. Ensure 'data' folder exists inside.");
    }
}
