using System.CommandLine;
using IECODE.Core.Formats;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

/// <summary>
/// CLI command for format detection and analysis.
/// </summary>
public static class FormatCommand
{
    public static Command Create()
    {
        var command = new Command("format", "Detect and analyze file formats");

        // Subcommand: detect
        var detectCommand = new Command("detect", "Detect format of a file or directory");
        var pathArg = new Argument<string>("path", "File or directory to analyze");
        detectCommand.AddArgument(pathArg);

        var recursiveOption = new Option<bool>(
            aliases: ["--recursive", "-r"],
            description: "Recursively scan directories");
        detectCommand.AddOption(recursiveOption);

        var jsonOption = new Option<bool>("--json", "Output as JSON");
        detectCommand.AddOption(jsonOption);

        detectCommand.SetHandler(DetectFormat, pathArg, recursiveOption, jsonOption);
        command.AddCommand(detectCommand);

        // Subcommand: list
        var listCommand = new Command("list", "List all supported formats");
        listCommand.SetHandler(ListFormats);
        command.AddCommand(listCommand);

        // Subcommand: info
        var infoCommand = new Command("info", "Show detailed format information");
        var infoFileArg = new Argument<string>("file", "File to analyze");
        infoCommand.AddArgument(infoFileArg);
        infoCommand.SetHandler(ShowFormatInfo, infoFileArg);
        command.AddCommand(infoCommand);

        return command;
    }

    private static void DetectFormat(string path, bool recursive, bool json)
    {
        var results = new List<(string Path, FormatDetector.FormatInfo Info)>();

        if (File.Exists(path))
        {
            var info = FormatDetector.DetectFromFile(path);
            results.Add((path, info));
        }
        else if (Directory.Exists(path))
        {
            var searchOption = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            foreach (var file in Directory.EnumerateFiles(path, "*", searchOption))
            {
                try
                {
                    var info = FormatDetector.DetectFromFile(file);
                    results.Add((file, info));
                }
                catch
                {
                    // Skip unreadable files
                }
            }
        }
        else
        {
            Console.Error.WriteLine($"Path not found: {path}");
            return;
        }

        if (json)
        {
            OutputJson(results);
        }
        else
        {
            OutputTable(results);
        }
    }

    private static void OutputTable(List<(string Path, FormatDetector.FormatInfo Info)> results)
    {
        // Group by format
        var grouped = results
            .GroupBy(r => r.Info.Format)
            .OrderByDescending(g => g.Count());

        Console.WriteLine($"\n{"Format",-12} {"Count",-8} {"Extension",-10} {"Description"}");
        Console.WriteLine(new string('-', 60));

        foreach (var group in grouped)
        {
            var first = group.First().Info;
            Console.WriteLine($"{group.Key,-12} {group.Count(),-8} {first.Extension,-10} {first.Description}");
        }

        Console.WriteLine($"\nTotal: {results.Count} files");

        // Show unknown files if any
        var unknowns = results.Where(r => r.Info.Format == FormatDetector.Format.Unknown).ToList();
        if (unknowns.Count > 0 && unknowns.Count <= 10)
        {
            Console.WriteLine("\nUnknown files:");
            foreach (var (filePath, _) in unknowns.Take(10))
            {
                Console.WriteLine($"  {Path.GetFileName(filePath)}");
            }
        }
    }

    private static void OutputJson(List<(string Path, FormatDetector.FormatInfo Info)> results)
    {
        var output = results.Select(r => new FormatDetectionResult
        {
            Path = r.Path,
            Format = r.Info.Format.ToString(),
            Extension = r.Info.Extension,
            Description = r.Info.Description,
            IsBigEndian = r.Info.IsBigEndian
        }).ToArray();

        var json = System.Text.Json.JsonSerializer.Serialize(output, JsonContext.Default.FormatDetectionResultArray);
        Console.WriteLine(json);
    }

    private static void ListFormats()
    {
        Console.WriteLine("\nSupported Formats");
        Console.WriteLine("=================\n");

        Console.WriteLine($"{"Format",-12} {"Extension",-10} {"Magic (BE)",-12} {"Description"}");
        Console.WriteLine(new string('-', 70));

        foreach (var info in FormatDetector.GetSupportedFormats())
        {
            Console.WriteLine($"{info.Format,-12} {info.Extension,-10} 0x{info.MagicBE:X8}   {info.Description}");
        }
    }

    private static void ShowFormatInfo(string file)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"File not found: {file}");
            return;
        }

        var data = File.ReadAllBytes(file);
        var info = FormatDetector.Detect(data);

        Console.WriteLine($"\nFile: {Path.GetFileName(file)}");
        Console.WriteLine($"Size: {data.Length:N0} bytes");
        Console.WriteLine($"Format: {info.Format}");
        Console.WriteLine($"Extension: {info.Extension}");
        Console.WriteLine($"Description: {info.Description}");
        Console.WriteLine($"Endianness: {(info.IsBigEndian ? "Big-Endian" : "Little-Endian")}");

        // Show format-specific info
        switch (info.Format)
        {
            case FormatDetector.Format.G4MD:
                ShowG4mdInfo(data);
                break;
            case FormatDetector.Format.G4TX:
                ShowG4txInfo(data);
                break;
            case FormatDetector.Format.G4RA:
                ShowG4raInfo(data);
                break;
            case FormatDetector.Format.AGI:
                ShowAgiInfo(data);
                break;
        }
    }

    private static void ShowG4mdInfo(byte[] data)
    {
        try
        {
            var parser = new G4mdParser();
            parser.Parse(data);
            Console.WriteLine($"\n{parser.GetSummary()}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"\nError parsing G4MD: {ex.Message}");
        }
    }

    private static void ShowG4txInfo(byte[] data)
    {
        try
        {
            var textures = G4txParser.ParseTextures(data);
            Console.WriteLine($"\nTextures: {textures.Count}");
            foreach (var tex in textures.Take(10))
            {
                Console.WriteLine($"  - {tex.Name}: {tex.Width}x{tex.Height} (Format: {tex.Format})");
            }
            if (textures.Count > 10)
                Console.WriteLine($"  ... and {textures.Count - 10} more");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"\nError parsing G4TX: {ex.Message}");
        }
    }

    private static void ShowG4raInfo(byte[] data)
    {
        try
        {
            Console.WriteLine($"\n{G4raParser.GetSummary(data)}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"\nError parsing G4RA: {ex.Message}");
        }
    }

    private static void ShowAgiInfo(byte[] data)
    {
        try
        {
            Console.WriteLine($"\n{AgiParser.GetSummary(data)}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"\nError parsing AGI: {ex.Message}");
        }
    }
}
