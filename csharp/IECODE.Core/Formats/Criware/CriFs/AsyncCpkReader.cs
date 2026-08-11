using System.Buffers;
using System.IO.Pipelines;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using IECODE.Core.Formats.Criware.CriFs.Compression;
using IECODE.Core.Formats.Criware.CriFs.Definitions;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Interfaces;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Structs;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Utilities;
using IECODE.Core.Formats.Criware.CriFs.Utilities.Parsing;
using System.IO.MemoryMappedFiles;
using System.Diagnostics;

namespace IECODE.Core.Formats.Criware.CriFs;

/// <summary>
/// High-performance async CPK reader optimized for large archives (50GB+).
/// Uses memory-mapped files, parallel I/O, and streaming for minimal memory pressure.
/// </summary>
public sealed class AsyncCpkReader : IAsyncCpkReader
{
    private readonly string _cpkPath;
    private readonly long _fileSize;
    private readonly InPlaceDecryptionFunction? _decrypt;
    private readonly SemaphoreSlim _readSemaphore;
    private readonly SemaphoreSlim _writeSemaphore;
    private MemoryMappedFile? _mappedFile;
    private CpkFile[]? _cachedFiles;
    private bool _disposed;

    /// <inheritdoc />
    public string CpkPath => _cpkPath;

    /// <inheritdoc />
    public long FileSize => _fileSize;

    /// <summary>
    /// Creates a new async CPK reader.
    /// </summary>
    /// <param name="cpkPath">Path to the CPK file.</param>
    /// <param name="decrypt">Optional decryption function.</param>
    /// <param name="maxConcurrentReads">Maximum concurrent read operations.</param>
    public AsyncCpkReader(string cpkPath, InPlaceDecryptionFunction? decrypt = null, int maxConcurrentReads = 4)
    {
        _cpkPath = cpkPath;
        _decrypt = decrypt;
        _fileSize = new FileInfo(cpkPath).Length;
        _readSemaphore = new SemaphoreSlim(maxConcurrentReads);
        _writeSemaphore = new SemaphoreSlim(4);

        // Use memory-mapped file for large CPKs
        if (_fileSize > 100 * 1024 * 1024) // > 100MB
        {
            _mappedFile = MemoryMappedFile.CreateFromFile(
                cpkPath,
                FileMode.Open,
                null,
                0,
                MemoryMappedFileAccess.Read);
        }
    }

