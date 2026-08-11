using System.Runtime.CompilerServices;
using System.Text;

namespace IECODE.Core.Formats.Criware.CriFs.Encryption;

/// <summary>
/// Decryption for CRI Middleware encrypted CPK files (Level-5 games like Inazuma Eleven).
/// The encryption key is derived from the CPK filename using CRC32.
/// High-performance implementation with loop unrolling and minimal branching.
/// </summary>
public static class CriwareCrypt
{
    private static uint[]? _crc32Table;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void InitializeTable()
    {
        if (_crc32Table != null) return;
        _crc32Table = new uint[256];
        const uint polynomial = 0xEDB88320;
        for (uint i = 0; i < 256; i++)
        {
            uint crc = i;
            for (uint j = 8; j > 0; j--)
                crc = (crc & 1) == 1 ? (crc >> 1) ^ polynomial : crc >> 1;
            _crc32Table[i] = crc;
        }
    }

    /// <summary>
    /// Calculates the decryption key from the CPK filename.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static uint CalculateKeyFromFilename(string filename)
    {
        InitializeTable();
        uint crc = 0xFFFFFFFF;
        foreach (byte b in Encoding.UTF8.GetBytes(filename))
            crc = (crc >> 8) ^ _crc32Table![(byte)((crc ^ b) & 0xFF)];
        return ~crc;
    }

    /// <summary>
    /// Decrypts a block of data in-place. Optimized with loop unrolling.
    /// </summary>
    [SkipLocalsInit]
    public static void DecryptBlock(Span<byte> buffer, long fileOffset, uint key)
    {
        if (buffer.IsEmpty) return;

        InitializeTable();

        // Pré-calculer les bytes de la clé
        byte k0 = (byte)key;
        byte k1 = (byte)(key >> 8);
        byte k2 = (byte)(key >> 16);
        byte k3 = (byte)(key >> 24);

        int length = buffer.Length;
        int i = 0;

        // Aligner sur une frontière de 4 bytes si nécessaire
        long alignOffset = fileOffset & 3;
        if (alignOffset != 0)
        {
            uint currentCrc = UpdateCrcStateFast((uint)(fileOffset & -4), k0, k1, k2, k3);
            int alignCount = Math.Min((int)(4 - alignOffset), length);
            for (int j = 0; j < alignCount; j++, i++)
            {
                buffer[i] ^= ComputeXorByte(currentCrc, (int)((fileOffset + i) & 3));
            }
        }

        // Boucle principale : traiter 4 bytes à la fois (un bloc CRC complet)
        long baseOffset = fileOffset + i;
        while (i + 4 <= length)
        {
            uint crc = UpdateCrcStateFast((uint)baseOffset, k0, k1, k2, k3);

            // Unrolled: calcul des 4 XOR bytes en une fois
            buffer[i] ^= ComputeXorByte(crc, 0);
            buffer[i + 1] ^= ComputeXorByte(crc, 1);
            buffer[i + 2] ^= ComputeXorByte(crc, 2);
            buffer[i + 3] ^= ComputeXorByte(crc, 3);

            i += 4;
            baseOffset += 4;
        }

        // Traiter les bytes restants
        if (i < length)
        {
            uint crc = UpdateCrcStateFast((uint)baseOffset, k0, k1, k2, k3);
            for (int pos = 0; i < length; i++, pos++)
            {
                buffer[i] ^= ComputeXorByte(crc, pos);
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static byte ComputeXorByte(uint crc, int position)
    {
        int baseShift = position * 2;
        uint r8 = (crc >> (baseShift + 8)) & 3;
        r8 |= ((crc >> baseShift) & 0xFF) << 2 & 0xFF;
        r8 = ((r8 << 2) & 0xFF) | ((crc >> (baseShift + 16)) & 3);
        r8 = ((r8 << 2) & 0xFF) | ((crc >> (baseShift + 24)) & 3);
        return (byte)r8;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static uint UpdateCrcStateFast(uint seed, byte k0, byte k1, byte k2, byte k3)
    {
        uint crc = ~seed;
        crc = (crc >> 8) ^ _crc32Table![(byte)(crc & 0xFF) ^ k0];
        crc = (crc >> 8) ^ _crc32Table[(byte)(crc & 0xFF) ^ k1];
        crc = (crc >> 8) ^ _crc32Table[(byte)(crc & 0xFF) ^ k2];
        crc = (crc >> 8) ^ _crc32Table[(byte)(crc & 0xFF) ^ k3];
        return ~crc;
    }

    private static uint UpdateCrcState(uint seed, ReadOnlySpan<byte> keys)
    {
        uint crc = ~seed;
        for (int k = 0; k < 4; k++)
            crc = (crc >> 8) ^ _crc32Table![(byte)(crc & 0xFF) ^ keys[k]];
        return ~crc;
    }
}
