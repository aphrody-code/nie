using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipelines;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using IECODE.Core.Formats.Criware.CriFs.Compression;
using IECODE.Core.Formats.Criware.CriFs.Definitions;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Interfaces;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Structs;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Utilities;
using IECODE.Core.Formats.Criware.CriFs.Utilities.Parsing;

namespace IECODE.Core.Formats.Criware.CriFs.Utilities;

/// <summary>
/// Ultra high-performance batch extractor optimized for large CPK archives (50GB+).
/// Uses I/O pipelines, parallel processing, and smart scheduling.
/// </summary>
public sealed class OptimizedBatchExtractor : IAsyncDisposable, IDisposable
{
    private readonly string _cpkPath;
    private readonly long _cpkSize;
    private readonly InPlaceDecryptionFunction? _decrypt;
    private readonly ExtractionOptions _options;

    private readonly Channel<ExtractJob> _readChannel;
    private readonly Channel<DecompressJob> _decompressChannel;
    private readonly Channel<WriteJob> _writeChannel;

    private readonly CancellationTokenSource _shutdownToken;
    private readonly Task[] _workers;

    private long _bytesRead;
    private long _bytesWritten;
    private int _filesProcessed;
    private int _totalFiles;
    private readonly Stopwatch _stopwatch;

    /// <summary>
    /// Total bytes read from the CPK.
    /// </summary>
    public long BytesRead => Volatile.Read(ref _bytesRead);

    /// <summary>
    /// Total bytes written to disk.
    /// </summary>
    public long BytesWritten => Volatile.Read(ref _bytesWritten);

    /// <summary>
    /// Number of files processed.
    /// </summary>
    public int FilesProcessed => Volatile.Read(ref _filesProcessed);

    /// <summary>
    /// Total files to process.
    /// </summary>
    public int TotalFiles => _totalFiles;

    /// <summary>
    /// Current throughput in MB/s.
    /// </summary>
    public double ThroughputMBps => _stopwatch.Elapsed.TotalSeconds > 0
        ? BytesWritten / 1024.0 / 1024.0 / _stopwatch.Elapsed.TotalSeconds
        : 0;

    /// <summary>
    /// Creates a new optimized batch extractor.
    /// </summary>
    /// <param name="cpkPath">Path to the CPK file.</param>
    /// <param name="options">Extraction options.</param>
    /// <param name="decrypt">Optional decryption function.</param>
    public OptimizedBatchExtractor(string cpkPath, ExtractionOptions? options = null, InPlaceDecryptionFunction? decrypt = null)
    {
        _cpkPath = cpkPath;
        _cpkSize = new FileInfo(cpkPath).Length;
        _decrypt = decrypt;
        _options = options ?? new ExtractionOptions();
        _stopwatch = new Stopwatch();
        _shutdownToken = new CancellationTokenSource();

        // Configure channels with bounded capacity for backpressure
        var channelOptions = new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false
        };

