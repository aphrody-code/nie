using IECODE.Core.Formats.Criware.CriFs.Encryption;

namespace Viola.Core.EncryptDecrypt.Logic.Utils;

/// <summary>
/// Wrapper around IECODE.Core.Formats.Criware.CriFs.Encryption.CriwareCrypt for backward compatibility.
/// All the optimized decryption logic is now in IECODE.Core.Formats.Criware.CriFs.
/// </summary>
public static class CCriwareCrypt
{
    /// <summary>
    /// Calculates the decryption key based on the filename.
    /// </summary>
    public static uint CalculateFilenameKey(string filename)
      => CriwareCrypt.CalculateKeyFromFilename(filename);

    /// <summary>
    /// Core decryption logic for a byte array.
    /// </summary>
    public static void DecryptBlock(byte[] buffer, long fileOffset, uint key)
      => CriwareCrypt.DecryptBlock(buffer.AsSpan(), fileOffset, key);

    /// <summary>
    /// Core decryption logic for a span.
    /// </summary>
    public static void DecryptBlock(Span<byte> buffer, long fileOffset, uint key)
      => CriwareCrypt.DecryptBlock(buffer, fileOffset, key);

    /// <summary>
    /// Helper to stream data from Input to Output while decrypting.
    /// Optimized with larger buffer and Span-based processing.
    /// </summary>
    public static void ProcessStream(Stream input, Stream output, uint key, Action<long, long>? onProgress = null)
    {
        const int BufferSize = 4 * 1024 * 1024; // 4MB chunks for better throughput
        byte[] buffer = new byte[BufferSize];
        int bytesRead;
        long totalRead = 0;
        long totalLength = input.Length;

        while ((bytesRead = input.Read(buffer, 0, buffer.Length)) > 0)
        {
            CriwareCrypt.DecryptBlock(buffer.AsSpan(0, bytesRead), totalRead, key);
            output.Write(buffer, 0, bytesRead);
            totalRead += bytesRead;
            onProgress?.Invoke(totalRead, totalLength);
        }
    }
}

