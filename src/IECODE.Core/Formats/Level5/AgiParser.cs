using System;
using System.Buffers.Binary;
using System.IO;
using System.Runtime.InteropServices;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// AGI (Animation/Graphics Info) Parser - Reverse engineered from nie.exe (FUN_14053b960)
/// Contains animation data with transformation parameters.
/// 
/// The magic 0x2E494741 ("AGI." or ".IGA") triggers initialization of:
/// - Transformation matrix at 0xB0-0xBF
/// - Scale factors at 0xC0-0xCB
/// 
/// AOT-Compatible: No reflection.
/// </summary>
public static class AgiParser
{
    /// <summary>Magic bytes "AGI." in Little-Endian</summary>
    public const uint MAGIC_LE = 0x4147492E; // ".IGA" read as LE

    /// <summary>Magic bytes "AGI." in Big-Endian</summary>
    public const uint MAGIC_BE = 0x2E494741; // ".IGA"

    /// <summary>
    /// AGI Header structure (inferred from decompilation)
    /// Contains animation transform and state data.
    /// </summary>
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct AgiHeader
    {
        public uint Magic;              // 0x00: "AGI." (0x2E494741 BE)
        public uint Version;            // 0x04: Format version
        public uint Flags;              // 0x08: Feature flags
        public uint DataSize;           // 0x0C: Total data size

        // Animation parameters
        public uint FrameCount;         // 0x10: Number of animation frames
        public float Duration;          // 0x14: Total duration (seconds)
        public uint TrackCount;         // 0x18: Number of animation tracks
        public uint EventCount;         // 0x1C: Number of animation events
    }

    /// <summary>
    /// AGI Transform state (from FUN_14053b960 at offset 0x50-0x60)
    /// </summary>
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct AgiTransform
    {
        public float X;                 // 0x50
        public float Y;                 // 0x54
        public float Width;             // 0x58 (fVar10)
        public float Height;            // 0x5C (fVar11)
        public byte Flags;              // 0x60: Transform flags
    }

    /// <summary>
    /// AGI Bounds (from offset 0x70-0x80)
    /// </summary>
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct AgiBounds
    {
        public float Left;              // 0x70
        public float Top;               // 0x74
        public float Right;             // 0x78
        public float Bottom;            // 0x7C
        public uint BoundsFlags;        // 0x80
        public uint Reserved;           // 0x84
    }

    /// <summary>
    /// AGI Scale factors (initialized at 0xC0-0xCC)
    /// </summary>
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct AgiScale
    {
        public float ScaleX;            // 0xC0: Default 1.0 (0x3F800000)
        public float ScaleY;            // 0xC4: Default 1.0 (0x3F800000)
        public float ScaleZ;            // 0xC8: Default 1.0 (0x3F800000)
        public float Factor;            // 0xCC: Default 0.1 (0x3DCCCCCD)
    }

    /// <summary>
    /// Parsed AGI animation data
    /// </summary>
    public sealed class AgiAnimation
    {
        public AgiHeader Header { get; init; }
        public AgiTransform Transform { get; init; }
        public AgiBounds Bounds { get; init; }
        public AgiScale Scale { get; init; }
        public ReadOnlyMemory<byte> RawData { get; init; }
        public bool IsBigEndian { get; init; }

        /// <summary>
        /// Get the default scale values (as initialized by FUN_14053b960).
        /// </summary>
        public static AgiScale GetDefaultScale() => new()
        {
            ScaleX = 1.0f,      // 0x3F800000
            ScaleY = 1.0f,      // 0x3F800000
            ScaleZ = 1.0f,      // 0x3F800000
            Factor = 0.1f       // 0x3DCCCCCD
        };
    }

