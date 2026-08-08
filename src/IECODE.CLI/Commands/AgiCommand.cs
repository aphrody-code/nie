using System.CommandLine;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

/// <summary>
/// CLI command for AGI (Animation/Graphics Info) operations.
/// </summary>
public static class AgiCommand
{
    public static Command Create()
    {
        var command = new Command("agi", "AGI Animation/Graphics Info operations");

        // Subcommand: info
        var infoCommand = new Command("info", "Display AGI file information");
        var infoFileArg = new Argument<string>("file", "AGI file to analyze");
        infoCommand.AddArgument(infoFileArg);

        var verboseOption = new Option<bool>(
            aliases: ["--verbose", "-v"],
            description: "Show detailed information");
        infoCommand.AddOption(verboseOption);

        infoCommand.SetHandler(ShowInfo, infoFileArg, verboseOption);
        command.AddCommand(infoCommand);

        // Subcommand: dump
        var dumpCommand = new Command("dump", "Dump raw AGI data as hex");
        var dumpFileArg = new Argument<string>("file", "AGI file to dump");
        dumpCommand.AddArgument(dumpFileArg);

        var offsetOption = new Option<int>(
            aliases: ["--offset", "-o"],
            description: "Start offset",
            getDefaultValue: () => 0);
        dumpCommand.AddOption(offsetOption);

        var lengthOption = new Option<int>(
            aliases: ["--length", "-l"],
            description: "Number of bytes to dump",
            getDefaultValue: () => 256);
        dumpCommand.AddOption(lengthOption);

        dumpCommand.SetHandler(DumpHex, dumpFileArg, offsetOption, lengthOption);
        command.AddCommand(dumpCommand);

        // Subcommand: batch
        var batchCommand = new Command("batch", "Analyze multiple AGI files");
        var batchDirArg = new Argument<string>("directory", "Directory containing AGI files");
        batchCommand.AddArgument(batchDirArg);

        var recursiveOption = new Option<bool>(
            aliases: ["--recursive", "-r"],
            description: "Recursively search directories");
        batchCommand.AddOption(recursiveOption);

        batchCommand.SetHandler(BatchAnalyze, batchDirArg, recursiveOption);
        command.AddCommand(batchCommand);

        return command;
    }

    private static void ShowInfo(string file, bool verbose)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"File not found: {file}");
            return;
        }

        try
        {
            var data = File.ReadAllBytes(file);

            if (!AgiParser.IsAgi(data))
            {
                Console.Error.WriteLine("Not a valid AGI file");
                return;
            }

            var anim = AgiParser.Parse(data);

            Console.WriteLine($"\nFile: {Path.GetFileName(file)}");
            Console.WriteLine($"Size: {data.Length:N0} bytes");
            Console.WriteLine();
            Console.WriteLine(AgiParser.GetSummary(data));

            if (verbose)
            {
                Console.WriteLine("\nDetailed Information");
                Console.WriteLine("--------------------");
                Console.WriteLine($"Magic: 0x{anim.Header.Magic:X8}");
                Console.WriteLine($"Flags: 0x{anim.Header.Flags:X8}");
                Console.WriteLine($"Data Size: {anim.Header.DataSize:N0}");

                Console.WriteLine($"\nBounds:");
                Console.WriteLine($"  Left: {anim.Bounds.Left:F4}");
                Console.WriteLine($"  Top: {anim.Bounds.Top:F4}");
                Console.WriteLine($"  Right: {anim.Bounds.Right:F4}");
                Console.WriteLine($"  Bottom: {anim.Bounds.Bottom:F4}");
                Console.WriteLine($"  Flags: 0x{anim.Bounds.BoundsFlags:X8}");

                // Show first 64 bytes as hex for debugging
                Console.WriteLine("\nHeader Hex Dump:");
                var headerBytes = data.AsSpan(0, Math.Min(64, data.Length));
                for (int i = 0; i < headerBytes.Length; i += 16)
                {
                    Console.Write($"  {i:X4}: ");
                    for (int j = 0; j < 16 && i + j < headerBytes.Length; j++)
                    {
                        Console.Write($"{headerBytes[i + j]:X2} ");
                    }
                    Console.WriteLine();
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
        }
    }

    private static void DumpHex(string file, int offset, int length)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"File not found: {file}");
            return;
        }

        try
        {
            var data = File.ReadAllBytes(file);

            if (offset >= data.Length)
            {
                Console.Error.WriteLine($"Offset {offset} exceeds file size {data.Length}");
                return;
            }

            int actualLength = Math.Min(length, data.Length - offset);

            Console.WriteLine($"\nHex dump of {Path.GetFileName(file)} [0x{offset:X}-0x{offset + actualLength:X}]:");
            Console.WriteLine();

            for (int i = 0; i < actualLength; i += 16)
            {
                Console.Write($"{offset + i:X8}: ");

                // Hex bytes
                for (int j = 0; j < 16; j++)
                {
                    if (i + j < actualLength)
                        Console.Write($"{data[offset + i + j]:X2} ");
                    else
                        Console.Write("   ");

                    if (j == 7) Console.Write(" ");
                }

                Console.Write(" |");

                // ASCII representation
                for (int j = 0; j < 16 && i + j < actualLength; j++)
                {
                    byte b = data[offset + i + j];
                    Console.Write(b >= 32 && b < 127 ? (char)b : '.');
                }

                Console.WriteLine("|");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
        }
    }

    private static void BatchAnalyze(string directory, bool recursive)
    {
        if (!Directory.Exists(directory))
        {
            Console.Error.WriteLine($"Directory not found: {directory}");
            return;
        }

        var searchOption = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        var files = Directory.EnumerateFiles(directory, "*.agi", searchOption)
            .Concat(Directory.EnumerateFiles(directory, "*", searchOption)
                .Where(f => IsAgiFile(f)));

        var results = new List<(string Path, AgiParser.AgiAnimation? Anim, string? Error)>();

        foreach (var file in files)
        {
            try
            {
                var data = File.ReadAllBytes(file);
                if (AgiParser.IsAgi(data))
                {
                    var anim = AgiParser.Parse(data);
                    results.Add((file, anim, null));
                }
            }
            catch (Exception ex)
            {
                results.Add((file, null, ex.Message));
            }
        }

        if (results.Count == 0)
        {
            Console.WriteLine("No AGI files found.");
            return;
        }

        Console.WriteLine($"\n{"File",-50} {"Version",-10} {"Frames",-10} {"Duration",-12} {"Tracks"}");
        Console.WriteLine(new string('-', 100));

        foreach (var (path, anim, error) in results)
        {
            var name = Path.GetFileName(path);
            if (name.Length > 48) name = name[..45] + "...";

            if (anim != null)
            {
                Console.WriteLine($"{name,-50} {anim.Header.Version,-10} {anim.Header.FrameCount,-10} {anim.Header.Duration,-12:F2}s {anim.Header.TrackCount}");
            }
            else
            {
                Console.WriteLine($"{name,-50} ERROR: {error}");
            }
        }

        Console.WriteLine($"\nTotal: {results.Count(r => r.Anim != null)} valid AGI files");
        if (results.Any(r => r.Error != null))
        {
            Console.WriteLine($"Errors: {results.Count(r => r.Error != null)} files");
        }
    }

    private static bool IsAgiFile(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            Span<byte> header = stackalloc byte[4];
            if (fs.Read(header) < 4) return false;
            return AgiParser.IsAgi(header);
        }
        catch
        {
            return false;
        }
    }
}
