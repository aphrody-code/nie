using System.Buffers;
using System.IO.Compression;

namespace IECODE.Core.Native;

/// <summary>
/// Native .NET compression wrappers following Microsoft best practices.
/// Replaces Kuriimu2.Kompression for standard compression formats.
/// </summary>
/// <remarks>
/// Uses System.IO.Compression APIs:
/// - DeflateStream for raw DEFLATE
/// - GZipStream for GZIP format
/// - BrotliStream for Brotli compression
/// - ZLibStream for ZLib format (.NET 6+)
/// See: https://learn.microsoft.com/en-us/dotnet/standard/io/how-to-compress-and-extract-files
/// </remarks>
public static class NativeCompression
{
    /// <summary>
    /// Compresses data using DEFLATE algorithm.
    /// </summary>
    public static byte[] CompressDeflate(ReadOnlySpan<byte> data, CompressionLevel level = CompressionLevel.Optimal)
    {
        using var output = new MemoryStream();
        using (var deflate = new DeflateStream(output, level, leaveOpen: true))
        {
            deflate.Write(data);
        }
        return output.ToArray();
    }

    /// <summary>
    /// Decompresses DEFLATE compressed data.
    /// </summary>
    public static byte[] DecompressDeflate(ReadOnlySpan<byte> data)
    {
        using var input = new MemoryStream(data.ToArray());
        using var deflate = new DeflateStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        deflate.CopyTo(output);
        return output.ToArray();
    }

    /// <summary>
    /// Compresses data using GZip format.
    /// </summary>
    public static byte[] CompressGZip(ReadOnlySpan<byte> data, CompressionLevel level = CompressionLevel.Optimal)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, level, leaveOpen: true))
        {
            gzip.Write(data);
        }
        return output.ToArray();
    }

    /// <summary>
    /// Decompresses GZip compressed data.
    /// </summary>
    public static byte[] DecompressGZip(ReadOnlySpan<byte> data)
    {
        using var input = new MemoryStream(data.ToArray());
        using var gzip = new GZipStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        gzip.CopyTo(output);
        return output.ToArray();
    }

    /// <summary>
    /// Compresses data using Brotli algorithm.
    /// Better compression ratio than GZip for text.
    /// </summary>
    public static byte[] CompressBrotli(ReadOnlySpan<byte> data, CompressionLevel level = CompressionLevel.Optimal)
    {
        using var output = new MemoryStream();
        using (var brotli = new BrotliStream(output, level, leaveOpen: true))
        {
            brotli.Write(data);
        }
        return output.ToArray();
    }

    /// <summary>
    /// Decompresses Brotli compressed data.
    /// </summary>
    public static byte[] DecompressBrotli(ReadOnlySpan<byte> data)
    {
        using var input = new MemoryStream(data.ToArray());
        using var brotli = new BrotliStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        brotli.CopyTo(output);
        return output.ToArray();
    }

    /// <summary>
    /// Compresses data using ZLib format (DEFLATE with ZLib header).
    /// </summary>
    public static byte[] CompressZLib(ReadOnlySpan<byte> data, CompressionLevel level = CompressionLevel.Optimal)
    {
        using var output = new MemoryStream();
        using (var zlib = new ZLibStream(output, level, leaveOpen: true))
        {
            zlib.Write(data);
        }
        return output.ToArray();
    }

    /// <summary>
    /// Decompresses ZLib compressed data.
    /// </summary>
    public static byte[] DecompressZLib(ReadOnlySpan<byte> data)
    {
        using var input = new MemoryStream(data.ToArray());
        using var zlib = new ZLibStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        zlib.CopyTo(output);
        return output.ToArray();
    }

    /// <summary>
    /// Asynchronously compresses a stream using DEFLATE.
    /// </summary>
    public static async Task CompressDeflateAsync(Stream input, Stream output, CompressionLevel level = CompressionLevel.Optimal, CancellationToken ct = default)
    {
        await using var deflate = new DeflateStream(output, level, leaveOpen: true);
        await input.CopyToAsync(deflate, ct);
    }

    /// <summary>
    /// Asynchronously decompresses a DEFLATE stream.
    /// </summary>
    public static async Task DecompressDeflateAsync(Stream input, Stream output, CancellationToken ct = default)
    {
        await using var deflate = new DeflateStream(input, CompressionMode.Decompress, leaveOpen: true);
        await deflate.CopyToAsync(output, ct);
    }

    /// <summary>
    /// Asynchronously compresses a stream using GZip.
    /// </summary>
    public static async Task CompressGZipAsync(Stream input, Stream output, CompressionLevel level = CompressionLevel.Optimal, CancellationToken ct = default)
    {
        await using var gzip = new GZipStream(output, level, leaveOpen: true);
        await input.CopyToAsync(gzip, ct);
    }

    /// <summary>
    /// Asynchronously decompresses a GZip stream.
    /// </summary>
    public static async Task DecompressGZipAsync(Stream input, Stream output, CancellationToken ct = default)
    {
        await using var gzip = new GZipStream(input, CompressionMode.Decompress, leaveOpen: true);
        await gzip.CopyToAsync(output, ct);
    }

    /// <summary>
    /// Asynchronously compresses a stream using Brotli.
    /// </summary>
    public static async Task CompressBrotliAsync(Stream input, Stream output, CompressionLevel level = CompressionLevel.Optimal, CancellationToken ct = default)
    {
        await using var brotli = new BrotliStream(output, level, leaveOpen: true);
        await input.CopyToAsync(brotli, ct);
    }

    /// <summary>
    /// Asynchronously decompresses a Brotli stream.
    /// </summary>
    public static async Task DecompressBrotliAsync(Stream input, Stream output, CancellationToken ct = default)
    {
        await using var brotli = new BrotliStream(input, CompressionMode.Decompress, leaveOpen: true);
        await brotli.CopyToAsync(output, ct);
    }

    /// <summary>
    /// Creates a ZIP archive from a directory.
    /// </summary>
    public static void CreateZipFromDirectory(string sourceDir, string destinationZip, CompressionLevel level = CompressionLevel.Optimal)
    {
        ZipFile.CreateFromDirectory(sourceDir, destinationZip, level, includeBaseDirectory: false);
    }

    /// <summary>
    /// Extracts a ZIP archive to a directory.
    /// </summary>
    public static void ExtractZipToDirectory(string sourceZip, string destinationDir, bool overwrite = false)
    {
        ZipFile.ExtractToDirectory(sourceZip, destinationDir, overwriteFiles: overwrite);
    }

    /// <summary>
    /// Opens a ZIP archive for reading or writing.
    /// </summary>
    public static ZipArchive OpenZip(string path, ZipArchiveMode mode = ZipArchiveMode.Read)
    {
        return ZipFile.Open(path, mode);
    }

    /// <summary>
    /// Opens a ZIP archive from a stream.
    /// </summary>
    public static ZipArchive OpenZip(Stream stream, ZipArchiveMode mode = ZipArchiveMode.Read, bool leaveOpen = false)
    {
        return new ZipArchive(stream, mode, leaveOpen);
    }
}
