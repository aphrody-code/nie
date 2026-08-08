using System;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;

namespace IECODE.Core.Formats.Level5.CfgBin.Encryption
{
    /// <summary>
    /// Decryption for CRI Middleware encrypted files (Level-5 games like Inazuma Eleven).
    /// The encryption key is derived from the filename using CRC32.
    /// Based on IECODE.Core.Formats.Criware.CriFs implementation.
    /// </summary>
    public static class CriwareCrypt
    {
        private static readonly uint[] Crc32Table = InitializeTable();

        private static uint[] InitializeTable()
        {
            var table = new uint[256];
            const uint polynomial = 0xEDB88320;
            for (uint i = 0; i < 256; i++)
            {
                uint crc = i;
                for (uint j = 8; j > 0; j--)
                    crc = (crc & 1) == 1 ? (crc >> 1) ^ polynomial : crc >> 1;
                table[i] = crc;
            }
            return table;
        }

        /// <summary>
        /// Calculates the decryption key from the filename.
        /// </summary>
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static uint CalculateKeyFromFilename(string filename)
        {
            uint crc = 0xFFFFFFFF;
            foreach (byte b in Encoding.UTF8.GetBytes(filename))
                crc = (crc >> 8) ^ Crc32Table[(byte)((crc ^ b) & 0xFF)];
            return ~crc;
        }

        /// <summary>
        /// Decrypts a block of data in-place. The same function works for encryption (XOR cipher).
        /// </summary>
        public static void DecryptBlock(byte[] buffer, int offset, int length, long fileOffset, uint key)
        {
            if (length == 0) return;

            byte k0 = (byte)key;
            byte k1 = (byte)(key >> 8);
            byte k2 = (byte)(key >> 16);
            byte k3 = (byte)(key >> 24);

            int i = 0;
            int endOffset = offset + length;

            // Align to 4-byte boundary if necessary
            long alignOffset = fileOffset & 3;
            if (alignOffset != 0)
            {
                uint currentCrc = UpdateCrcStateFast((uint)(fileOffset & -4), k0, k1, k2, k3);
                int alignCount = Math.Min((int)(4 - alignOffset), length);
                for (int j = 0; j < alignCount; j++, i++)
                {
                    buffer[offset + i] ^= ComputeXorByte(currentCrc, (int)((fileOffset + i) & 3));
                }
            }

            // Main loop: process 4 bytes at a time
            long baseOffset = fileOffset + i;
            while (offset + i + 4 <= endOffset)
            {
                uint crc = UpdateCrcStateFast((uint)baseOffset, k0, k1, k2, k3);

                buffer[offset + i] ^= ComputeXorByte(crc, 0);
                buffer[offset + i + 1] ^= ComputeXorByte(crc, 1);
                buffer[offset + i + 2] ^= ComputeXorByte(crc, 2);
                buffer[offset + i + 3] ^= ComputeXorByte(crc, 3);

                i += 4;
                baseOffset += 4;
            }

            // Handle remaining bytes
            if (offset + i < endOffset)
            {
                uint crc = UpdateCrcStateFast((uint)baseOffset, k0, k1, k2, k3);
                for (int pos = 0; offset + i < endOffset; i++, pos++)
                {
                    buffer[offset + i] ^= ComputeXorByte(crc, pos);
                }
            }
        }

#if NET8_0_OR_GREATER
        /// <summary>
        /// Decrypts a block of data in-place using Span. The same function works for encryption (XOR cipher).
        /// </summary>
        public static void DecryptBlock(Span<byte> buffer, long fileOffset, uint key)
        {
            if (buffer.IsEmpty) return;

            byte k0 = (byte)key;
            byte k1 = (byte)(key >> 8);
            byte k2 = (byte)(key >> 16);
            byte k3 = (byte)(key >> 24);

            int length = buffer.Length;
            int i = 0;

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

            long baseOffset = fileOffset + i;
            while (i + 4 <= length)
            {
                uint crc = UpdateCrcStateFast((uint)baseOffset, k0, k1, k2, k3);

                buffer[i] ^= ComputeXorByte(crc, 0);
                buffer[i + 1] ^= ComputeXorByte(crc, 1);
                buffer[i + 2] ^= ComputeXorByte(crc, 2);
                buffer[i + 3] ^= ComputeXorByte(crc, 3);

                i += 4;
                baseOffset += 4;
            }

            if (i < length)
            {
                uint crc = UpdateCrcStateFast((uint)baseOffset, k0, k1, k2, k3);
                for (int pos = 0; i < length; i++, pos++)
                {
                    buffer[i] ^= ComputeXorByte(crc, pos);
                }
            }
        }
#endif

