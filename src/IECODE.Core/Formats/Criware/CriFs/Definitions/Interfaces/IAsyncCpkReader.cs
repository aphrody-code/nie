using System.Buffers;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Structs;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Utilities;

namespace IECODE.Core.Formats.Criware.CriFs.Definitions.Interfaces;

/// <summary>
/// Progress information for extraction operations.
/// </summary>
public readonly record struct ExtractionProgress(
    int CurrentFile,
    int TotalFiles,
    long BytesExtracted,
    long TotalBytes,
    string CurrentFileName,
    TimeSpan Elapsed
)
{
    /// <summary>
    /// Percentage of completion (0-100).
    /// </summary>
    public double Percentage => TotalFiles > 0 ? (double)CurrentFile / TotalFiles * 100 : 0;

    /// <summary>
    /// Estimated time remaining.
    /// </summary>
    public TimeSpan EstimatedRemaining => CurrentFile > 0
        ? TimeSpan.FromTicks(Elapsed.Ticks * (TotalFiles - CurrentFile) / CurrentFile)
        : TimeSpan.Zero;

    /// <summary>
    /// Current extraction speed in bytes per second.
    /// </summary>
    public double BytesPerSecond => Elapsed.TotalSeconds > 0
        ? BytesExtracted / Elapsed.TotalSeconds
        : 0;
}

/// <summary>
/// Options for configuring extraction behavior.
/// </summary>
public sealed class ExtractionOptions
{
    /// <summary>
    /// Maximum degree of parallelism for file extraction.
    /// Default: Environment.ProcessorCount.
    /// </summary>
    public int MaxDegreeOfParallelism { get; init; } = Environment.ProcessorCount;

    /// <summary>
    /// Size threshold for using memory-mapped files (in bytes).
    /// Files larger than this will use memory-mapping for reduced memory pressure.
    /// Default: 100MB.
    /// </summary>
    public long MemoryMapThreshold { get; init; } = 100 * 1024 * 1024;

    /// <summary>
    /// Buffer size for streaming operations.
    /// Default: 64KB.
    /// </summary>
    public int StreamBufferSize { get; init; } = 64 * 1024;

    /// <summary>
    /// Whether to use direct I/O (bypass OS cache).
    /// Useful for large sequential reads.
    /// Default: true for files > 1GB.
    /// </summary>
    public bool UseDirectIO { get; init; } = true;

    /// <summary>
    /// Maximum concurrent write operations.
    /// Default: 4.
    /// </summary>
    public int MaxConcurrentWrites { get; init; } = 4;

    /// <summary>
    /// Preallocation strategy for output files.
    /// </summary>
    public bool PreallocateFiles { get; init; } = true;

    /// <summary>
    /// Whether to verify file integrity after extraction using checksums.
    /// </summary>
    public bool VerifyIntegrity { get; init; } = false;

    /// <summary>
    /// Skip files that already exist with matching size.
    /// </summary>
    public bool SkipExisting { get; init; } = false;
}

/// <summary>
/// Async API for reading CPK archives optimized for large files (50GB+).
/// </summary>
public interface IAsyncCpkReader : IAsyncDisposable, IDisposable
{
    /// <summary>
    /// Path to the CPK file.
    /// </summary>
    string CpkPath { get; }

    /// <summary>
    /// Total size of the CPK file in bytes.
    /// </summary>
    long FileSize { get; }

    /// <summary>
    /// Gets all file entries in the CPK archive asynchronously.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>List of files in the archive.</returns>
    ValueTask<CpkFile[]> GetFilesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Streams file entries for memory-efficient enumeration.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Async enumerable of file entries.</returns>
    IAsyncEnumerable<CpkFile> EnumerateFilesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Extracts a single file asynchronously.
    /// </summary>
    /// <param name="file">The file to extract.</param>
    /// <param name="outputPath">Destination path for the extracted file.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Number of bytes written.</returns>
    ValueTask<long> ExtractFileAsync(CpkFile file, string outputPath, CancellationToken cancellationToken = default);

    /// <summary>
    /// Extracts a file to a stream.
    /// </summary>
    /// <param name="file">The file to extract.</param>
    /// <param name="outputStream">Destination stream.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Number of bytes written.</returns>
    ValueTask<long> ExtractFileToStreamAsync(CpkFile file, Stream outputStream, CancellationToken cancellationToken = default);

    /// <summary>
    /// Extracts a file and returns the data as a Memory buffer.
    /// For small files only - large files should use ExtractFileAsync.
    /// </summary>
    /// <param name="file">The file to extract.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Memory containing the file data.</returns>
    ValueTask<IMemoryOwner<byte>> ExtractFileToMemoryAsync(CpkFile file, CancellationToken cancellationToken = default);

    /// <summary>
    /// Extracts all files to a directory with parallel I/O and progress reporting.
    /// </summary>
    /// <param name="outputDirectory">Base directory for extraction.</param>
    /// <param name="options">Extraction options.</param>
    /// <param name="progress">Progress reporter.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Total bytes extracted.</returns>
    Task<long> ExtractAllAsync(
        string outputDirectory,
        ExtractionOptions? options = null,
        IProgress<ExtractionProgress>? progress = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Extracts selected files with parallel I/O.
    /// </summary>
    /// <param name="files">Files to extract.</param>
    /// <param name="outputDirectory">Base directory for extraction.</param>
    /// <param name="options">Extraction options.</param>
    /// <param name="progress">Progress reporter.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Total bytes extracted.</returns>
    Task<long> ExtractFilesAsync(
        IEnumerable<CpkFile> files,
        string outputDirectory,
        ExtractionOptions? options = null,
        IProgress<ExtractionProgress>? progress = null,
        CancellationToken cancellationToken = default);
}

