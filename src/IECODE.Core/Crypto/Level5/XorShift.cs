using System;
using System.Buffers.Binary;
using System.Runtime.InteropServices;

namespace IECODE.Core.Crypto.Level5;

/// <summary>
/// Level5 Decrypt & Encrypt (XORShift Algorithm)
/// Original Source from yw_save.py by togenyan
/// Converted to C# by Tinifan, adapted for IECODE by Antigravity.
/// </summary>
public static class XorShift
{
    private static readonly ushort[] OddPrimes =
    {
        3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73,
        79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157,
        163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239,
        241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317, 331,
        337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419, 421,
        431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503, 509,
        521, 523, 541, 547, 557, 563, 569, 571, 577, 587, 593, 599, 601, 607, 613,
        617, 619, 631, 641, 643, 647, 653, 659, 661, 673, 677, 683, 691, 701, 709,
        719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797, 809, 811, 821,
        823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883, 887, 907, 911, 919,
        929, 937, 941, 947, 953, 967, 971, 977, 983, 991, 997, 1009, 1013, 1019,
        1021, 1031, 1033, 1039, 1049, 1051, 1061, 1063, 1069, 1087, 1091, 1093,
        1097, 1103, 1109, 1117, 1123, 1129, 1151, 1153, 1163, 1171, 1181, 1187,
        1193, 1201, 1213, 1217, 1223, 1229, 1231, 1237, 1249, 1259, 1277, 1279,
        1283, 1289, 1291, 1297, 1301, 1303, 1307, 1319, 1321, 1327, 1361, 1367,
        1373, 1381, 1399, 1409, 1423, 1427, 1429, 1433, 1439, 1447, 1451, 1453,
        1459, 1471, 1481, 1483, 1487, 1489, 1493, 1499, 1511, 1523, 1531, 1543,
        1549, 1553, 1559, 1567, 1571, 1579, 1583, 1597, 1601, 1607, 1609, 1613,
        1619, 1621
    };

    public static byte[] Decompress(byte[] input)
    {
        byte[] output = new byte[input.Length];
        Span<byte> outputSpan = output.AsSpan();
        input.CopyTo(outputSpan);

        Process(outputSpan);

        // Copy the last 8 bytes (checksum and seed) as they are usually not encrypted
        Array.Copy(input, input.Length - 8, output, input.Length - 8, 8);

        return output;
    }

    public static byte[] Compress(byte[] input)
    {
        // For XORShift, encryption is the same as decryption
        byte[] output = Decompress(input);

        // Calculate CRC32 on the encrypted data (excluding the last 8 bytes)
        uint crc = Crc32.Compute(output.AsSpan(0, output.Length - 8));

        // Write CRC32 at offset -8
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(output.Length - 8), crc);

        // Seed (offset -4) remains the same as in input
        return output;
    }

    public static void Process(Span<byte> data)
    {
        if (data.Length < 8) return;

        byte[] table = new byte[256];
        for (int i = 0; i < 256; i++) table[i] = (byte)i;

        uint seed = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(data.Length - 4));

        // Generate State List
        uint[] states = new uint[4];
        uint start = seed;
        for (int i = 0; i < 3; i++)
        {
            start = start ^ (start >> 30);
            start = (uint)(i + 1 + start * (0x6C078966u - 1u));
            states[i] = start;
        }
        states[3] = 0x03DF95B3u;

        // Shuffle Table
        for (int i = 0; i < 4096; i++)
        {
            int r = Shift(states, 0x10000);
            int r1 = r & 0xFF;
            int r2 = (r >> 8) & 0xFF;

            if (r1 != r2)
            {
                byte temp = table[r1];
                table[r1] = table[r2];
                table[r2] = temp;
            }
        }

        // XOR Process
        int ka = 0;
        int limit = data.Length - 8;
        for (int i = 0; i < limit; i++)
        {
            if (i % 0x100 == 0)
            {
                ka = OddPrimes[table[(i & 0xFF00) >> 8]];
            }
            int kb = table[(ka * (i + 1)) & 0xFF];
            data[i] ^= (byte)kb;
        }
    }

    private static int Shift(uint[] states, int arg)
    {
        uint x = states[0];
        uint y = states[3];
        states[0] = states[1];
        states[1] = states[2];
        states[2] = states[3];

        x = x ^ (x << 11);
        x = x ^ (x >> 8);
        y = y ^ (y >> 19);

        states[3] = x ^ y;

        if (arg == 0) return (int)states[3];
        return (int)(states[3] % (uint)arg);
    }
}
