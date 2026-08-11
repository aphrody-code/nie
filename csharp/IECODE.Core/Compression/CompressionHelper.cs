using System;
using System.IO;
using System.IO.Compression;
using K4os.Compression.LZ4;

namespace IECODE.Core.Compression;

public enum CompressionFormat { None, Lz10, Lz4, Zlib, GZip, Unknown }

/// <summary>
/// Unified compression detection, decompression, and compression.
/// Supported formats: LZ10, LZ4 (frame + block), Zlib, GZip.
/// </summary>
public static class CompressionHelper
{
    // -------------------------------------------------------------------------
    // Detection
    // -------------------------------------------------------------------------

    public static CompressionFormat DetectFormat(ReadOnlySpan<byte> data)
    {
        if (data.Length < 2) return CompressionFormat.None;
        if (Lz10Decoder.IsLz10Compressed(data)) return CompressionFormat.Lz10;
        if (Lz4Decoder.IsLz4Compressed(data)) return CompressionFormat.Lz4;
        if (IsZlib(data)) return CompressionFormat.Zlib;
        if (IsGZip(data)) return CompressionFormat.GZip;
        return CompressionFormat.None;
    }

    /// <summary>Zlib header: CM=8, CINFO≤7, CMF*256+FLG ≡ 0 (mod 31).</summary>
    public static bool IsZlib(ReadOnlySpan<byte> data)
    {
        if (data.Length < 2) return false;
        byte cmf = data[0], flg = data[1];
        return (cmf & 0x0F) == 8 && (cmf >> 4) <= 7 && (cmf * 256 + flg) % 31 == 0;
    }

    public static bool IsGZip(ReadOnlySpan<byte> data)
        => data.Length >= 2 && data[0] == 0x1F && data[1] == 0x8B;

    public static bool IsCompressed(ReadOnlySpan<byte> data)
        => DetectFormat(data) != CompressionFormat.None;

    // -------------------------------------------------------------------------
    // Decompression
    // -------------------------------------------------------------------------

    /// <summary>
    /// Auto-detect and decompress.
    /// Raw LZ4 blocks require <paramref name="expectedSize"/>.
    /// Returns a copy of the original data if no compression is detected.
    /// </summary>
    public static byte[] Decompress(ReadOnlySpan<byte> data, int expectedSize = -1)
    {
        return DetectFormat(data) switch
        {
            CompressionFormat.Lz10 => Lz10Decoder.Decompress(data),
            CompressionFormat.Lz4 => Lz4Decoder.Decompress(data, expectedSize),
            CompressionFormat.Zlib => DecompressZlib(data),
            CompressionFormat.GZip => DecompressGZip(data),
            CompressionFormat.None => data.ToArray(),
            _ => throw new NotSupportedException("Unsupported compression format.")
        };
    }

    public static bool TryDecompress(ReadOnlySpan<byte> data, out byte[] result, int expectedSize = -1)
    {
        try { result = Decompress(data, expectedSize); return true; }
        catch { result = data.ToArray(); return false; }
    }

    /// <summary>Decompress a Zlib-wrapped deflate stream.</summary>
    public static byte[] DecompressZlib(ReadOnlySpan<byte> data)
    {
        // Capacity hint: zlib typically achieves 2–4× expansion.
        using var input = new MemoryStream(data.ToArray());
        using var zlib = new ZLibStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream(data.Length * 3);
        zlib.CopyTo(output);
        return output.ToArray();
    }

    /// <summary>Decompress a GZip stream.</summary>
    public static byte[] DecompressGZip(ReadOnlySpan<byte> data)
    {
        using var input = new MemoryStream(data.ToArray());
        using var gz = new GZipStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream(data.Length * 3);
        gz.CopyTo(output);
        return output.ToArray();
    }

    /// <summary>Returns the decompressed size encoded in the header, or -1 if not available.</summary>
    public static int GetDecompressedSize(ReadOnlySpan<byte> data)
    {
        return DetectFormat(data) switch
        {
            CompressionFormat.Lz10 => Lz10Decoder.GetDecompressedSize(data),
            _ => -1
        };
    }

    public static byte[] DecompressFile(string path, int expectedSize = -1)
        => Decompress(File.ReadAllBytes(path), expectedSize);

    // -------------------------------------------------------------------------
    // Compression
    // -------------------------------------------------------------------------

    public static byte[] CompressLz4(ReadOnlySpan<byte> data, LZ4Level level = LZ4Level.L00_FAST)
        => Lz4Decoder.Compress(data, level);

    /// <summary>Compress to GZip. Output MemoryStream pre-sized to input length (compressed ≤ input).</summary>
    public static byte[] CompressGZip(ReadOnlySpan<byte> data, CompressionLevel level = CompressionLevel.Optimal)
    {
        using var output = new MemoryStream(data.Length);
        using (var gz = new GZipStream(output, level, leaveOpen: true))
            gz.Write(data);
        return output.ToArray();
    }

    /// <summary>Compress to Zlib (deflate with header).</summary>
    public static byte[] CompressZlib(ReadOnlySpan<byte> data, CompressionLevel level = CompressionLevel.Optimal)
    {
        using var output = new MemoryStream(data.Length);
        using (var zlib = new ZLibStream(output, level, leaveOpen: true))
            zlib.Write(data);
        return output.ToArray();
    }
}
