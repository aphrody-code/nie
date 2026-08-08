using System.CommandLine;
using System.Text.Json;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

public static class G4pkCommand
{
    public static Command Create()
    {
        var command = new Command("g4pk", "Inspect and extract G4PK package files");

        command.AddCommand(CreateExtract());
        command.AddCommand(CreateList());

        return command;
    }

    private static Command CreateExtract()
    {
        var extractCommand = new Command("extract", "Extract files from G4PK");
        var fileArg = new Argument<string>("file", "Path to G4PK file");
        extractCommand.AddArgument(fileArg);

        var outputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory")
        {
            IsRequired = true
        };
        extractCommand.AddOption(outputOption);

        extractCommand.SetHandler((string file, string output) =>
        {
            Extract(file, output);
        }, fileArg, outputOption);

        return extractCommand;
    }

    private static Command CreateList()
    {
        var listCommand = new Command("list", "List sub-files of a G4PK (JSON {name,size,offset,hash,format})");
        var fileArg = new Argument<string>("file", "Path to G4PK file");
        listCommand.AddArgument(fileArg);

        listCommand.SetHandler((string file) =>
        {
            List(file);
        }, fileArg);

        return listCommand;
    }

    private static void Extract(string filePath, string outputDir)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                Console.WriteLine($"File not found: {filePath}");
                return;
            }

            Console.WriteLine($"Extracting: {Path.GetFileName(filePath)}");
            var entries = G4pkParser.ParseFile(filePath);

            Directory.CreateDirectory(outputDir);

            foreach (var entry in entries)
            {
                string outputPath = Path.Combine(outputDir, entry.Name);
                Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
                File.WriteAllBytes(outputPath, entry.Data.ToArray());
                Console.WriteLine($"  Extracted: {entry.Name} ({entry.Size:N0} bytes)");
            }

            Console.WriteLine($"Extracted {entries.Count} files.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
        }
    }

    private static void List(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                Console.Error.WriteLine($"File not found: {filePath}");
                Environment.ExitCode = 1;
                return;
            }

            var entries = G4pkParser.ParseFile(filePath);
            var infos = new G4pkEntryInfo[entries.Count];
            for (int i = 0; i < entries.Count; i++)
            {
                var e = entries[i];
                infos[i] = new G4pkEntryInfo
                {
                    Name = e.Name,
                    Size = e.Size,
                    Offset = e.Offset,
                    Hash = $"0x{e.Hash:X8}",
                    Format = G4pkParser.DetectSubFormat(e.Name, e.Data.Span)
                };
            }

            string json = JsonSerializer.Serialize(infos, JsonContext.Default.G4pkEntryInfoArray);
            Console.WriteLine(json);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            Environment.ExitCode = 1;
        }
    }
}
