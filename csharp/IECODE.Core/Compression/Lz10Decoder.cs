// LZ10 Decoder — Nintendo/Level-5 compression
// Format: 0x10 + 24-bit decompressed size + compressed data
// AOT-Compatible. No heap alloc for the sliding window (stackalloc).

using System;
using System.IO;

namespace IECODE.Core.Compression;

public static class Lz10Decoder
{
    public const byte MAGIC = 0x10;
    private const int WINDOW_SIZE = 0x1000; // 4 096 bytes

    public static byte[] Decompress(ReadOnlySpan<byte> input)
    {
        if (input.Length < 4)
            throw new InvalidDataException("Input too small for LZ10 header");

        if (input[0] != MAGIC)
            throw new InvalidDataException($"Invalid LZ10 magic: 0x{input[0]:X2}");

        int decompressedSize = input[1] | (input[2] << 8) | (input[3] << 16);
        if (decompressedSize <= 0)
            throw new InvalidDataException($"Invalid decompressed size: {decompressedSize}");

        return DecompressHeaderless(input[4..], decompressedSize);
    }

    public static byte[] DecompressHeaderless(ReadOnlySpan<byte> input, int decompressedSize)
    {
        var output = new byte[decompressedSize];

        // Sliding window on the stack — avoids a 4 096-byte heap alloc per call.
        Span<byte> window = stackalloc byte[WINDOW_SIZE];
        int winPos = 0;

        int inputPos = 0;
        int outputPos = 0;
        int flags = 0;
        int mask = 1;

        while (outputPos < decompressedSize && inputPos < input.Length)
        {
            if (mask == 1)
            {
                if (inputPos >= input.Length)
                    throw new InvalidDataException("Unexpected end of compressed data");
                flags = input[inputPos++];
                mask = 0x80;
            }
            else
            {
                mask >>= 1;
            }

            if ((flags & mask) != 0)
            {
                // Back-reference
                if (inputPos + 2 > input.Length)
                    throw new InvalidDataException("Unexpected end of compressed block");

                byte b0 = input[inputPos++];
                byte b1 = input[inputPos++];

                int length = (b0 >> 4) + 3;
                int displacement = (((b0 & 0x0F) << 8) | b1) + 1;

                if (displacement > winPos && displacement > WINDOW_SIZE)
                    throw new InvalidDataException($"Invalid LZ10 displacement: {displacement}");

                for (int i = 0; i < length && outputPos < decompressedSize; i++)
                {
                    byte value = window[(winPos - displacement + WINDOW_SIZE) % WINDOW_SIZE];
                    output[outputPos++] = value;
                    window[winPos % WINDOW_SIZE] = value;
                    winPos++;
                }
            }
            else
            {
                // Literal byte
                if (inputPos >= input.Length)
                    throw new InvalidDataException("Unexpected end of uncompressed data");

                byte value = input[inputPos++];
                if (outputPos < decompressedSize)
                {
                    output[outputPos++] = value;
                    window[winPos % WINDOW_SIZE] = value;
                    winPos++;
                }
            }
        }

        return output;
    }

    public static bool IsLz10Compressed(ReadOnlySpan<byte> data)
        => data.Length >= 4 && data[0] == MAGIC;

    public static int GetDecompressedSize(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4 || data[0] != MAGIC) return -1;
        return data[1] | (data[2] << 8) | (data[3] << 16);
    }
}
