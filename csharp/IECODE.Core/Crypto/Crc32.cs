using System;

namespace IECODE.Core.Crypto;

/// <summary>
/// CRC32 implementation based on Damien Guard's implementation.
/// Polynomial: 0xEDB88320
/// </summary>
public static class Crc32
{
    private const uint DefaultPolynomial = 0xedb88320u;
    private const uint DefaultSeed = 0xffffffffu;

    private static readonly uint[] Table = InitializeTable(DefaultPolynomial);

    private static uint[] InitializeTable(uint polynomial)
    {
        uint[] table = new uint[256];
        for (int i = 0; i < 256; i++)
        {
            uint entry = (uint)i;
            for (int j = 0; j < 8; j++)
            {
                if ((entry & 1) == 1)
                    entry = (entry >> 1) ^ polynomial;
                else
                    entry >>= 1;
            }
            table[i] = entry;
        }
        return table;
    }

    public static uint Compute(ReadOnlySpan<byte> buffer)
    {
        uint hash = DefaultSeed;
        foreach (byte b in buffer)
        {
            hash = (hash >> 8) ^ Table[(hash ^ b) & 0xff];
        }
        return ~hash;
    }

    public static uint Compute(uint seed, ReadOnlySpan<byte> buffer)
    {
        uint hash = seed;
        foreach (byte b in buffer)
        {
            hash = (hash >> 8) ^ Table[(hash ^ b) & 0xff];
        }
        return ~hash;
    }
}
