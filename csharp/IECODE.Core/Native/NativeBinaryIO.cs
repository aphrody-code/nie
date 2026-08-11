using System.Buffers;
using System.Buffers.Binary;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;

namespace IECODE.Core.Native;

/// <summary>
/// Native .NET binary I/O utilities following Microsoft best practices.
/// Replaces Kuriimu2.Komponent for common binary operations.
/// </summary>
/// <remarks>
/// Uses modern .NET APIs:
/// - BinaryPrimitives for endian-aware reading/writing
/// - Span/Memory for allocation-free operations
/// - MemoryMarshal for struct marshaling
/// See: https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines
/// </remarks>
public static class NativeBinaryIO
{
    #region Endian-aware Read Operations

    /// <summary>
    /// Reads a 16-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static short ReadInt16(ReadOnlySpan<byte> data, bool bigEndian = false)
    {
        return bigEndian
            ? BinaryPrimitives.ReadInt16BigEndian(data)
            : BinaryPrimitives.ReadInt16LittleEndian(data);
    }

    /// <summary>
    /// Reads an unsigned 16-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ushort ReadUInt16(ReadOnlySpan<byte> data, bool bigEndian = false)
    {
        return bigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(data)
            : BinaryPrimitives.ReadUInt16LittleEndian(data);
    }

    /// <summary>
    /// Reads a 32-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static int ReadInt32(ReadOnlySpan<byte> data, bool bigEndian = false)
    {
        return bigEndian
            ? BinaryPrimitives.ReadInt32BigEndian(data)
            : BinaryPrimitives.ReadInt32LittleEndian(data);
    }

    /// <summary>
    /// Reads an unsigned 32-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static uint ReadUInt32(ReadOnlySpan<byte> data, bool bigEndian = false)
    {
        return bigEndian
            ? BinaryPrimitives.ReadUInt32BigEndian(data)
            : BinaryPrimitives.ReadUInt32LittleEndian(data);
    }

    /// <summary>
    /// Reads a 64-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static long ReadInt64(ReadOnlySpan<byte> data, bool bigEndian = false)
    {
        return bigEndian
            ? BinaryPrimitives.ReadInt64BigEndian(data)
            : BinaryPrimitives.ReadInt64LittleEndian(data);
    }

    /// <summary>
    /// Reads an unsigned 64-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ulong ReadUInt64(ReadOnlySpan<byte> data, bool bigEndian = false)
    {
        return bigEndian
            ? BinaryPrimitives.ReadUInt64BigEndian(data)
            : BinaryPrimitives.ReadUInt64LittleEndian(data);
    }

    /// <summary>
    /// Reads a single-precision float with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static float ReadSingle(ReadOnlySpan<byte> data, bool bigEndian = false)
    {
        return bigEndian
            ? BinaryPrimitives.ReadSingleBigEndian(data)
            : BinaryPrimitives.ReadSingleLittleEndian(data);
    }

    /// <summary>
    /// Reads a double-precision float with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static double ReadDouble(ReadOnlySpan<byte> data, bool bigEndian = false)
    {
        return bigEndian
            ? BinaryPrimitives.ReadDoubleBigEndian(data)
            : BinaryPrimitives.ReadDoubleLittleEndian(data);
    }

    #endregion

    #region Endian-aware Write Operations

    /// <summary>
    /// Writes a 16-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void WriteInt16(Span<byte> destination, short value, bool bigEndian = false)
    {
        if (bigEndian)
            BinaryPrimitives.WriteInt16BigEndian(destination, value);
        else
            BinaryPrimitives.WriteInt16LittleEndian(destination, value);
    }

    /// <summary>
    /// Writes an unsigned 16-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void WriteUInt16(Span<byte> destination, ushort value, bool bigEndian = false)
    {
        if (bigEndian)
            BinaryPrimitives.WriteUInt16BigEndian(destination, value);
        else
            BinaryPrimitives.WriteUInt16LittleEndian(destination, value);
    }

    /// <summary>
    /// Writes a 32-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void WriteInt32(Span<byte> destination, int value, bool bigEndian = false)
    {
        if (bigEndian)
            BinaryPrimitives.WriteInt32BigEndian(destination, value);
        else
            BinaryPrimitives.WriteInt32LittleEndian(destination, value);
    }

    /// <summary>
    /// Writes an unsigned 32-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void WriteUInt32(Span<byte> destination, uint value, bool bigEndian = false)
    {
        if (bigEndian)
            BinaryPrimitives.WriteUInt32BigEndian(destination, value);
        else
            BinaryPrimitives.WriteUInt32LittleEndian(destination, value);
    }

    /// <summary>
    /// Writes a 64-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void WriteInt64(Span<byte> destination, long value, bool bigEndian = false)
    {
        if (bigEndian)
            BinaryPrimitives.WriteInt64BigEndian(destination, value);
        else
            BinaryPrimitives.WriteInt64LittleEndian(destination, value);
    }

    /// <summary>
    /// Writes an unsigned 64-bit integer with specified endianness.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void WriteUInt64(Span<byte> destination, ulong value, bool bigEndian = false)
    {
        if (bigEndian)
            BinaryPrimitives.WriteUInt64BigEndian(destination, value);
        else
            BinaryPrimitives.WriteUInt64LittleEndian(destination, value);
    }

    #endregion

    #region String Operations

    /// <summary>
    /// Reads a null-terminated string.
    /// </summary>
    public static string ReadNullTerminatedString(ReadOnlySpan<byte> data, Encoding? encoding = null)
    {
        encoding ??= Encoding.UTF8;
        var nullIndex = data.IndexOf((byte)0);
        var stringData = nullIndex >= 0 ? data[..nullIndex] : data;
        return encoding.GetString(stringData);
    }