    /// <summary>
    /// Validate AGI magic bytes.
    /// </summary>
    public static bool IsAgi(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4) return false;

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        return magic == MAGIC_LE || magic == MAGIC_BE;
    }

    /// <summary>
    /// Parse AGI animation from binary data.
    /// </summary>
    public static AgiAnimation Parse(ReadOnlySpan<byte> data)
    {
        if (!IsAgi(data))
            throw new InvalidDataException("Invalid AGI magic");

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        bool isBigEndian = magic == MAGIC_BE;

        var header = ParseHeader(data, isBigEndian);

        // Parse transform if data is large enough
        AgiTransform transform = default;
        if (data.Length >= 0x61)
        {
            transform = new AgiTransform
            {
                X = ReadFloat(data, 0x50, isBigEndian),
                Y = ReadFloat(data, 0x54, isBigEndian),
                Width = ReadFloat(data, 0x58, isBigEndian),
                Height = ReadFloat(data, 0x5C, isBigEndian),
                Flags = data[0x60]
            };
        }

        // Parse bounds
        AgiBounds bounds = default;
        if (data.Length >= 0x88)
        {
            bounds = new AgiBounds
            {
                Left = ReadFloat(data, 0x70, isBigEndian),
                Top = ReadFloat(data, 0x74, isBigEndian),
                Right = ReadFloat(data, 0x78, isBigEndian),
                Bottom = ReadFloat(data, 0x7C, isBigEndian),
                BoundsFlags = ReadUInt32(data, 0x80, isBigEndian),
                Reserved = ReadUInt32(data, 0x84, isBigEndian)
            };
        }

        // Parse or initialize scale
        AgiScale scale = AgiAnimation.GetDefaultScale();
        if (data.Length >= 0xD0)
        {
            scale = new AgiScale
            {
                ScaleX = ReadFloat(data, 0xC0, isBigEndian),
                ScaleY = ReadFloat(data, 0xC4, isBigEndian),
                ScaleZ = ReadFloat(data, 0xC8, isBigEndian),
                Factor = ReadFloat(data, 0xCC, isBigEndian)
            };
        }

        return new AgiAnimation
        {
            Header = header,
            Transform = transform,
            Bounds = bounds,
            Scale = scale,
            RawData = data.ToArray(),
            IsBigEndian = isBigEndian
        };
    }

    private static AgiHeader ParseHeader(ReadOnlySpan<byte> data, bool isBigEndian)
    {
        return new AgiHeader
        {
            Magic = isBigEndian
                ? BinaryPrimitives.ReadUInt32BigEndian(data)
                : BinaryPrimitives.ReadUInt32LittleEndian(data),
            Version = ReadUInt32(data, 0x04, isBigEndian),
            Flags = ReadUInt32(data, 0x08, isBigEndian),
            DataSize = ReadUInt32(data, 0x0C, isBigEndian),
            FrameCount = ReadUInt32(data, 0x10, isBigEndian),
            Duration = ReadFloat(data, 0x14, isBigEndian),
            TrackCount = ReadUInt32(data, 0x18, isBigEndian),
            EventCount = ReadUInt32(data, 0x1C, isBigEndian)
        };
    }

    private static uint ReadUInt32(ReadOnlySpan<byte> data, int offset, bool isBigEndian)
    {
        if (offset + 4 > data.Length) return 0;
        return isBigEndian
            ? BinaryPrimitives.ReadUInt32BigEndian(data[offset..])
            : BinaryPrimitives.ReadUInt32LittleEndian(data[offset..]);
    }

    private static float ReadFloat(ReadOnlySpan<byte> data, int offset, bool isBigEndian)
    {
        if (offset + 4 > data.Length) return 0f;
        uint bits = ReadUInt32(data, offset, isBigEndian);
        return BitConverter.Int32BitsToSingle((int)bits);
    }

    /// <summary>
    /// Parse AGI from file.
    /// </summary>
    public static AgiAnimation ParseFile(string path)
    {
        var data = File.ReadAllBytes(path);
        return Parse(data);
    }

    /// <summary>
    /// Get summary information.
    /// </summary>
    public static string GetSummary(ReadOnlySpan<byte> data)
    {
        if (!IsAgi(data))
            return "Not a valid AGI file";

        var anim = Parse(data);

        return $"""
            AGI Animation Data
            ------------------
            Version: {anim.Header.Version}
            Frames: {anim.Header.FrameCount}
            Duration: {anim.Header.Duration:F2}s
            Tracks: {anim.Header.TrackCount}
            Events: {anim.Header.EventCount}
            Endianness: {(anim.IsBigEndian ? "Big-Endian" : "Little-Endian")}
            
            Transform:
              Position: ({anim.Transform.X:F2}, {anim.Transform.Y:F2})
              Size: {anim.Transform.Width:F2} x {anim.Transform.Height:F2}
            
            Scale:
              X: {anim.Scale.ScaleX:F2}
              Y: {anim.Scale.ScaleY:F2}
              Z: {anim.Scale.ScaleZ:F2}
            """;
    }
}
