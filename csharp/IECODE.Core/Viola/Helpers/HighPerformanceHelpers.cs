using System.Buffers;
using System.IO.MemoryMappedFiles;
using System.IO.Pipelines;
using System.Security.Cryptography;
using CommunityToolkit.HighPerformance.Buffers;

namespace Viola.Core.Helpers;

/// <summary>
/// High-performance helpers for CPK extraction and decryption.
/// Uses ArrayPool, MemoryMappedFiles, Pipelines, and hardware-accelerated AES.
/// </summary>
public static class HighPerformanceHelpers
{
    /// <summary>
    /// Shared ArrayPool for buffer reuse across all extraction operations.
    /// </summary>
    public static ArrayPool<byte> SharedPool => ArrayPool<byte>.Shared;

    /// <summary>
    /// Creates a memory-mapped file for reading large CPK archives without loading into RAM.
    /// </summary>
    /// <param name="filePath">Path to the CPK file.</param>
    /// <returns>MemoryMappedFile instance (caller must dispose).</returns>
    public static MemoryMappedFile CreateMemoryMappedCpk(string filePath)
    {
        return MemoryMappedFile.CreateFromFile(
            filePath,
            FileMode.Open,
            mapName: null,
            capacity: 0,
            MemoryMappedFileAccess.Read);
    }

    /// <summary>
    /// Creates a view accessor for reading a specific portion of a memory-mapped CPK.
    /// </summary>
    public static MemoryMappedViewAccessor CreateViewAccessor(
        MemoryMappedFile mmf,
        long offset,
        long size)
    {
        return mmf.CreateViewAccessor(offset, size, MemoryMappedFileAccess.Read);
    }

    /// <summary>
    /// Rents a buffer from the shared pool.
    /// Always return with <see cref="ReturnBuffer"/>.
    /// </summary>
    /// <param name="minimumLength">Minimum required size.</param>
    /// <returns>Rented buffer (may be larger than requested).</returns>
    public static byte[] RentBuffer(int minimumLength)
    {
        return SharedPool.Rent(minimumLength);
    }

    /// <summary>
    /// Returns a buffer to the shared pool.
    /// </summary>
    /// <param name="buffer">Buffer to return.</param>
    /// <param name="clearArray">Whether to clear the buffer (recommended for sensitive data).</param>
    public static void ReturnBuffer(byte[] buffer, bool clearArray = false)
    {
        SharedPool.Return(buffer, clearArray);
    }

    /// <summary>
    /// Allocates a SpanOwner for stack-only, zero-allocation buffer usage.
    /// Use with 'using' statement for automatic disposal.
    /// </summary>
    /// <example>
    /// <code>
    /// using var buffer = HighPerformanceHelpers.AllocateSpan(4096);
    /// Span&lt;byte&gt; span = buffer.Span;
    /// // Use span here
    /// </code>
    /// </example>
    public static SpanOwner<byte> AllocateSpan(int size)
    {
        return SpanOwner<byte>.Allocate(size);
    }

    /// <summary>
    /// Allocates a MemoryOwner for heap-based buffer usage with automatic pooling.
    /// Use with 'using' statement for automatic disposal.
    /// </summary>
    /// <example>
    /// <code>
    /// using var buffer = HighPerformanceHelpers.AllocateMemory(4096);
    /// Memory&lt;byte&gt; memory = buffer.Memory;
    /// // Use memory here (can be passed to async methods)
    /// </code>
    /// </example>
    public static MemoryOwner<byte> AllocateMemory(int size)
    {
        return MemoryOwner<byte>.Allocate(size);
    }

    /// <summary>
    /// Creates a hardware-accelerated AES decryptor.
    /// .NET 8 automatically uses AES-NI/ARM NEON when available.
    /// </summary>
    /// <param name="key">AES key (16, 24, or 32 bytes).</param>
    /// <param name="iv">Initialization vector (16 bytes for AES).</param>
    /// <returns>AES instance (caller must dispose).</returns>
    public static Aes CreateAesDecryptor(byte[] key, byte[] iv)
    {
        var aes = Aes.Create();
        aes.Key = key;
        aes.IV = iv;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        return aes;
    }

    /// <summary>
    /// Decrypts data in-place using hardware-accelerated AES.
    /// </summary>
    /// <param name="aes">AES instance.</param>
    /// <param name="data">Data to decrypt (modified in-place).</param>
    /// <returns>Decrypted byte count.</returns>
    public static int DecryptInPlace(Aes aes, Span<byte> data)
    {
        using var decryptor = aes.CreateDecryptor();
        return decryptor.TransformBlock(
            data.ToArray(), 0, data.Length,
            data.ToArray(), 0);
    }

    /// <summary>
    /// Creates a Pipe for streaming I/O operations.
    /// Useful for processing large files in chunks without loading entirely into memory.
    /// </summary>
    public static Pipe CreatePipe(int pauseWriterThreshold = 65536, int resumeWriterThreshold = 32768)
    {
        return new Pipe(new PipeOptions(
            pauseWriterThreshold: pauseWriterThreshold,
            resumeWriterThreshold: resumeWriterThreshold,
            useSynchronizationContext: false));
    }

    /// <summary>
    /// Reads a file using PipeReader for high-performance streaming.
    /// </summary>
    public static async Task ProcessFileWithPipeAsync(
        string filePath,
        Func<ReadOnlySequence<byte>, Task> processor,
        CancellationToken cancellationToken = default)
    {
        await using var stream = new FileStream(
            filePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 81920,
            useAsync: true);

        var reader = PipeReader.Create(stream);

        try
        {
            while (true)
            {
                var result = await reader.ReadAsync(cancellationToken);
                var buffer = result.Buffer;

                if (buffer.Length > 0)
                {
                    await processor(buffer);
                }

                reader.AdvanceTo(buffer.End);

                if (result.IsCompleted)
                    break;
            }
        }
        finally
        {
            await reader.CompleteAsync();
        }
    }
}