    /// <summary>
    /// Reads a fixed-length string.
    /// </summary>
    public static string ReadFixedString(ReadOnlySpan<byte> data, int length, Encoding? encoding = null)
    {
        encoding ??= Encoding.UTF8;
        var actualLength = Math.Min(length, data.Length);
        var stringData = data[..actualLength];

        // Trim null padding
        var nullIndex = stringData.IndexOf((byte)0);
        if (nullIndex >= 0)
            stringData = stringData[..nullIndex];

        return encoding.GetString(stringData);
    }

    /// <summary>
    /// Reads a length-prefixed string (with 32-bit length prefix).
    /// </summary>
    public static string ReadLengthPrefixedString(ReadOnlySpan<byte> data, bool bigEndian = false, Encoding? encoding = null)
    {
        encoding ??= Encoding.UTF8;
        var length = ReadInt32(data, bigEndian);
        return encoding.GetString(data.Slice(4, length));
    }

    /// <summary>
    /// Writes a null-terminated string.
    /// </summary>
    public static int WriteNullTerminatedString(Span<byte> destination, string value, Encoding? encoding = null)
    {
        encoding ??= Encoding.UTF8;
        var bytes = encoding.GetBytes(value);
        bytes.CopyTo(destination);
        destination[bytes.Length] = 0;
        return bytes.Length + 1;
    }

    #endregion

    #region Struct Operations

    /// <summary>
    /// Reads an unmanaged struct from a byte span.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static T ReadStruct<T>(ReadOnlySpan<byte> data) where T : unmanaged
    {
        return MemoryMarshal.Read<T>(data);
    }

    /// <summary>
    /// Writes an unmanaged struct to a byte span.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void WriteStruct<T>(Span<byte> destination, in T value) where T : unmanaged
    {
        MemoryMarshal.Write(destination, in value);
    }

    /// <summary>
    /// Gets the byte representation of an unmanaged struct.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadOnlySpan<byte> AsBytes<T>(in T value) where T : unmanaged
    {
        return MemoryMarshal.AsBytes(new ReadOnlySpan<T>(in value));
    }

    /// <summary>
    /// Casts a byte span to a span of unmanaged structs.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Span<T> CastSpan<T>(Span<byte> data) where T : unmanaged
    {
        return MemoryMarshal.Cast<byte, T>(data);
    }

    /// <summary>
    /// Casts a readonly byte span to a readonly span of unmanaged structs.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadOnlySpan<T> CastReadOnlySpan<T>(ReadOnlySpan<byte> data) where T : unmanaged
    {
        return MemoryMarshal.Cast<byte, T>(data);
    }

    #endregion

    #region Stream Extensions

    /// <summary>
    /// Reads bytes from a stream into a span.
    /// </summary>
    public static int ReadExact(Stream stream, Span<byte> buffer)
    {
        int totalRead = 0;
        while (totalRead < buffer.Length)
        {
            int read = stream.Read(buffer[totalRead..]);
            if (read == 0)
                break;
            totalRead += read;
        }
        return totalRead;
    }

    /// <summary>
    /// Asynchronously reads bytes from a stream.
    /// </summary>
    public static async ValueTask<int> ReadExactAsync(Stream stream, Memory<byte> buffer, CancellationToken ct = default)
    {
        int totalRead = 0;
        while (totalRead < buffer.Length)
        {
            int read = await stream.ReadAsync(buffer[totalRead..], ct);
            if (read == 0)
                break;
            totalRead += read;
        }
        return totalRead;
    }

    /// <summary>
    /// Reads an Int32 from a stream.
    /// </summary>
    public static int ReadInt32(Stream stream, bool bigEndian = false)
    {
        Span<byte> buffer = stackalloc byte[4];
        stream.ReadExactly(buffer);
        return ReadInt32(buffer, bigEndian);
    }

    /// <summary>
    /// Reads a UInt32 from a stream.
    /// </summary>
    public static uint ReadUInt32(Stream stream, bool bigEndian = false)
    {
        Span<byte> buffer = stackalloc byte[4];
        stream.ReadExactly(buffer);
        return ReadUInt32(buffer, bigEndian);
    }

    /// <summary>
    /// Reads an Int64 from a stream.
    /// </summary>
    public static long ReadInt64(Stream stream, bool bigEndian = false)
    {
        Span<byte> buffer = stackalloc byte[8];
        stream.ReadExactly(buffer);
        return ReadInt64(buffer, bigEndian);
    }

    #endregion

    #region Alignment and Padding

    /// <summary>
    /// Calculates the padding needed to align to a boundary.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static int GetPadding(long position, int alignment)
    {
        var remainder = (int)(position % alignment);
        return remainder == 0 ? 0 : alignment - remainder;
    }

    /// <summary>
    /// Aligns a value up to the specified boundary.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static long AlignUp(long value, int alignment)
    {
        return value + GetPadding(value, alignment);
    }

    /// <summary>
    /// Aligns a value down to the specified boundary.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static long AlignDown(long value, int alignment)
    {
        return value - (value % alignment);
    }

    /// <summary>
    /// Writes padding bytes to align to a boundary.
    /// </summary>
    public static void WritePadding(Stream stream, int alignment, byte paddingByte = 0)
    {
        var padding = GetPadding(stream.Position, alignment);
        if (padding > 0)
        {
            Span<byte> buffer = stackalloc byte[padding];
            buffer.Fill(paddingByte);
            stream.Write(buffer);
        }
    }

    #endregion
}
