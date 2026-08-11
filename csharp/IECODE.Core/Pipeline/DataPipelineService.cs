// DataPipelineService - Extends DumpService with post-extraction conversion
// Uses existing DumpService for extraction, adds format conversion layer

using System.Collections.Concurrent;
using System.Diagnostics;
using IECODE.Core.Converters;
using IECODE.Core.Dump;

namespace IECODE.Core.Pipeline;

/// <summary>
/// Extended dump options with conversion support.
/// </summary>
public sealed class PipelineOptions
{
    /// <summary>Source data directory containing CPK files (default: game packs path).</summary>
    public string? SourcePath { get; init; }

    /// <summary>Custom packs directory (default: game packs path).</summary>
    public string? PacksPath { get; init; }

    /// <summary>Output directory for extracted/converted files.</summary>
    public required string OutputPath { get; init; }

    /// <summary>Number of CPKs to extract in parallel.</summary>
    public int MaxParallelCpks { get; init; } = Environment.ProcessorCount;

    /// <summary>Number of files to convert in parallel.</summary>
    public int MaxParallelConversions { get; init; } = Environment.ProcessorCount * 2;

    /// <summary>Delete CPK after full extraction.</summary>
    public bool DeleteCpkAfterExtract { get; init; } = false;

    /// <summary>Delete original binary after conversion.</summary>
    public bool DeleteBinaryAfterConvert { get; init; } = false;

    /// <summary>Convert binaries to readable formats.</summary>
    public bool ConvertFormats { get; init; } = true;

    /// <summary>Resume from manifest (skip already processed).</summary>
    public bool Resume { get; init; } = true;

    /// <summary>Progress callback.</summary>
    public Action<PipelineProgress>? OnProgress { get; init; }
}

/// <summary>
/// Pipeline progress info.
/// </summary>
public sealed class PipelineProgress
{
    public DumpProgress? DumpProgress { get; init; }
    public int ConvertedFiles { get; set; }
    public int ConversionErrors { get; set; }
    public long BytesFreed { get; set; }
    public string? CurrentOperation { get; init; }
}

/// <summary>
/// Pipeline result combining dump + conversion stats.
/// </summary>
public sealed class PipelineResult
{
    public DumpResult DumpResult { get; set; } = new();
    public int ConvertedFiles { get; set; }
    public int ConversionErrors { get; set; }
    public long BytesFreed { get; set; }
    public List<string> ConversionErrorDetails { get; } = [];
    public TimeSpan ConversionDuration { get; set; }
}

/// <summary>
/// High-performance pipeline: DumpService extraction + format conversion.
/// Leverages existing IECODE.Core infrastructure.
/// </summary>
public sealed class DataPipelineService
{
    private readonly IEVRGame _game;
    private readonly AssetConverterFacade _converter;

    public DataPipelineService(IEVRGame game)
    {
        _game = game;
        _converter = new AssetConverterFacade();
    }

    /// <summary>
    /// Execute full pipeline: Extract → Convert → Cleanup
    /// </summary>
    public async Task<PipelineResult> ExecuteAsync(PipelineOptions options, CancellationToken ct = default)
    {
        var result = new PipelineResult();
        var conversionStopwatch = new Stopwatch();

        // Phase 1: Use existing DumpService for extraction
        Console.WriteLine("[Pipeline] Phase 1: Extraction (using DumpService)");

        var dumpOptions = new DumpOptions
        {
            OutputPath = options.OutputPath,
            PacksPath = options.PacksPath,
            SmartDump = options.Resume,
            UseCpkList = true,
            IncludeLooseFiles = true,
            MaxParallelism = options.MaxParallelCpks,
            OnProgress = progress =>
            {
                options.OnProgress?.Invoke(new PipelineProgress
                {
                    DumpProgress = progress,
                    CurrentOperation = "Extracting"
                });
            }
        };

        result.DumpResult = await _game.Dump.ExecuteAsync(dumpOptions, ct);

        if (!result.DumpResult.Success)
        {
            return result;
        }

        // Phase 2: Convert extracted files
        if (options.ConvertFormats)
        {
            Console.WriteLine("\n[Pipeline] Phase 2: Converting formats");
            conversionStopwatch.Start();

            await ConvertExtractedFilesAsync(options, result, ct);

            conversionStopwatch.Stop();
            result.ConversionDuration = conversionStopwatch.Elapsed;
        }

        // Phase 3: Cleanup (delete CPKs if requested)
        if (options.DeleteCpkAfterExtract)
        {
            Console.WriteLine("\n[Pipeline] Phase 3: Cleanup (deleting CPKs)");
            await DeleteCpksAsync(options, result, ct);
        }

        return result;
    }

