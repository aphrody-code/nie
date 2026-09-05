using System.CommandLine;
using System.Text.Json;
using System.Text.Json.Serialization;
using IECODE.Core.GameData;

namespace IECODE.CLI.Commands;

public static class SearchCommand
{
    // Keep JSON types for backward compatibility
    public class Variable
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "";
        [JsonPropertyName("value")]
        public string Value { get; set; } = "";
    }

    public class Entry
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = "";
        [JsonPropertyName("variables")]
        public List<Variable> Variables { get; set; } = new();
        [JsonPropertyName("children")]
        public List<Entry> Children { get; set; } = new();
    }

    public class Root
    {
        [JsonPropertyName("entries")]
        public List<Entry> Entries { get; set; } = new();
    }

    public static Command Create()
    {
        var command = new Command("search-char", "Search character data in Level-5 game data");

        var queryArg = new Argument<string>("query", "Name or ID to search for");
        command.AddArgument(queryArg);

        var dumpOption = new Option<string?>(
            aliases: ["--dump", "-d"],
            description: "Path to dump folder (auto-detects NIE_GAME_DIR or current directory)");
        command.AddOption(dumpOption);

        var langOption = new Option<string>(
            aliases: ["--lang", "-l"],
            description: "Language (fr, de, en, ja, etc.)",
            getDefaultValue: () => "fr");
        command.AddOption(langOption);

        var jsonOption = new Option<bool>(
            aliases: ["--json", "-j"],
            description: "Output as JSON");
        command.AddOption(jsonOption);

        command.SetHandler(Execute, queryArg, dumpOption, langOption, jsonOption);

        return command;
    }

    private static void Execute(string query, string? dumpPath, string language, bool jsonOutput)
    {
        try
        {
            var pipeline = new CharacterDataPipeline();

            Console.WriteLine($"Loading character data ({language})...");
            pipeline.Load(dumpPath, language);

            Console.WriteLine($"Searching for \"{query}\"...");
            var results = pipeline.Search(query);

            if (jsonOutput)
            {
                OutputJson(results);
            }
            else
            {
                OutputTable(results);
            }
        }
        catch (FileNotFoundException ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Console.Error.WriteLine("Make sure the dump folder contains extracted cfg.bin files.");
            Console.Error.WriteLine("Use: iecode dump --output <dump-folder>");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
        }
    }

    private static void OutputTable(List<CharacterSearchResult> results)
    {
        Console.WriteLine($"Found {results.Count} matches:");
        foreach (var r in results)
        {
            Console.WriteLine("------------------------------------------------");
            Console.WriteLine($"Name:     {r.Name}");
            Console.WriteLine($"CRC32:    {r.Crc32} (Hex: {r.Crc32Hex})");
            if (!string.IsNullOrEmpty(r.ModelId))
            {
                Console.WriteLine($"Model ID: {r.ModelId}");
            }
        }
    }

    private static void OutputJson(List<CharacterSearchResult> results)
    {
        var output = results.Select(r => new CharacterSearchOutput
        {
            Name = r.Name,
            Crc32 = r.Crc32,
            Crc32Hex = r.Crc32Hex,
            ModelId = r.ModelId
        }).ToArray();

        Console.WriteLine(JsonSerializer.Serialize(output, JsonContext.Default.CharacterSearchOutputArray));
    }
}