        /// <summary>
        /// Decrypts a file and returns the decrypted bytes.
        /// </summary>
        public static byte[] DecryptFile(byte[] data, string filename)
        {
            uint key = CalculateKeyFromFilename(filename);
            var result = new byte[data.Length];
            Array.Copy(data, result, data.Length);
            DecryptBlock(result, 0, result.Length, 0, key);
            return result;
        }

        /// <summary>
        /// Alias for DecryptFile - Decrypts data using the filename as key.
        /// </summary>
        public static byte[] Decrypt(byte[] data, string keyName)
        {
            return DecryptFile(data, keyName);
        }

        /// <summary>
        /// Encrypts data using the filename as key.
        /// XOR cipher is symmetric, so encryption == decryption.
        /// </summary>
        public static byte[] Encrypt(byte[] data, string keyName)
        {
            return DecryptFile(data, keyName);
        }

        /// <summary>
        /// Decrypts a file stream to output stream with progress reporting.
        /// </summary>
        public static void DecryptStream(Stream input, Stream output, uint key, Action<long, long>? onProgress = null)
        {
            const int BufferSize = 4 * 1024 * 1024; // 4MB chunks
            byte[] buffer = new byte[BufferSize];
            int bytesRead;
            long totalRead = 0;
            long totalLength = input.Length;

            while ((bytesRead = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                DecryptBlock(buffer, 0, bytesRead, totalRead, key);
                output.Write(buffer, 0, bytesRead);
                totalRead += bytesRead;
                onProgress?.Invoke(totalRead, totalLength);
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
            crc = (crc >> 8) ^ Crc32Table[(byte)(crc & 0xFF) ^ k0];
            crc = (crc >> 8) ^ Crc32Table[(byte)(crc & 0xFF) ^ k1];
            crc = (crc >> 8) ^ Crc32Table[(byte)(crc & 0xFF) ^ k2];
            crc = (crc >> 8) ^ Crc32Table[(byte)(crc & 0xFF) ^ k3];
            return ~crc;
        }

        /// <summary>
        /// Checks if the file appears to be encrypted by looking for the cfg.bin signature.
        /// A valid cfg.bin file should have the footer pattern: 01 74 32 62 FE
        /// </summary>
        public static bool IsEncrypted(byte[] data)
        {
            if (data.Length < 16) return true;

            // Search for footer pattern in the last 32 bytes (handles padding)
            int searchStart = Math.Max(0, data.Length - 32);
            for (int i = searchStart; i < data.Length - 4; i++)
            {
                if (data[i] == 0x01 &&
                    data[i + 1] == 0x74 &&
                    data[i + 2] == 0x32 &&
                    data[i + 3] == 0x62)
                {
                    return false;
                }
            }
            return true;
        }

        /// <summary>
        /// Attempts to decrypt the file and verify if decryption was successful.
        /// Returns the decrypted data if successful, or null if decryption failed.
        /// </summary>
        public static byte[]? TryDecrypt(byte[] data, string filename)
        {
            var decrypted = DecryptFile(data, filename);
            if (!IsEncrypted(decrypted))
            {
                return decrypted;
            }
            return null;
        }
    }
}

