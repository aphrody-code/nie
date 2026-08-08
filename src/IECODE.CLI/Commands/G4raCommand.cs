using System.CommandLine;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

/// <summary>
/// CLI command for G4RA (Resource Archive) operations.
/// </summary>
public static class G4raCommand
{
    public static Command Create()
    {
        var command = new Command("g4ra", "G4RA Resource Archive operations");

        // Subcommand: info
        var infoCommand = new Command("info", "Display G4RA archive information");
        var infoFileArg = new Argument<string>("file", "G4RA file to analyze");
        infoCommand.AddArgument(infoFileArg);
        infoCommand.SetHandler(ShowInfo, infoFileArg);
        command.AddCommand(infoCommand);

        // Subcommand: list
        var listCommand = new Command("list", "List resources in G4RA archive");
        var listFileArg = new Argument<string>("file", "G4RA file to list");
        listCommand.AddArgument(listFileArg);

        var jsonOption = new Option<bool>("--json", "Output as JSON");
        listCommand.AddOption(jsonOption);

        listCommand.SetHandler(ListResources, listFileArg, jsonOption);
        command.AddCommand(listCommand);

        // Subcommand: extract
        var extractCommand = new Command("extract", "Extract resources from G4RA archive");
        var extractFileArg = new Argument<string>("file", "G4RA file to extract");
        extractCommand.AddArgument(extractFileArg);

        var outputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory",
            getDefaultValue: () => ".");
        extractCommand.AddOption(outputOption);

        var indexOption = new Option<int?>(
            aliases: ["--index", "-i"],
            description: "Extract specific resource by index");
        extractCommand.AddOption(indexOption);

        extractCommand.SetHandler(ExtractResources, extractFileArg, outputOption, indexOption);
        command.AddCommand(extractCommand);

        return command;
    }

    private static void ShowInfo(string file)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"File not found: {file}");
            return;
        }

        try
        {
            var data = File.ReadAllBytes(file);

            if (!G4raParser.IsG4ra(data))
            {
                Console.Error.WriteLine("Not a valid G4RA file");
                return;
            }

            Console.WriteLine($"\nFile: {Path.GetFileName(file)}");
            Console.WriteLine($"Size: {data.Length:N0} bytes");
            Console.WriteLine();
            Console.WriteLine(G4raParser.GetSummary(data));
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
        }
    }

    private static void ListResources(string file, bool json)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"File not found: {file}");
            return;
        }

        try
        {
            var archive = G4raParser.ParseFile(file);

            if (json)
            {
                var output = archive.Resources.Select(r => new G4raResourceInfo
                {
                    Index = r.Index,
                    Name = r.Name,
                    Offset = r.Offset,
                    Size = r.Size,
                    RefCount = r.RefCount,
                    Flags = r.Flags
                }).ToArray();

                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(output, JsonContext.Default.G4raResourceInfoArray));
            }
            else
            {
                Console.WriteLine($"\n{"Index",-8} {"Name",-40} {"Offset",-12} {"RefCount",-10} {"Flags"}");
                Console.WriteLine(new string('-', 80));

                foreach (var resource in archive.Resources)
                {
                    Console.WriteLine($"{resource.Index,-8} {resource.Name,-40} 0x{resource.Offset:X8}   {resource.RefCount,-10} 0x{resource.Flags:X2}");
                }

                Console.WriteLine($"\nTotal: {archive.Resources.Count} resources");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
        }
    }

    private static void ExtractResources(string file, string output, int? index)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"File not found: {file}");
            return;
        }

        try
        {
            var archive = G4raParser.ParseFile(file);

            if (index.HasValue)
            {
                // Extract single resource
                if (index.Value < 0 || index.Value >= archive.Resources.Count)
                {
                    Console.Error.WriteLine($"Invalid index: {index.Value} (valid: 0-{archive.Resources.Count - 1})");
                    return;
                }

                var resource = archive.Resources[index.Value];
                var data = archive.GetResource(index.Value);

                Directory.CreateDirectory(output);
                var outputPath = Path.Combine(output, resource.Name);

                File.WriteAllBytes(outputPath, data.ToArray());
                Console.WriteLine($"Extracted: {resource.Name} ({data.Length:N0} bytes)");
            }
            else
            {
                // Extract all resources
                var outputDir = output == "."
                    ? Path.Combine(Path.GetDirectoryName(file) ?? ".", Path.GetFileNameWithoutExtension(file))
                    : output;

                archive.ExtractAll(outputDir);
                Console.WriteLine($"Extracted {archive.Resources.Count} resources to: {outputDir}");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
        }
    }
}
