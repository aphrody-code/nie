using System.CommandLine;
using System.Threading.Channels;
using IECODE.Core.Formats.Level5;
using IECODE.Core.Converters;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande pour parser les fichiers G4TX (Level-5 Graphics 4 Texture).
/// </summary>
public static class G4txCommand
{
    public static Command Create()
    {
        var command = new Command("g4tx", "Parse and extract G4TX texture files");

        // Subcommand: info
        var infoCommand = new Command("info", "Display G4TX file information");
        var infoFileArg = new Argument<string>("file", "Path to G4TX file");
        infoCommand.AddArgument(infoFileArg);

        infoCommand.SetHandler((string file) =>
        {
            Info(file);
        }, infoFileArg);

        command.AddCommand(infoCommand);

        // Subcommand: extract
        var extractCommand = new Command("extract", "Extract textures from G4TX");
        var extractFileArg = new Argument<string>("file", "Path to G4TX file");
        extractCommand.AddArgument(extractFileArg);
        var outputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory")
        {
            IsRequired = true
        };
        extractCommand.AddOption(outputOption);
        var formatOption = new Option<string>(
            aliases: ["--format", "-f"],
            description: "Output format: dds, png, or webp",
            getDefaultValue: () => "dds");
        extractCommand.AddOption(formatOption);

        extractCommand.SetHandler((string file, string output, string format) =>
        {
            Extract(file, output, format);
        }, extractFileArg, outputOption, formatOption);

        command.AddCommand(extractCommand);

        // Subcommand: batch
        var batchCommand = new Command("batch", "Extract all G4TX files from a directory");
        var batchDirArg = new Argument<string>("directory", "Directory containing G4TX files");
        batchCommand.AddArgument(batchDirArg);
        var batchOutputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory")
        {
            IsRequired = true
        };
        batchCommand.AddOption(batchOutputOption);
        var recursiveOption = new Option<bool>(
            aliases: ["--recursive", "-r"],
            description: "Search recursively");
        batchCommand.AddOption(recursiveOption);
        var threadsOption = new Option<int>(
            aliases: ["--threads", "-t"],
            getDefaultValue: () => Environment.ProcessorCount,
            description: "Number of parallel threads");
        batchCommand.AddOption(threadsOption);
        var batchFormatOption = new Option<string>(
            aliases: ["--format", "-f"],
            description: "Output format: dds, png, or webp",
            getDefaultValue: () => "dds");
        batchCommand.AddOption(batchFormatOption);

        batchCommand.SetHandler((string directory, string output, bool recursive, int threads, string format) =>
        {
            BatchExtract(directory, output, recursive, threads, format);
        }, batchDirArg, batchOutputOption, recursiveOption, threadsOption, batchFormatOption);

        command.AddCommand(batchCommand);

        return command;
    }

    private static void Info(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                Console.WriteLine($"❌ File not found: {filePath}");
                return;
            }

            Console.WriteLine($"📄 Analyzing: {Path.GetFileName(filePath)}");
            Console.WriteLine();

            var textures = G4txParser.ParseFile(filePath);

            Console.WriteLine($"✅ Found {textures.Count} texture(s):");
            Console.WriteLine();

            for (int i = 0; i < textures.Count; i++)
            {
                var tex = textures[i];
                Console.WriteLine($"  Texture #{i + 1}: {tex.Name}");
                Console.WriteLine($"    • Dimensions:  {tex.Width}x{tex.Height}");
                Console.WriteLine($"    • Format:      0x{tex.Format:X} (IsDds: {tex.IsDds})");
                Console.WriteLine($"    • Size:        {tex.TextureData.Length:N0} bytes");
                Console.WriteLine($"    • Mipmaps:     {tex.MipMapCount}");
                Console.WriteLine();
            }