    /// <inheritdoc />
    public async ValueTask<CpkFile[]> GetFilesAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedFiles is not null)
            return _cachedFiles;

        await _readSemaphore.WaitAsync(cancellationToken);
        try
        {
            // Double-check after acquiring semaphore
            if (_cachedFiles is not null)
                return _cachedFiles;

            _cachedFiles = await Task.Run(() =>
            {
                using var stream = new FileStream(_cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                    bufferSize: 64 * 1024, FileOptions.SequentialScan);
                return CpkHelper.GetFilesFromStream(stream);
            }, cancellationToken);

            return _cachedFiles;
        }
        finally
        {
            _readSemaphore.Release();
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<CpkFile> EnumerateFilesAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var files = await GetFilesAsync(cancellationToken);
        foreach (var file in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return file;
        }
    }

    /// <inheritdoc />
    public async ValueTask<long> ExtractFileAsync(CpkFile file, string outputPath, CancellationToken cancellationToken = default)
    {
        var directory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);

        await using var outputStream = new FileStream(
            outputPath,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 64 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan)
        {
            // Pre-allocate file for better performance
        };

        if (file.ExtractSize > 0)
        {
            try
            {
                outputStream.SetLength(file.ExtractSize);
            }
            catch
            {
                // Ignore if preallocation fails
            }
        }

        return await ExtractFileToStreamAsync(file, outputStream, cancellationToken);
    }

    /// <inheritdoc />
    public async ValueTask<long> ExtractFileToStreamAsync(CpkFile file, Stream outputStream, CancellationToken cancellationToken = default)
    {
        if (file.FileSize == 0)
            return 0;

        await _readSemaphore.WaitAsync(cancellationToken);
        try
        {
            return await Task.Run(async () =>
            {
                ArrayRental data;
                bool needsDecompression;

                // Use memory-mapped file if available, otherwise use stream
                if (_mappedFile is not null)
                {
                    data = ExtractFromMappedFile(file, out needsDecompression);
                }
                else
                {
                    await using var stream = new FileStream(_cpkPath, FileMode.Open, FileAccess.Read,
                        FileShare.Read, bufferSize: 0, FileOptions.RandomAccess);
                    data = CpkHelper.ExtractFileNoDecompression(file, stream, out needsDecompression, _decrypt);
                }

                try
                {
                    if (needsDecompression)
                    {
                        byte[] decompressedData;
                        int decompressedCount;
                        unsafe
                        {
                            fixed (byte* dataPtr = data.RawArray)
                            {
                                var decompressed = CriLayla.DecompressToArrayPool(dataPtr);
                                decompressedData = decompressed.Span.ToArray();
                                decompressedCount = decompressed.Count;
                                decompressed.Dispose();
                            }
                        }
                        await outputStream.WriteAsync(decompressedData, cancellationToken);
                        return decompressedCount;
                    }
                    else
                    {
                        await outputStream.WriteAsync(data.Span.ToArray(), cancellationToken);
                        return data.Count;
                    }
                }
                finally
                {
                    data.Dispose();
                }
            }, cancellationToken);
        }
        finally
        {
            _readSemaphore.Release();
        }
    }

    /// <inheritdoc />
    public async ValueTask<IMemoryOwner<byte>> ExtractFileToMemoryAsync(CpkFile file, CancellationToken cancellationToken = default)
    {
        if (file.FileSize == 0)
            return new EmptyMemoryOwner();

        await _readSemaphore.WaitAsync(cancellationToken);
        try
        {
            return await Task.Run(() =>
            {
                ArrayRental data;
                bool needsDecompression;

                if (_mappedFile is not null)
                {
                    data = ExtractFromMappedFile(file, out needsDecompression);
                }
                else
                {
                    using var stream = new FileStream(_cpkPath, FileMode.Open, FileAccess.Read,
                        FileShare.Read, bufferSize: 0, FileOptions.RandomAccess);
                    data = CpkHelper.ExtractFileNoDecompression(file, stream, out needsDecompression, _decrypt);
                }

                if (needsDecompression)
                {
                    try
                    {
                        unsafe
                        {
                            fixed (byte* dataPtr = data.RawArray)
                            {
                                var decompressed = CriLayla.DecompressToArrayPool(dataPtr);
                                return new ArrayRentalMemoryOwner(decompressed);
                            }
                        }
                    }
                    finally
                    {
                        data.Dispose();
                    }
                }

                return new ArrayRentalMemoryOwner(data);
            }, cancellationToken);
        }
        finally
        {
            _readSemaphore.Release();
        }
    }

    /// <inheritdoc />
    public async Task<long> ExtractAllAsync(
        string outputDirectory,
        ExtractionOptions? options = null,
        IProgress<ExtractionProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var files = await GetFilesAsync(cancellationToken);
        return await ExtractFilesAsync(files, outputDirectory, options, progress, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<long> ExtractFilesAsync(
        IEnumerable<CpkFile> files,
        string outputDirectory,
        ExtractionOptions? options = null,
        IProgress<ExtractionProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        options ??= new ExtractionOptions();
        var fileList = files.ToList();
        var totalFiles = fileList.Count;
        var totalBytes = fileList.Sum(f => (long)Math.Max(f.FileSize, f.ExtractSize));

        var stopwatch = Stopwatch.StartNew();
        long bytesExtracted = 0;
        int filesProcessed = 0;

        // Use a bounded channel for backpressure
        var channel = Channel.CreateBounded<(CpkFile File, int Index)>(
            new BoundedChannelOptions(options.MaxDegreeOfParallelism * 2)
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleReader = false,
                SingleWriter = true
            });

        // Producer: queue files
        var producer = Task.Run(async () =>
        {
            try
            {
                for (int i = 0; i < fileList.Count; i++)
                {
                    await channel.Writer.WriteAsync((fileList[i], i), cancellationToken);
                }
            }
            finally
            {
                channel.Writer.Complete();
            }
        }, cancellationToken);

        // Consumers: extract files in parallel
        var consumers = Enumerable.Range(0, options.MaxDegreeOfParallelism)
            .Select(_ => Task.Run(async () =>
            {
                long localBytesExtracted = 0;
                int lastIndex = 0;

                await foreach (var (file, index) in channel.Reader.ReadAllAsync(cancellationToken))
                {
                    lastIndex = index;
                    var relativePath = string.IsNullOrEmpty(file.Directory)
                        ? file.FileName
                        : Path.Combine(file.Directory, file.FileName);
                    var outputPath = Path.Combine(outputDirectory, relativePath);

                    // Skip existing if requested
                    if (options.SkipExisting && File.Exists(outputPath))
                    {
                        var existingSize = new FileInfo(outputPath).Length;
                        if (existingSize == file.ExtractSize || existingSize == file.FileSize)
                        {
                            Interlocked.Increment(ref filesProcessed);
                            Interlocked.Add(ref bytesExtracted, existingSize);
                            localBytesExtracted += existingSize;
                            ReportProgress(index, file.FileName);
                            continue;
                        }
                    }

                    var extracted = await ExtractFileAsync(file, outputPath, cancellationToken);
                    Interlocked.Increment(ref filesProcessed);
                    Interlocked.Add(ref bytesExtracted, extracted);
                    localBytesExtracted += extracted;

                    ReportProgress(index, file.FileName);
                }

                return localBytesExtracted;

                void ReportProgress(int fileIndex, string fileName)
                {
                    if (progress is null) return;

                    var currentProcessed = Volatile.Read(ref filesProcessed);
                    var currentBytes = Volatile.Read(ref bytesExtracted);

                    // Report every 10 files or every 100MB to avoid too frequent updates
                    if (currentProcessed % 10 == 0 || currentBytes % (100 * 1024 * 1024) < (50 * 1024 * 1024))
                    {
                        progress.Report(new ExtractionProgress(
                            currentProcessed,
                            totalFiles,
                            currentBytes,
                            totalBytes,
                            fileName,
                            stopwatch.Elapsed));
                    }
                }
            }, cancellationToken))
            .ToList();

        await producer;
        await Task.WhenAll(consumers);

        // Final progress report
        progress?.Report(new ExtractionProgress(
            totalFiles,
            totalFiles,
            bytesExtracted,
            totalBytes,
            "Complete",
            stopwatch.Elapsed));

        return bytesExtracted;
    }

    private unsafe ArrayRental ExtractFromMappedFile(in CpkFile file, out bool needsDecompression)
    {
        needsDecompression = false;
        if (file.FileSize == 0)
            return ArrayRental.Empty;

        using var accessor = _mappedFile!.CreateViewAccessor(file.FileOffset, file.FileSize, MemoryMappedFileAccess.Read);

        byte* ptr = null;
        accessor.SafeMemoryMappedViewHandle.AcquirePointer(ref ptr);
        try
        {
            var data = new ArrayRental(file.FileSize);
            new Span<byte>(ptr, file.FileSize).CopyTo(data.Span);

            fixed (byte* dataPtr = data.RawArray)
            {
                _decrypt?.Invoke(file, dataPtr, data.Count);
                needsDecompression = CriLayla.IsCompressed(dataPtr, out _);
            }

            return data;
        }
        finally
        {
            accessor.SafeMemoryMappedViewHandle.ReleasePointer();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _mappedFile?.Dispose();
        _readSemaphore.Dispose();
        _writeSemaphore.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        Dispose();
        await ValueTask.CompletedTask;
    }
}

/// <summary>
/// Empty memory owner implementation.
/// </summary>
internal sealed class EmptyMemoryOwner : IMemoryOwner<byte>
{
    public Memory<byte> Memory => Memory<byte>.Empty;
    public void Dispose() { }
}

/// <summary>
/// Memory owner wrapping an ArrayRental.
/// </summary>
internal sealed class ArrayRentalMemoryOwner : IMemoryOwner<byte>
{
    private ArrayRental _rental;

    public ArrayRentalMemoryOwner(ArrayRental rental)
    {
        _rental = rental;
    }

    public Memory<byte> Memory => _rental.RawArray.AsMemory(0, _rental.Count);

    public void Dispose()
    {
        _rental.Dispose();
    }
}