        _readChannel = Channel.CreateBounded<ExtractJob>(channelOptions);
        _decompressChannel = Channel.CreateBounded<DecompressJob>(channelOptions);
        _writeChannel = Channel.CreateBounded<WriteJob>(new BoundedChannelOptions(_options.MaxConcurrentWrites * 2)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false
        });

        // Start worker tasks
        var workers = new List<Task>();

        // Reader workers (1-2 for sequential I/O efficiency)
        var readerCount = Math.Min(2, _options.MaxDegreeOfParallelism);
        for (int i = 0; i < readerCount; i++)
        {
            workers.Add(Task.Run(() => ReaderWorkerAsync(_shutdownToken.Token)));
        }

        // Decompression workers (CPU-bound)
        var decompressionCount = Math.Max(1, _options.MaxDegreeOfParallelism - 2);
        for (int i = 0; i < decompressionCount; i++)
        {
            workers.Add(Task.Run(() => DecompressionWorkerAsync(_shutdownToken.Token)));
        }

        // Writer workers
        for (int i = 0; i < _options.MaxConcurrentWrites; i++)
        {
            workers.Add(Task.Run(() => WriterWorkerAsync(_shutdownToken.Token)));
        }

        _workers = workers.ToArray();
    }

    /// <summary>
    /// Extracts all files from the CPK to the specified directory.
    /// </summary>
    /// <param name="outputDirectory">Output directory.</param>
    /// <param name="progress">Progress callback.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Extraction result.</returns>
    public async Task<ExtractionResult> ExtractAllAsync(
        string outputDirectory,
        IProgress<ExtractionProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        // Get file list
        CpkFile[] files;
        await using (var stream = new FileStream(_cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024))
        {
            files = CpkHelper.GetFilesFromStream(stream);
        }

        return await ExtractFilesAsync(files, outputDirectory, progress, cancellationToken);
    }

    /// <summary>
    /// Extracts selected files from the CPK.
    /// </summary>
    /// <param name="files">Files to extract.</param>
    /// <param name="outputDirectory">Output directory.</param>
    /// <param name="progress">Progress callback.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Extraction result.</returns>
    public async Task<ExtractionResult> ExtractFilesAsync(
        IReadOnlyList<CpkFile> files,
        string outputDirectory,
        IProgress<ExtractionProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        _totalFiles = files.Count;
        _bytesRead = 0;
        _bytesWritten = 0;
        _filesProcessed = 0;

        // Sort files by offset for sequential I/O
        var sortedFiles = files.OrderBy(f => f.FileOffset).ToList();
        var totalBytes = sortedFiles.Sum(f => (long)Math.Max(f.FileSize, f.ExtractSize));

        _stopwatch.Restart();

        // Start progress reporter
        var progressTask = progress is not null
            ? Task.Run(async () => await ReportProgressAsync(progress, totalBytes, cancellationToken), cancellationToken)
            : Task.CompletedTask;

        try
        {
            // Queue all files for extraction
            foreach (var file in sortedFiles)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var relativePath = string.IsNullOrEmpty(file.Directory)
                    ? file.FileName
                    : Path.Combine(file.Directory, file.FileName);
                var outputPath = Path.Combine(outputDirectory, relativePath);

                // Skip existing if requested
                if (_options.SkipExisting && File.Exists(outputPath))
                {
                    var existingSize = new FileInfo(outputPath).Length;
                    if (existingSize == file.ExtractSize || existingSize == file.FileSize)
                    {
                        Interlocked.Increment(ref _filesProcessed);
                        Interlocked.Add(ref _bytesWritten, existingSize);
                        continue;
                    }
                }

                await _readChannel.Writer.WriteAsync(new ExtractJob(file, outputPath), cancellationToken);
            }

            // Signal completion
            _readChannel.Writer.Complete();

            // Wait for all workers to complete
            await WaitForCompletionAsync(cancellationToken);

            _stopwatch.Stop();

            return new ExtractionResult(
                FilesProcessed,
                TotalFiles,
                BytesWritten,
                _stopwatch.Elapsed,
                ThroughputMBps);
        }
        finally
        {
            await progressTask;
        }
    }

    private async Task ReaderWorkerAsync(CancellationToken cancellationToken)
    {
        // Use single stream per reader for sequential efficiency
        await using var stream = new FileStream(_cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read,
            bufferSize: _options.StreamBufferSize,
            FileOptions.SequentialScan | FileOptions.Asynchronous);

        await foreach (var job in _readChannel.Reader.ReadAllAsync(cancellationToken))
        {
            try
            {
                stream.Position = job.File.FileOffset;

                var data = CpkHelper.ExtractFileNoDecompression(job.File, stream, out var needsDecompression, _decrypt);
                Interlocked.Add(ref _bytesRead, data.Count);

                if (needsDecompression)
                {
                    await _decompressChannel.Writer.WriteAsync(new DecompressJob(job.OutputPath, data), cancellationToken);
                }
                else
                {
                    await _writeChannel.Writer.WriteAsync(new WriteJob(job.OutputPath, data), cancellationToken);
                }
            }
            catch (Exception ex)
            {
                // Log error but continue with other files
                Console.Error.WriteLine($"Error reading {job.File.FileName}: {ex.Message}");
                Interlocked.Increment(ref _filesProcessed);
            }
        }
    }

    private async Task DecompressionWorkerAsync(CancellationToken cancellationToken)
    {
        await foreach (var job in _decompressChannel.Reader.ReadAllAsync(cancellationToken))
        {
            try
            {
                ArrayRental decompressed;
                unsafe
                {
                    fixed (byte* dataPtr = job.CompressedData.RawArray)
                    {
                        decompressed = CriLayla.DecompressToArrayPool(dataPtr);
                    }
                }

                job.CompressedData.Dispose();
                await _writeChannel.Writer.WriteAsync(new WriteJob(job.OutputPath, decompressed), cancellationToken);
            }
            catch (Exception ex)
            {
                job.CompressedData.Dispose();
                Console.Error.WriteLine($"Error decompressing {job.OutputPath}: {ex.Message}");
                Interlocked.Increment(ref _filesProcessed);
            }
        }
    }

    private async Task WriterWorkerAsync(CancellationToken cancellationToken)
    {
        await foreach (var job in _writeChannel.Reader.ReadAllAsync(cancellationToken))
        {
            try
            {
                // Ensure directory exists
                var directory = Path.GetDirectoryName(job.OutputPath);
                if (!string.IsNullOrEmpty(directory))
                    Directory.CreateDirectory(directory);

                await using var outputStream = new FileStream(
                    job.OutputPath,
                    FileMode.Create,
                    FileAccess.Write,
                    FileShare.None,
                    bufferSize: 0, // No buffering for direct writes
                    FileOptions.Asynchronous | FileOptions.SequentialScan);

                // Pre-allocate if supported
                if (_options.PreallocateFiles)
                {
                    try { outputStream.SetLength(job.Data.Count); } catch { }
                }

                await outputStream.WriteAsync(job.Data.Span.ToArray(), cancellationToken);

                Interlocked.Add(ref _bytesWritten, job.Data.Count);
                Interlocked.Increment(ref _filesProcessed);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error writing {job.OutputPath}: {ex.Message}");
            }
            finally
            {
                job.Data.Dispose();
            }
        }
    }

    private async Task ReportProgressAsync(IProgress<ExtractionProgress> progress, long totalBytes, CancellationToken cancellationToken)
    {
        var lastReport = Stopwatch.StartNew();

        while (!cancellationToken.IsCancellationRequested && FilesProcessed < TotalFiles)
        {
            if (lastReport.ElapsedMilliseconds >= 100) // Report every 100ms max
            {
                progress.Report(new ExtractionProgress(
                    FilesProcessed,
                    TotalFiles,
                    BytesWritten,
                    totalBytes,
                    $"Processing...",
                    _stopwatch.Elapsed));

                lastReport.Restart();
            }

            await Task.Delay(50, cancellationToken);
        }

        // Final report
        progress.Report(new ExtractionProgress(
            FilesProcessed,
            TotalFiles,
            BytesWritten,
            totalBytes,
            "Complete",
            _stopwatch.Elapsed));
    }

    private async Task WaitForCompletionAsync(CancellationToken cancellationToken)
    {
        // Wait for read channel to complete
        await _readChannel.Reader.Completion;

        // Signal decompress channel completion
        _decompressChannel.Writer.Complete();
        await _decompressChannel.Reader.Completion;

        // Signal write channel completion
        _writeChannel.Writer.Complete();
        await _writeChannel.Reader.Completion;
    }

    public void Dispose()
    {
        _shutdownToken.Cancel();
        _readChannel.Writer.TryComplete();
        _decompressChannel.Writer.TryComplete();
        _writeChannel.Writer.TryComplete();
        _shutdownToken.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        _shutdownToken.Cancel();
        _readChannel.Writer.TryComplete();
        _decompressChannel.Writer.TryComplete();
        _writeChannel.Writer.TryComplete();

        await Task.WhenAll(_workers);
        _shutdownToken.Dispose();
    }

    // Job records for pipeline stages
    private readonly record struct ExtractJob(CpkFile File, string OutputPath);
    private readonly record struct DecompressJob(string OutputPath, ArrayRental CompressedData);
    private readonly record struct WriteJob(string OutputPath, ArrayRental Data);
}

/// <summary>
/// Result of an extraction operation.
/// </summary>
public readonly record struct ExtractionResult(
    int FilesExtracted,
    int TotalFiles,
    long BytesWritten,
    TimeSpan Duration,
    double ThroughputMBps)
{
    /// <summary>
    /// Human-readable summary.
    /// </summary>
    public override string ToString() =>
        $"Extracted {FilesExtracted}/{TotalFiles} files ({BytesWritten / 1024.0 / 1024.0:F2} MB) in {Duration.TotalSeconds:F1}s ({ThroughputMBps:F1} MB/s)";
}

