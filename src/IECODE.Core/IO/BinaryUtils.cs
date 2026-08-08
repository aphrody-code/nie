using System.Text;

namespace IECODE.Core.IO;

/// <summary>
/// Common binary analysis utilities.
/// Centralized to avoid code duplication across services.
/// </summary>
public static class BinaryUtils
{
    /// <summary>
    /// Calculates Shannon entropy of data (0-8 scale).
    /// 8.0 = maximum randomness (encrypted/compressed)
    /// 0.0 = all same bytes
    /// </summary>
    public static double CalculateEntropy(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0) return 0;

        Span<int> frequency = stackalloc int[256];
        foreach (byte b in data)
            frequency[b]++;

        double entropy = 0;
        double len = data.Length;

        foreach (int count in frequency)
        {
            if (count == 0) continue;
            double p = count / len;
            entropy -= p * Math.Log2(p);
        }

        return entropy;
    }

    /// <summary>
    /// Calculates entropy from byte array.
    /// </summary>
    public static double CalculateEntropy(byte[] data) => CalculateEntropy(data.AsSpan());

    /// <summary>
    /// Generates a hex dump string for display.
    /// </summary>
    /// <param name="data">Binary data to dump.</param>
    /// <param name="offset">Starting offset in data.</param>
    /// <param name="length">Number of bytes to dump (-1 for all).</param>
    /// <param name="bytesPerLine">Bytes per line (default 16).</param>
    /// <returns>Formatted hex dump string.</returns>
    public static string GenerateHexDump(ReadOnlySpan<byte> data, int offset = 0, int length = -1, int bytesPerLine = 16)
    {
        if (length < 0) length = data.Length - offset;
        length = Math.Min(length, data.Length - offset);

        if (length <= 0) return string.Empty;

        var sb = new StringBuilder((length / bytesPerLine + 1) * (10 + bytesPerLine * 4 + 5));

        for (int i = 0; i < length; i += bytesPerLine)
        {
            int lineOffset = offset + i;
            sb.Append($"{lineOffset:X8}  ");

            // Hex bytes
            for (int j = 0; j < bytesPerLine; j++)
            {
                if (i + j < length)
                    sb.Append($"{data[offset + i + j]:X2} ");
                else
                    sb.Append("   ");

                if (j == 7) sb.Append(' ');
            }

            sb.Append(" |");

            // ASCII representation
            for (int j = 0; j < bytesPerLine && i + j < length; j++)
            {
                byte b = data[offset + i + j];
                sb.Append(b >= 32 && b < 127 ? (char)b : '.');
            }

            sb.AppendLine("|");
        }

        return sb.ToString();
    }

    /// <summary>
    /// Generates a hex dump from byte array.
    /// </summary>
    public static string GenerateHexDump(byte[] data, int offset = 0, int length = -1, int bytesPerLine = 16)
        => GenerateHexDump(data.AsSpan(), offset, length, bytesPerLine);

    /// <summary>
    /// Attempts XOR decryption with a key.
    /// </summary>
    public static byte[] XorDecrypt(ReadOnlySpan<byte> data, ReadOnlySpan<byte> key)
    {
        var result = new byte[data.Length];
        for (int i = 0; i < data.Length; i++)
        {
            result[i] = (byte)(data[i] ^ key[i % key.Length]);
        }
        return result;
    }

    /// <summary>
    /// Finds a byte pattern in data.
    /// </summary>
    /// <returns>Index of first occurrence, or -1 if not found.</returns>
    public static int FindPattern(ReadOnlySpan<byte> data, ReadOnlySpan<byte> pattern)
    {
        if (pattern.Length == 0 || pattern.Length > data.Length)
            return -1;

        for (int i = 0; i <= data.Length - pattern.Length; i++)
        {
            if (data.Slice(i, pattern.Length).SequenceEqual(pattern))
                return i;
        }
        return -1;
    }

    /// <summary>
    /// Known magic bytes for file format detection.
    /// </summary>
    public static readonly Dictionary<string, byte[]> KnownMagicBytes = new()
    {
        ["CfgBin"] = "CFGB"u8.ToArray(),
        ["G4TX"] = "G4TX"u8.ToArray(),
        ["CPK"] = "CPK "u8.ToArray(),
        ["RIFF"] = "RIFF"u8.ToArray(),
        ["PNG"] = [0x89, 0x50, 0x4E, 0x47],
        ["ZIP"] = [0x50, 0x4B, 0x03, 0x04],
        ["GZIP"] = [0x1F, 0x8B],
        ["Zstd"] = [0x28, 0xB5, 0x2F, 0xFD],
    };

    /// <summary>
    /// Detects file format from magic bytes.
    /// </summary>
    public static string? DetectFormat(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4) return null;

        foreach (var (name, magic) in KnownMagicBytes)
        {
            if (data.Length >= magic.Length && data[..magic.Length].SequenceEqual(magic))
                return name;
        }

        return null;
    }
}
