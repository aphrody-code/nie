using System.CommandLine;
using System.Text;
using System.Threading.Channels;
using IECODE.Core.Formats.Criware;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande pour parser les fichiers @UTF (Criware Universal Table Format).
/// </summary>
public static class UtfCommand
{
    public static Command Create()
    {
        var command = new Command("utf", "Parse Criware @UTF table files");

        // Subcommand: info
        var infoCommand = new Command("info", "Display UTF table information");
        var infoFileArg = new Argument<string>("file", "Path to UTF file");
        infoCommand.AddArgument(infoFileArg);

        infoCommand.SetHandler((string file) =>
        {
            Info(file);
        }, infoFileArg);

        command.AddCommand(infoCommand);

        // Subcommand: check
        var checkCommand = new Command("check", "Check if file is a valid UTF table");
        var checkFileArg = new Argument<string>("file", "Path to file");
        checkCommand.AddArgument(checkFileArg);

        checkCommand.SetHandler((string file) =>
        {
            Check(file);
        }, checkFileArg);

        command.AddCommand(checkCommand);

        // Subcommand: batch
        var batchCommand = new Command("batch", "Analyze all UTF files in a directory");
        var batchDirArg = new Argument<string>("directory", "Directory to scan");
        batchCommand.AddArgument(batchDirArg);
        var recursiveOption = new Option<bool>(
            aliases: ["--recursive", "-r"],
            description: "Search recursively");
        batchCommand.AddOption(recursiveOption);
        var extensionOption = new Option<string?>(
            aliases: ["--extension", "-e"],
            description: "File extension filter (e.g., .acb)");
        batchCommand.AddOption(extensionOption);

        batchCommand.SetHandler((string directory, bool recursive, string? extension) =>
        {
            BatchAnalyze(directory, recursive, extension);
        }, batchDirArg, recursiveOption, extensionOption);

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

            var data = File.ReadAllBytes(filePath);

            if (!UtfParser.IsUtfFile(data))
            {
                Console.WriteLine($"❌ Not a UTF file: {Path.GetFileName(filePath)}");
                return;
            }

            Console.WriteLine($"📄 Analyzing: {Path.GetFileName(filePath)}");
            Console.WriteLine();

            var header = UtfParser.ParseHeader(data);
            Console.WriteLine($"🔤 Header:");
            Console.WriteLine($"    • Magic:       @UTF (0x{header.Magic:X8})");
            Console.WriteLine($"    • Table Size:  {header.TableSize:N0} bytes");
            Console.WriteLine();

            var metadata = UtfParser.ParseMetadata(data);
            Console.WriteLine($"📊 Table Structure:");
            Console.WriteLine($"    • Rows:           {metadata.RowCount:N0}");
            Console.WriteLine($"    • Columns:        {metadata.ColumnCount}");
            Console.WriteLine($"    • Row Size:       {metadata.RowSizeBytes} bytes");
            Console.WriteLine($"    • Encoding:       {(metadata.IsUtf8 ? "UTF-8" : "Shift-JIS (CP932)")}");
            Console.WriteLine();

            Console.WriteLine($"📍 Offsets:");
            Console.WriteLine($"    • Rows:           0x{metadata.RowsOffset:X8}");
            Console.WriteLine($"    • String Pool:    0x{metadata.StringPoolOffset:X8}");
            Console.WriteLine($"    • Data Pool:      0x{metadata.DataPoolOffset:X8}");
            Console.WriteLine();

            Console.WriteLine($"✅ Valid UTF table");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }
    }

    private static void Check(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                Console.WriteLine($"❌ File not found: {filePath}");
                return;
            }

            var data = File.ReadAllBytes(filePath);
            bool isUtf = UtfParser.IsUtfFile(data);

            if (isUtf)
            {
                Console.WriteLine($"✅ {Path.GetFileName(filePath)}: Valid UTF file");
            }
            else
            {
                Console.WriteLine($"❌ {Path.GetFileName(filePath)}: Not a UTF file");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }
    }

    private static async void BatchAnalyze(string directory, bool recursive, string? extension)
    {
        try
        {
            if (!Directory.Exists(directory))
            {
                Console.WriteLine($"❌ Directory not found: {directory}");
                return;
            }

            var searchOption = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            var pattern = string.IsNullOrEmpty(extension) ? "*" : $"*{extension}";
            var files = Directory.GetFiles(directory, pattern, searchOption);

            if (files.Length == 0)
            {
                Console.WriteLine($"❌ No files found in: {directory}");
                return;
            }

            Console.WriteLine($"🔍 Scanning {files.Length} file(s) with parallel pipeline...");
            Console.WriteLine();

            int utfCount = 0;
            int nonUtfCount = 0;
            int errorCount = 0;
            int threads = Environment.ProcessorCount;

            // Create bounded channel for controlled memory usage
            var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(threads * 4)
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleWriter = true,
                SingleReader = false
            });

            // Producer: feed files to channel
            var producerTask = Task.Run(async () =>
            {
                foreach (var file in files)
                {
                    await channel.Writer.WriteAsync(file);
                }
                channel.Writer.Complete();
            });

            // Consumers: process files in parallel
            await Parallel.ForEachAsync(
                channel.Reader.ReadAllAsync(),
                new ParallelOptions { MaxDegreeOfParallelism = threads },
                async (file, ct) =>
                {
                    try
                    {
                        var data = await File.ReadAllBytesAsync(file, ct);
                        var relativePath = Path.GetRelativePath(directory, file);

                        if (UtfParser.IsUtfFile(data))
                        {
                            var metadata = UtfParser.ParseMetadata(data);
                            Console.WriteLine($"✅ {relativePath}");
                            Console.WriteLine($"   → {metadata.RowCount} rows, {metadata.ColumnCount} columns, {(metadata.IsUtf8 ? "UTF-8" : "Shift-JIS")}");
                            Interlocked.Increment(ref utfCount);
                        }
                        else
                        {
                            Interlocked.Increment(ref nonUtfCount);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"❌ {Path.GetFileName(file)}: {ex.Message}");
                        Interlocked.Increment(ref errorCount);
                    }
                });

            await producerTask;

            Console.WriteLine();
            Console.WriteLine($"📊 Results:");
            Console.WriteLine($"    • UTF tables:     {utfCount}");
            Console.WriteLine($"    • Non-UTF files:  {nonUtfCount}");
            if (errorCount > 0)
                Console.WriteLine($"    • Errors:         {errorCount}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
        }
    }
}
