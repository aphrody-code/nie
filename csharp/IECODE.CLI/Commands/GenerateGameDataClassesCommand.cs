using System.CommandLine;
using System.Text;
using System.Text.Json;
using IECODE.Core.GameData;

namespace IECODE.CLI.Commands;

public static class GenerateGameDataClassesCommand
{
    public static Command Create()
    {
        var command = new Command("generate-classes", "Generate C# classes from gamedata JSON files");

        var inputOption = new Option<string>(
            aliases: ["--input", "-i"],
            description: "Path to gamedata_json folder")
        {
            IsRequired = true
        };
        command.AddOption(inputOption);

        var outputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory for .cs files")
        {
            IsRequired = true
        };
        command.AddOption(outputOption);

        command.SetHandler(Execute, inputOption, outputOption);

        return command;
    }

    private static void Execute(string inputPath, string outputPath)
    {
        if (!Directory.Exists(inputPath))
        {
            Console.Error.WriteLine($"Input directory not found: {inputPath}");
            return;
        }

        if (!Directory.Exists(outputPath))
        {
            Directory.CreateDirectory(outputPath);
        }

        var files = Directory.GetFiles(inputPath, "*.json", SearchOption.AllDirectories);
        var processedTypes = new HashSet<string>();
        var sb = new StringBuilder();

        Console.WriteLine($"Found {files.Length} JSON files. Analyzing...");

        foreach (var file in files)
        {
            try
            {
                AnalyzeAndGenerate(file, outputPath, processedTypes);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error processing {file}: {ex.Message}");
            }
        }

        Console.WriteLine($"Generated classes for {processedTypes.Count} types.");
    }

    private static void AnalyzeAndGenerate(string filePath, string outputPath, HashSet<string> processedTypes)
    {
        // Read first part of file to get structure
        // We don't want to load 50MB JSONs into memory if we can avoid it
        // But System.Text.Json requires valid JSON.
        // Let's assume we can read the file.

        var json = File.ReadAllText(filePath);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (!root.TryGetProperty("Entries", out var entries)) return;

        foreach (var entry in entries.EnumerateArray())
        {
            if (entry.TryGetProperty("Children", out var children))
            {
                foreach (var child in children.EnumerateArray())
                {
                    GenerateClassForEntry(child, outputPath, processedTypes);
                }
            }
        }
    }

    private static void GenerateClassForEntry(JsonElement entry, string outputPath, HashSet<string> processedTypes)
    {
        if (!entry.TryGetProperty("Name", out var nameProp)) return;
        string entryName = nameProp.GetString() ?? "Unknown";

        // Clean up name (remove _0, _1 suffix if present)
        string className = entryName;
        if (className.EndsWith("_0")) className = className[..^2];

        // Convert to PascalCase
        className = ToPascalCase(className);

        if (processedTypes.Contains(className)) return;
        processedTypes.Add(className);

        if (!entry.TryGetProperty("Variables", out var variables)) return;

        var sb = new StringBuilder();
        sb.AppendLine("using IECODE.Core.Formats.Level5.CfgBin.Level5.Binary.Logic;");
        sb.AppendLine("using IECODE.Core.GameData;");
        sb.AppendLine();
        sb.AppendLine("namespace IECODE.Core.GameData.Generated;");
        sb.AppendLine();
        sb.AppendLine($"public class {className} : GameDataEntry");
        sb.AppendLine("{");

        // Properties
        int index = 0;
        foreach (var variable in variables.EnumerateArray())
        {
            string type = variable.GetProperty("Type").GetString() ?? "Int";
            string propName = $"Variable_{index}"; // Default name
            string propType = "int";

            switch (type)
            {
                case "Int":
                    propType = "int";
                    break;
                case "Float":
                    propType = "float";
                    break;
                case "String":
                    propType = "string";
                    break;
            }

            sb.AppendLine($"    public {propType} {propName} {{ get; set; }}");
            index++;
        }

        sb.AppendLine();
        sb.AppendLine($"    public {className}(Entry entry) : base(entry) {{ }}");
        sb.AppendLine();
        sb.AppendLine("    protected override void MapFromEntry(Entry entry)");
        sb.AppendLine("    {");

        index = 0;
        foreach (var variable in variables.EnumerateArray())
        {
            string type = variable.GetProperty("Type").GetString() ?? "Int";
            string getter = "GetInt";
            switch (type)
            {
                case "Int": getter = "GetInt"; break;
                case "Float": getter = "GetFloat"; break;
                case "String": getter = "GetString"; break;
            }

            sb.AppendLine($"        Variable_{index} = {getter}(entry, {index});");
            index++;
        }

        sb.AppendLine("    }");
        sb.AppendLine("}");

        File.WriteAllText(Path.Combine(outputPath, $"{className}.cs"), sb.ToString());
        Console.WriteLine($"Generated {className}.cs");
    }

    private static string ToPascalCase(string text)
    {
        var parts = text.Split('_');
        for (int i = 0; i < parts.Length; i++)
        {
            if (parts[i].Length > 0)
            {
                parts[i] = char.ToUpper(parts[i][0]) + parts[i].Substring(1).ToLower();
            }
        }
        return string.Join("", parts);
    }
}

