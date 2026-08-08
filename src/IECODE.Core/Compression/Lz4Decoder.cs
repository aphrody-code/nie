using System;
using System.Buffers.Binary;
using K4os.Compression.LZ4;

namespace IECODE.Core.Compression;

/// <summary>
/// LZ4 decoder backed by K4os.Compression.LZ4.
/// Supports both LZ4 frame format (magic 0x184D2204) and raw block format.
/// </summary>
public static class Lz4Decoder
{
    // LZ4 frame magic — https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md
    private const uint FrameMagic = 0x184D2204;

    /// <summary>
    /// Decompress LZ4 data. Handles both frame and raw block format.
    /// </summary>
    /// <param name="input">Compressed data.</param>
    /// <param name="decompressedSize">Expected output size (required for raw block format).</param>
    public static byte[] Decompress(ReadOnlySpan<byte> input, int decompressedSize)
    {
        if (input.Length == 0)
            return [];

        // Frame format: let K4os handle framing (size embedded in frame)
        if (IsFrameFormat(input))
            return DecompressFrame(input);

        // Raw block format: output size must be known
        if (decompressedSize <= 0)
            throw new ArgumentException("Raw LZ4 block requires a positive decompressedSize.", nameof(decompressedSize));

        return DecompressBlock(input, decompressedSize);
    }

    /// <summary>
    /// Compress data to LZ4 frame format.
    /// </summary>
    public static byte[] Compress(ReadOnlySpan<byte> input, LZ4Level level = LZ4Level.L00_FAST)
    {
        var output = new byte[LZ4Codec.MaximumOutputSize(input.Length)];
        int written = LZ4Codec.Encode(input, output, level);
        return output[..written];
    }

    /// <summary>
    /// Compress data to LZ4 frame format into a pre-allocated buffer.
    /// Returns the number of bytes written.
    /// </summary>
    public static int Compress(ReadOnlySpan<byte> input, Span<byte> output, LZ4Level level = LZ4Level.L00_FAST)
        => LZ4Codec.Encode(input, output, level);

    /// <summary>
    /// Returns true if the data starts with the LZ4 frame magic number.
    /// Frame format is unambiguous; raw block format has no magic.
    /// </summary>
    public static bool IsLz4Compressed(ReadOnlySpan<byte> data)
        => data.Length >= 4 && BinaryPrimitives.ReadUInt32LittleEndian(data) == FrameMagic;

    // -------------------------------------------------------------------------

    private static bool IsFrameFormat(ReadOnlySpan<byte> data)
        => data.Length >= 4 && BinaryPrimitives.ReadUInt32LittleEndian(data) == FrameMagic;

    private static byte[] DecompressFrame(ReadOnlySpan<byte> input)
    {
        // Decode into a buffer sized at 4× compressed (grows if needed)
        int capacity = Math.Max(input.Length * 4, 4096);
        while (true)
        {
            var output = new byte[capacity];
            int decoded = LZ4Codec.Decode(input, output);
            if (decoded >= 0)
                return output[..decoded];
            capacity *= 2; // output too small — retry
        }
    }

    private static byte[] DecompressBlock(ReadOnlySpan<byte> input, int decompressedSize)
    {
        var output = new byte[decompressedSize];
        int decoded = LZ4Codec.Decode(input, output);
        if (decoded < 0)
            throw new InvalidDataException("LZ4 block decompression failed.");
        return decoded == decompressedSize ? output : output[..decoded];
    }
}