    /// <summary>
    /// Convert all supported files in the output directory.
    /// </summary>
    private async Task ConvertExtractedFilesAsync(
        PipelineOptions options,
        PipelineResult result,
        CancellationToken ct)
    {
        var supportedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".g4tx", ".g4sk", ".g4mt", ".g4pk", ".g4ra", ".dds", ".usm",
            ".objbin"  // cfg.bin format (t2b footer) - object configuration
        };

        // Find all convertible files
        var filesToConvert = Directory.EnumerateFiles(options.OutputPath, "*.*", SearchOption.AllDirectories)
            .Where(f => supportedExtensions.Contains(Path.GetExtension(f)) ||
                        f.EndsWith(".cfg.bin", StringComparison.OrdinalIgnoreCase))
            .ToList();

        Console.WriteLine($"[Convert] Found {filesToConvert.Count:N0} files to convert");

        if (filesToConvert.Count == 0) return;

        var errors = new ConcurrentBag<string>();
        var converted = 0;
        var bytesFreed = 0L;
        // Report every ~5% — avoids a lock on the hot path.
        int reportEvery = Math.Max(1, filesToConvert.Count / 20);

        await Parallel.ForEachAsync(filesToConvert,
            new ParallelOptions { MaxDegreeOfParallelism = options.MaxParallelConversions, CancellationToken = ct },
            async (filePath, innerCt) =>
            {
                try
                {
                    string dir = Path.GetDirectoryName(filePath) ?? ".";
                    var convertedPath = await _converter.ConvertFileAsync(filePath, dir);

                    if (convertedPath != null)
                    {
                        int current = Interlocked.Increment(ref converted);

                        if (options.DeleteBinaryAfterConvert && File.Exists(filePath))
                        {
                            long size = new FileInfo(filePath).Length;
                            File.Delete(filePath);
                            Interlocked.Add(ref bytesFreed, size);
                        }

                        if (current % reportEvery == 0)
                            Console.Write($"\r[Convert] {current:N0}/{filesToConvert.Count:N0} converted, {errors.Count} errors");
                    }
                }
                catch (Exception ex)
                {
                    errors.Add($"{Path.GetFileName(filePath)}: {ex.Message}");
                }
            });

        result.ConvertedFiles = converted;
        result.ConversionErrors = errors.Count;
        result.BytesFreed = bytesFreed;

        // Collect at most 50 error details without allocating a LINQ pipeline.
        int kept = 0;
        foreach (var e in errors)
        {
            result.ConversionErrorDetails.Add(e);
            if (++kept >= 50) break;
        }

        Console.WriteLine($"\n[Convert] Completed: {converted:N0} files, {errors.Count} errors");
    }

    /// <summary>
    /// Delete CPK files after extraction.
    /// </summary>
    private Task DeleteCpksAsync(PipelineOptions options, PipelineResult result, CancellationToken ct)
    {
        var packsPath = options.PacksPath ?? options.SourcePath ?? _game.PacksPath;
        var cpkFiles = Directory.EnumerateFiles(packsPath, "*.cpk", SearchOption.AllDirectories);

        long totalFreed = 0;
        foreach (var cpk in cpkFiles)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var size = new FileInfo(cpk).Length;
                File.Delete(cpk);
                totalFreed += size;
                Console.WriteLine($"[Delete] {Path.GetFileName(cpk)} ({size / 1_048_576.0:F1} MB)");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Delete] Failed: {Path.GetFileName(cpk)} - {ex.Message}");
            }
        }

        result.BytesFreed += totalFreed;
        Console.WriteLine($"[Delete] Total freed: {totalFreed / 1_073_741_824.0:F2} GB");

        return Task.CompletedTask;
    }
}

/// <summary>
/// Extension methods for pipeline integration.
/// </summary>
public static class PipelineExtensions
{
    /// <summary>
    /// Quick pipeline execution with default options.
    /// </summary>
    public static Task<PipelineResult> RunPipelineAsync(
        this IEVRGame game,
        string? outputPath = null,
        bool convert = true,
        bool deleteCpks = false,
        bool deleteBinaries = false,
        CancellationToken ct = default)
    {
        var pipeline = new DataPipelineService(game);

        var options = new PipelineOptions
        {
            OutputPath = outputPath ?? Path.Combine(game.DataPath, "extracted"),
            ConvertFormats = convert,
            DeleteCpkAfterExtract = deleteCpks,
            DeleteBinaryAfterConvert = deleteBinaries,
            MaxParallelCpks = Math.Max(2, Environment.ProcessorCount / 2),
            MaxParallelConversions = Environment.ProcessorCount * 2,
            Resume = true
        };

        return pipeline.ExecuteAsync(options, ct);
    }
}
