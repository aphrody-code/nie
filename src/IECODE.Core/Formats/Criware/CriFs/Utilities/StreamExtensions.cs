using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace IECODE.Core.Formats.Criware.CriFs.Utilities;

/// <summary>
/// Extensions to the 'Stream' class.
/// </summary>
internal static class StreamExtensions
{
    /// <summary>
    /// Reads a given number of bytes from a stream.
    /// </summary>
    /// <param name="stream">The stream to read the value from.</param>
    /// <param name="result">The buffer to receive the bytes.</param>
    public static void TryReadSafe(this Stream stream, byte[] result)
    {
        int bytesRead = 0;
        int totalBytes = result.Length;
        while (bytesRead < totalBytes)
        {
            int read = stream.Read(result, bytesRead, totalBytes - bytesRead);
            if (read == 0) break;
            bytesRead += read;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static T Read<T>(this Stream stream) where T : unmanaged
    {
        Span<T> stackSpace = stackalloc T[1];
        var bytes = MemoryMarshal.Cast<T, byte>(stackSpace);
        int totalRead = 0;
        while (totalRead < bytes.Length)
        {
            int read = stream.Read(bytes.Slice(totalRead));
            if (read == 0) break; // Or throw EndOfStreamException?
            totalRead += read;
        }
        return stackSpace[0];
    }
}