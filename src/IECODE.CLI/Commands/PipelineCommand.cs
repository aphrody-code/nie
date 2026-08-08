using System.Diagnostics;
using IECODE.Core;
using IECODE.Core.Dump;
using IECODE.Core.Pipeline;

namespace IECODE.CLI.Commands;

/// <summary>
/// Pipeline Command - Full data extraction, conversion, and cleanup.
/// Uses existing DumpService + adds conversion layer.
/// </summary>
public static class PipelineCommand
{
    public static async Task ExecuteAsync(
        string? gamePath,
        string? output,
        string? packsPath,
        bool convert = true,
        bool deleteAfterExtract = false,
        bool deleteAfterConvert = false,
        int parallelCpks = 0,
        int parallelConversions = 0,
        bool resume = true,
        bool recursive = true,
        string pattern = "*.cpk",
        bool verbose = false)
    {
        // Default parallelism
        if (parallelCpks <= 0) parallelCpks = Math.Max(2, Environment.ProcessorCount / 2);
        if (parallelConversions <= 0) parallelConversions = Environment.ProcessorCount * 2;

        try
        {
            using var game = new IEVRGame(gamePath);

            if (!game.IsValid)
            {
                Console.Error.WriteLine($"Error: Game not found at: {game.GamePath}");
                Environment.ExitCode = 1;
                return;
            }

            string outputPath = output ?? Path.Combine(game.DataPath, "extracted");
            string actualPacksPath = packsPath ?? game.PacksPath;

            PrintHeader(game, actualPacksPath, outputPath, convert, deleteAfterExtract, deleteAfterConvert, parallelCpks, parallelConversions);

            var stopwatch = Stopwatch.StartNew();

            using var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                Console.WriteLine("\n\n  ⚠ Cancellation requested...");
                cts.Cancel();
            };

            var options = new PipelineOptions
            {
                OutputPath = outputPath,
                PacksPath = actualPacksPath,
                MaxParallelCpks = parallelCpks,
                MaxParallelConversions = parallelConversions,
                ConvertFormats = convert,
                DeleteCpkAfterExtract = deleteAfterExtract,
                DeleteBinaryAfterConvert = deleteAfterConvert,
                Resume = resume,
                OnProgress = progress =>
                {
                    if (progress.DumpProgress != null)
                    {
                        var dp = progress.DumpProgress;
                        if (dp.Phase == DumpPhase.Extracting)
                        {
                            var bar = CreateProgressBar(dp.PercentComplete, 30);
                            Console.Write($"\r  [{bar}] {dp.PercentComplete:F1}% | {dp.ExtractedFiles:N0}/{dp.TotalFiles:N0} | {dp.MBPerSecond:F1} MB/s    ");
                        }
                    }
                }
            };

            var pipeline = new DataPipelineService(game);
            var result = await pipeline.ExecuteAsync(options, cts.Token);

            stopwatch.Stop();
            PrintSummary(result, stopwatch.Elapsed, outputPath);
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine("\n  Pipeline cancelled.");
            Environment.ExitCode = 130;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"\nError: {ex.Message}");
            if (verbose) Console.Error.WriteLine(ex.StackTrace);
            Environment.ExitCode = 1;
        }
    }

    private static string CreateProgressBar(double percent, int width)
    {
        int filled = (int)(percent * width / 100);
        int empty = width - filled;
        return new string('█', filled) + new string('░', empty);
    }

    private static void PrintHeader(
        IEVRGame game,
        string packsPath,
        string output,
        bool convert,
        bool deleteCpk,
        bool deleteBinary,
        int parallelCpks,
        int parallelConversions)
    {
        Console.WriteLine();
        Console.WriteLine("╔══════════════════════════════════════════════════════════════════════════╗");
        Console.WriteLine("║          IECODE PIPELINE - Extract + Convert + Cleanup                   ║");
        Console.WriteLine("╠══════════════════════════════════════════════════════════════════════════╣");
        Console.WriteLine($"║  Game:      {Truncate(game.GamePath, 60),-62}║");
        Console.WriteLine($"║  Packs:     {Truncate(packsPath, 60),-62}║");
        Console.WriteLine($"║  Output:    {Truncate(output, 60),-62}║");
        Console.WriteLine("╠══════════════════════════════════════════════════════════════════════════╣");
        Console.WriteLine($"║  Convert:   {(convert ? "Yes (G4TX→PNG, cfg.bin→JSON)" : "No"),-62}║");
        Console.WriteLine($"║  Delete CPK:{(deleteCpk ? "Yes (after extraction)" : "No"),-62}║");
        Console.WriteLine($"║  Delete Bin:{(deleteBinary ? "Yes (after conversion)" : "No"),-62}║");
        Console.WriteLine($"║  Parallel:  {parallelCpks} CPKs, {parallelConversions} conversions{new string(' ', 45 - $"{parallelCpks} CPKs, {parallelConversions} conversions".Length)}║");
        Console.WriteLine("╚══════════════════════════════════════════════════════════════════════════╝");
        Console.WriteLine();
    }

    private static void PrintSummary(PipelineResult result, TimeSpan duration, string output)
    {
        var dr = result.DumpResult;
        Console.WriteLine();
        Console.WriteLine();
        Console.WriteLine("╔══════════════════════════════════════════════════════════════════════════╗");
        Console.WriteLine("║                         PIPELINE COMPLETE                                ║");
        Console.WriteLine("╠══════════════════════════════════════════════════════════════════════════╣");
        Console.WriteLine($"║  Status:     {(dr.Success ? "✓ Success" : "✗ Failed"),-61}║");
        Console.WriteLine($"║  Duration:   {FormatDuration(duration),-61}║");
        Console.WriteLine("╠══════════════════════════════════════════════════════════════════════════╣");
        Console.WriteLine($"║  Extracted:  {dr.ExtractedFiles:N0} files from {dr.TotalCpks} CPKs{new string(' ', 42 - $"{dr.ExtractedFiles:N0} files from {dr.TotalCpks} CPKs".Length)}║");
        Console.WriteLine($"║  Skipped:    {dr.SkippedFiles:N0} (already extracted){new string(' ', 42 - $"{dr.SkippedFiles:N0} (already extracted)".Length)}║");
        Console.WriteLine($"║  Converted:  {result.ConvertedFiles:N0} files{new string(' ', 55 - $"{result.ConvertedFiles:N0} files".Length)}║");
        Console.WriteLine($"║  Errors:     {dr.Errors.Count + result.ConversionErrors}{new string(' ', 61 - (dr.Errors.Count + result.ConversionErrors).ToString().Length)}║");
        Console.WriteLine("╠══════════════════════════════════════════════════════════════════════════╣");
        Console.WriteLine($"║  Data:       {FormatBytes(dr.ExtractedBytes),-61}║");
        Console.WriteLine($"║  Freed:      {FormatBytes(result.BytesFreed),-61}║");
        Console.WriteLine($"║  Speed:      {dr.MBPerSecond:F1} MB/s ({dr.FilesPerSecond:F0} files/s){new string(' ', 44 - $"{dr.MBPerSecond:F1} MB/s ({dr.FilesPerSecond:F0} files/s)".Length)}║");
        Console.WriteLine("╚══════════════════════════════════════════════════════════════════════════╝");
        Console.WriteLine();
        Console.WriteLine($"  Output: {output}");
    }

    private static string Truncate(string text, int max) =>
        text.Length <= max ? text : "..." + text[^(max - 3)..];

    private static string FormatDuration(TimeSpan d) => d.TotalHours >= 1
        ? $"{d.Hours}h {d.Minutes:00}m {d.Seconds:00}s"
        : d.TotalMinutes >= 1
            ? $"{d.Minutes}m {d.Seconds:00}s"
            : $"{d.TotalSeconds:F1}s";

    private static string FormatBytes(long bytes) => bytes switch
    {
        >= 1_099_511_627_776 => $"{bytes / 1_099_511_627_776.0:F2} TB",
        >= 1_073_741_824 => $"{bytes / 1_073_741_824.0:F2} GB",
        >= 1_048_576 => $"{bytes / 1_048_576.0:F2} MB",
        >= 1024 => $"{bytes / 1024.0:F2} KB",
        _ => $"{bytes} B"
    };
}