            var totalSize = textures.Sum(t => t.TextureData.Length);
            Console.WriteLine($"📊 Total texture data: {totalSize:N0} bytes");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }
    }

    private static void Extract(string filePath, string outputDir, string format)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                Console.WriteLine($"❌ File not found: {filePath}");
                return;
            }

            Console.WriteLine($"📦 Extracting: {Path.GetFileName(filePath)}");
            Console.WriteLine($"🎨 Format: {format.ToUpperInvariant()}");

            Directory.CreateDirectory(outputDir);
            var textures = G4txParser.ParseFile(filePath);

            foreach (var texture in textures)
            {
                string outputPath = Path.Combine(outputDir, $"{texture.Name}.{format.ToLowerInvariant()}");

                if (format.Equals("png", StringComparison.OrdinalIgnoreCase))
                {
                    texture.SaveAsPng(outputPath);
                }
                else if (format.Equals("webp", StringComparison.OrdinalIgnoreCase))
                {
                    texture.SaveAsWebp(outputPath);
                }
                else
                {
                    // Default to raw extraction (DDS or NXTCH)
                    string ext = texture.IsDds ? "dds" : "nxtch";
                    string rawPath = Path.Combine(outputDir, $"{texture.Name}.{ext}");
                    File.WriteAllBytes(rawPath, texture.TextureData.ToArray());
                }

                Console.WriteLine($"  ✅ Extracted: {Path.GetFileName(outputPath)}");
            }

            Console.WriteLine($"✅ Extracted {textures.Count} texture(s) to: {outputDir}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
            Console.WriteLine(ex.StackTrace);
        }
    }

    private static async void BatchExtract(string directory, string outputDir, bool recursive, int threads, string format)
    {
        try
        {
            if (!Directory.Exists(directory))
            {
                Console.WriteLine($"❌ Directory not found: {directory}");
                return;
            }

            var searchOption = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            var g4txFiles = Directory.GetFiles(directory, "*.g4tx", searchOption);

            if (g4txFiles.Length == 0)
            {
                Console.WriteLine($"❌ No G4TX files found in: {directory}");
                return;
            }

            Console.WriteLine($"📦 Found {g4txFiles.Length} G4TX file(s)");
            Console.WriteLine($"🚀 Using {threads} thread(s) with producer-consumer pipeline");
            Console.WriteLine($"🎨 Format: {format.ToUpperInvariant()}");
            Console.WriteLine();

            int processed = 0;
            int errors = 0;

            // Create bounded channel for backpressure control
            var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(threads * 2)
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleWriter = true,
                SingleReader = false
            });

            // Producer task: feed files to channel
            var producerTask = Task.Run(async () =>
            {
                foreach (var file in g4txFiles)
                {
                    await channel.Writer.WriteAsync(file);
                }
                channel.Writer.Complete();
            });

            // Consumer tasks: process files from channel
            await Parallel.ForEachAsync(
                channel.Reader.ReadAllAsync(),
                new ParallelOptions { MaxDegreeOfParallelism = threads },
                async (file, ct) =>
                {
                    try
                    {
                        var relativePath = Path.GetRelativePath(directory, file);
                        var fileOutputDir = Path.Combine(outputDir, Path.GetDirectoryName(relativePath) ?? "");
                        var fileOutputSubDir = Path.Combine(fileOutputDir, Path.GetFileNameWithoutExtension(file));

                        await Task.Run(() => Extract(file, fileOutputSubDir, format), ct);

                        var current = Interlocked.Increment(ref processed);
                        Console.WriteLine($"[{current}/{g4txFiles.Length}] ✅ {relativePath}");
                    }
                    catch (Exception ex)
                    {
                        Interlocked.Increment(ref errors);
                        Console.WriteLine($"❌ {Path.GetFileName(file)}: {ex.Message}");
                    }
                });

            await producerTask;

            Console.WriteLine();
            Console.WriteLine($"✅ Processed: {processed}/{g4txFiles.Length}");
            if (errors > 0)
                Console.WriteLine($"❌ Errors: {errors}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }
    }
}
