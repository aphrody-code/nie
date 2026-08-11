// TextureConverter — BC1-BC7 decompression to ImageSharp Image<Rgba32>
// Zero-copy path: ReadOnlyMemory<byte> → MemoryStream(no-copy) → BCnEncoder → MemoryMarshal.Cast

using System;
using System.Buffers;
using System.Buffers.Binary;
using System.IO;
using System.Runtime.InteropServices;
using BCnEncoder.Decoder;
using BCnEncoder.Shared;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace IECODE.Core.Graphics;

public enum TextureFormat
{
    Unknown      = 0,
    BC1_UNORM    = 1,
    BC2_UNORM    = 2,
    BC3_UNORM    = 3,
    BC4_UNORM    = 4,
    BC5_UNORM    = 5,
    BC6H_UFLOAT  = 6,
    BC7_UNORM    = 7,
    RGBA8_UNORM  = 15
}

public static class TextureConverter
{
    // -------------------------------------------------------------------------
    // Format mapping
    // -------------------------------------------------------------------------

    public static TextureFormat MapG4txFormat(int rawFormat) => rawFormat switch
    {
        0x18 => TextureFormat.RGBA8_UNORM,
        0x19 => TextureFormat.RGBA8_UNORM,
        0x1C => TextureFormat.BC1_UNORM,
        0x1D => TextureFormat.BC2_UNORM,
        0x1E => TextureFormat.BC3_UNORM,
        0x1F => TextureFormat.BC4_UNORM,
        0x20 => TextureFormat.BC5_UNORM,
        0x21 => TextureFormat.BC6H_UFLOAT,
        0x22 => TextureFormat.BC7_UNORM,
        1    => TextureFormat.BC1_UNORM,
        2    => TextureFormat.BC2_UNORM,
        3    => TextureFormat.BC3_UNORM,
        4    => TextureFormat.BC4_UNORM,
        5    => TextureFormat.BC5_UNORM,
        6    => TextureFormat.BC6H_UFLOAT,
        7    => TextureFormat.BC7_UNORM,
        15   => TextureFormat.RGBA8_UNORM,
        _    => TextureFormat.Unknown
    };

    // -------------------------------------------------------------------------
    // DDS → Image<Rgba32>
    // -------------------------------------------------------------------------

    public static Image<Rgba32> LoadDdsToImage(string path)
    {
        using var fs = File.OpenRead(path);
        return LoadDdsToImage(fs);
    }

    /// <summary>
    /// Zero-copy path: parses the DDS header directly from <paramref name="ddsData"/> using
    /// BinaryPrimitives, then wraps the pixel data in a non-allocating MemoryStream.
    /// </summary>
    public static Image<Rgba32> LoadDdsToImage(ReadOnlyMemory<byte> ddsData)
    {
        var span = ddsData.Span;
        var (format, width, height, dataOffset) = ParseDdsHeader(span);
        return DecodeToImage(ddsData[dataOffset..], width, height, format);
    }

