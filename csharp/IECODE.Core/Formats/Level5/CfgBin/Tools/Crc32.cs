using System;

namespace IECODE.Core.Formats.Level5.CfgBin.Tools
{
    /// <summary>
    /// CRC32 implementation compatible with netstandard2.0 and net8.0.
    /// Based on Damien Guard's implementation.
    /// Licensed under Apache License, Version 2.0.
    /// </summary>
    public static class Crc32
    {
        private const uint DefaultPolynomial = 0xedb88320u;
        private const uint DefaultSeed = 0xffffffffu;

        private static readonly uint[] Table = InitializeTable(DefaultPolynomial);

        private static uint[] InitializeTable(uint polynomial)
        {
            var table = new uint[256];
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

        public static uint Compute(byte[] buffer)
        {
            return Compute(DefaultSeed, buffer);
        }

        public static uint Compute(uint seed, byte[] buffer)
        {
            return ~CalculateHash(Table, seed, buffer, 0, buffer.Length);
        }

        public static uint Compute(uint polynomial, uint seed, byte[] buffer)
        {
            return ~CalculateHash(InitializeTable(polynomial), seed, buffer, 0, buffer.Length);
        }

#if NET8_0_OR_GREATER
        public static uint Compute(ReadOnlySpan<byte> buffer)
        {
            return ~CalculateHashSpan(Table, DefaultSeed, buffer);
        }

        private static uint CalculateHashSpan(uint[] table, uint seed, ReadOnlySpan<byte> buffer)
        {
            uint hash = seed;
            foreach (byte b in buffer)
            {
                hash = (hash >> 8) ^ table[(hash ^ b) & 0xff];
            }
            return hash;
        }
#endif

        private static uint CalculateHash(uint[] table, uint seed, byte[] buffer, int start, int size)
        {
            uint hash = seed;
            for (int i = start; i < start + size; i++)
            {
                hash = (hash >> 8) ^ table[(hash ^ buffer[i]) & 0xff];
            }
            return hash;
        }
    }
}