    /// <summary>Span overload — one unavoidable copy when the span isn't heap-backed.</summary>
    public static Image<Rgba32> LoadDdsToImage(ReadOnlySpan<byte> ddsData)
    {
        var (format, width, height, dataOffset) = ParseDdsHeader(ddsData);
        // Wrap span in a pooled array to avoid double-copy.
        byte[] rented = ArrayPool<byte>.Shared.Rent(ddsData.Length - dataOffset);
        try
        {
            ddsData[dataOffset..].CopyTo(rented);
            using var ms = new MemoryStream(rented, 0, ddsData.Length - dataOffset, writable: false);
            return DecodeStreamToImage(ms, width, height, format);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }

    /// <summary>Stream path (e.g. File.OpenRead).</summary>
    public static Image<Rgba32> LoadDdsToImage(Stream stream)
    {
        var span   = ReadFully(stream);
        var memory = new ReadOnlyMemory<byte>(span);
        var (format, width, height, dataOffset) = ParseDdsHeader(memory.Span);
        return DecodeToImage(memory[dataOffset..], width, height, format);
    }

    // -------------------------------------------------------------------------
    // BC decompression → Rgba32
    // -------------------------------------------------------------------------

    /// <summary>
    /// Zero-copy path when <paramref name="data"/> is backed by a heap array.
    /// <br/>Result pixel buffer is <c>width × height</c> Rgba32 values.
    /// </summary>
    public static Image<Rgba32> DecompressToImage(
        ReadOnlyMemory<byte> data,
        int width, int height,
        TextureFormat format)
    {
        if (format == TextureFormat.RGBA8_UNORM)
            return LoadRgba8Direct(data, width, height);

        return DecodeToImage(data, width, height, ConvertToBcFormat(format));
    }

    /// <summary>Span overload — one copy. Prefer the Memory overload.</summary>
    public static Rgba32[] DecompressToRgba32(
        ReadOnlySpan<byte> data,
        int width, int height,
        TextureFormat format)
    {
        // Use the Memory path to benefit from zero-copy MemoryStream wrapping.
        using var img = DecompressToImage(new ReadOnlyMemory<byte>(data.ToArray()), width, height, format);
        // Extract pixel data via ProcessPixelRows → flat Rgba32[]
        var pixels = new Rgba32[width * height];
        img.ProcessPixelRows(acc =>
        {
            for (int y = 0; y < height; y++)
                acc.GetRowSpan(y).CopyTo(pixels.AsSpan(y * width));
        });
        return pixels;
    }

    // -------------------------------------------------------------------------
    // PNG / DDS export
    // -------------------------------------------------------------------------

    public static byte[] ConvertToPng(
        ReadOnlySpan<byte> data, int width, int height, TextureFormat format)
    {
        using var img = DecompressToImage(new ReadOnlyMemory<byte>(data.ToArray()), width, height, format);
        // Pre-size MemoryStream (PNG ≈ 30-60% of raw pixel data for typical textures).
        using var ms = new MemoryStream(width * height * 2);
        img.SaveAsPng(ms);
        return ms.ToArray();
    }

    public static byte[] ConvertToDds(
        ReadOnlySpan<byte> data, int width, int height,
        TextureFormat format, int mipCount = 1)
    {
        // Header is fixed-size; pre-allocate to avoid MemoryStream growth.
        bool isDx10       = format is TextureFormat.BC6H_UFLOAT or TextureFormat.BC7_UNORM;
        int  headerBytes  = isDx10 ? 148 : 128; // DDS_HEADER(128) + optional DX10(20)
        using var ms      = new MemoryStream(headerBytes + data.Length);
        using var writer  = new BinaryWriter(ms);
        WriteDdsHeader(writer, width, height, format, mipCount);
        writer.Write(data);
        return ms.ToArray();
    }

    // -------------------------------------------------------------------------
    // Misc helpers
    // -------------------------------------------------------------------------

    public static bool IsBlockCompressed(TextureFormat format) => format != TextureFormat.RGBA8_UNORM;

    public static int CalculateTextureDataSize(int width, int height, TextureFormat format, int mipCount = 1)
    {
        int blockSize = GetBlockSize(format);
        int total     = 0;
        for (int i = 0; i < mipCount; i++)
        {
            int mw = Math.Max(1, width >> i);
            int mh = Math.Max(1, height >> i);
            total += format == TextureFormat.RGBA8_UNORM
                ? mw * mh * 4
                : ((mw + 3) / 4) * ((mh + 3) / 4) * blockSize;
        }
        return total;
    }

    // -------------------------------------------------------------------------
    // Core decode — shared by all public paths
    // -------------------------------------------------------------------------

    private static Image<Rgba32> DecodeToImage(
        ReadOnlyMemory<byte> pixelData,
        int width, int height,
        CompressionFormat bcFormat)
    {
        if (MemoryMarshal.TryGetArray(pixelData, out var segment))
        {
            // Zero-copy: wrap the existing heap array without allocating.
            using var ms = new MemoryStream(segment.Array!, segment.Offset, segment.Count, writable: false);
            return DecodeStreamToImage(ms, width, height, bcFormat);
        }

        // Fallback (should be rare — span from unmanaged memory, stackalloc, etc.)
        byte[] rented = ArrayPool<byte>.Shared.Rent(pixelData.Length);
        try
        {
            pixelData.CopyTo(rented);
            using var ms = new MemoryStream(rented, 0, pixelData.Length, writable: false);
            return DecodeStreamToImage(ms, width, height, bcFormat);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }

    private static Image<Rgba32> DecodeStreamToImage(
        Stream data, int width, int height, CompressionFormat bcFormat)
    {
        var decoder  = new BcDecoder();
        var bcPixels = decoder.DecodeRaw(data, width, height, bcFormat);

        // ColorRgba32 (BCnEncoder) and Rgba32 (ImageSharp) share identical 4-byte RGBA layout.
        // MemoryMarshal.Cast is zero-copy — no allocation, no loop.
        var pixelSpan = MemoryMarshal.Cast<ColorRgba32, Rgba32>(bcPixels);
        return Image.LoadPixelData<Rgba32>(pixelSpan, width, height);
    }

    private static Image<Rgba32> LoadRgba8Direct(ReadOnlyMemory<byte> data, int width, int height)
    {
        // Raw RGBA8: 4 bytes per pixel — cast directly.
        var pixelSpan = MemoryMarshal.Cast<byte, Rgba32>(data.Span);
        return Image.LoadPixelData<Rgba32>(pixelSpan, width, height);
    }

    // -------------------------------------------------------------------------
    // DDS header parser (direct span — no MemoryStream)
    // -------------------------------------------------------------------------

    private static (CompressionFormat format, int width, int height, int dataOffset)
        ParseDdsHeader(ReadOnlySpan<byte> s)
    {
        if (s.Length < 128)
            throw new InvalidDataException("DDS data too small");
        if (BinaryPrimitives.ReadUInt32LittleEndian(s) != 0x20534444)
            throw new InvalidDataException("Invalid DDS magic");

        int height = BinaryPrimitives.ReadInt32LittleEndian(s[12..]);
        int width  = BinaryPrimitives.ReadInt32LittleEndian(s[16..]);

        // Skip to PixelFormat (offset 76)
        uint fourCC = BinaryPrimitives.ReadUInt32LittleEndian(s[84..]);

        CompressionFormat format;
        int dataOffset = 128;

        if (fourCC == 0x30315844) // "DX10"
        {
            if (s.Length < 148)
                throw new InvalidDataException("DDS DX10 header incomplete");
            uint dxgiFormat = BinaryPrimitives.ReadUInt32LittleEndian(s[128..]);
            format     = MapDxgiFormat(dxgiFormat);
            dataOffset = 148;
        }
        else
        {
            format = MapFourCC(fourCC);
        }

        return (format, width, height, dataOffset);
    }

    // -------------------------------------------------------------------------
    // DDS header writer
    // -------------------------------------------------------------------------

    private static void WriteDdsHeader(BinaryWriter w, int width, int height, TextureFormat format, int mipCount)
    {
        bool isDx10 = format is TextureFormat.BC6H_UFLOAT or TextureFormat.BC7_UNORM;
        w.Write(0x20534444u);
        w.Write(124);
        w.Write(0x1 | 0x2 | 0x4 | 0x1000 | 0x20000);
        w.Write(height);
        w.Write(width);
        w.Write(0); w.Write(0); w.Write(mipCount);
        for (int i = 0; i < 11; i++) w.Write(0);
        w.Write(32); w.Write(0x4);
        WriteFourCC(w, format);
        w.Write(0); w.Write(0u); w.Write(0u); w.Write(0u); w.Write(0u);
        w.Write(0x1000 | 0x8 | 0x400000);
        w.Write(0); w.Write(0); w.Write(0); w.Write(0);
        if (isDx10)
        {
            uint dxgi = format == TextureFormat.BC6H_UFLOAT ? 95u : 98u;
            w.Write(dxgi); w.Write(3); w.Write(0); w.Write(1); w.Write(0);
        }
    }

    private static void WriteFourCC(BinaryWriter w, TextureFormat fmt) =>
        w.Write(fmt switch
        {
            TextureFormat.BC1_UNORM    => 0x31545844u,
            TextureFormat.BC2_UNORM    => 0x33545844u,
            TextureFormat.BC3_UNORM    => 0x35545844u,
            TextureFormat.BC4_UNORM    => 0x31495441u,
            TextureFormat.BC5_UNORM    => 0x32495441u,
            TextureFormat.BC6H_UFLOAT  => 0x30315844u,
            TextureFormat.BC7_UNORM    => 0x30315844u,
            _ => throw new NotSupportedException($"No FourCC for {fmt}")
        });

    // -------------------------------------------------------------------------
    // BCnEncoder format mapping
    // -------------------------------------------------------------------------

    private static CompressionFormat ConvertToBcFormat(TextureFormat fmt) => fmt switch
    {
        TextureFormat.BC1_UNORM   => CompressionFormat.Bc1,
        TextureFormat.BC2_UNORM   => CompressionFormat.Bc2,
        TextureFormat.BC3_UNORM   => CompressionFormat.Bc3,
        TextureFormat.BC4_UNORM   => CompressionFormat.Bc4,
        TextureFormat.BC5_UNORM   => CompressionFormat.Bc5,
        TextureFormat.BC6H_UFLOAT => CompressionFormat.Bc6U,
        TextureFormat.BC7_UNORM   => CompressionFormat.Bc7,
        _ => throw new NotSupportedException($"Unsupported format: {fmt}")
    };

    private static CompressionFormat MapFourCC(uint fcc) => fcc switch
    {
        0x31545844 => CompressionFormat.Bc1,
        0x33545844 => CompressionFormat.Bc2,
        0x35545844 => CompressionFormat.Bc3,
        0x31495441 => CompressionFormat.Bc4,
        0x32495441 => CompressionFormat.Bc5,
        _          => CompressionFormat.Unknown
    };

    private static CompressionFormat MapDxgiFormat(uint dxgi) => dxgi switch
    {
        71  => CompressionFormat.Bc1,
        74  => CompressionFormat.Bc2,
        77  => CompressionFormat.Bc3,
        80  => CompressionFormat.Bc4,
        83  => CompressionFormat.Bc5,
        95  => CompressionFormat.Bc6U,
        98  => CompressionFormat.Bc7,
        _   => CompressionFormat.Unknown
    };

    // -------------------------------------------------------------------------
    // Misc
    // -------------------------------------------------------------------------

    private static int GetBlockSize(TextureFormat fmt) => fmt switch
    {
        TextureFormat.BC1_UNORM   => 8,
        TextureFormat.BC4_UNORM   => 8,
        TextureFormat.BC2_UNORM   => 16,
        TextureFormat.BC3_UNORM   => 16,
        TextureFormat.BC5_UNORM   => 16,
        TextureFormat.BC6H_UFLOAT => 16,
        TextureFormat.BC7_UNORM   => 16,
        TextureFormat.RGBA8_UNORM => 4,
        _ => throw new NotSupportedException($"Unknown format: {fmt}")
    };

    private static byte[] ReadFully(Stream stream)
    {
        if (stream is MemoryStream ms)
            return ms.ToArray();
        using var buf = new MemoryStream((int)(stream.Length > 0 ? stream.Length : 64 * 1024));
        stream.CopyTo(buf);
        return buf.ToArray();
    }
}
