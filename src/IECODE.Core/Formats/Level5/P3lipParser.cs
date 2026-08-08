// P3lip Parser - LEVEL-5 IEVR LipSync keyframe track
// Format: .p3lip (data/common/sound/{ja,en}/*.p3lip)
// Engine resource class: lives::CResLipSync (confirmed in nie.exe strings:
//   ".?AVCResLipSync@lives@@", "%s/%s.p3lip", "m_lipsyncTalkAnimeName").
//
// Reverse-engineered structure (little-endian), validated on real samples:
//
//   Offset  Size  Field
//   ------  ----  ---------------------------------------------------------
//   0x00    4     Magic "lip\0"                  (0x00 70 69 6C)
//   0x04    u32   HeaderSize                     (always 0x70 = 112)
//   0x08    u32   FileSize                       (== total bytes on disk)
//   0x0C    u32   Reserved0                      (0)
//   0x10    u32   Reserved1                      (0)
//   0x14    f32   Duration (seconds)             (== last keyframe time)
//   0x18    u32   DataOffset                     (0x70 = end of header)
//   0x1C    u32   Field1C                        (0x40)
//   0x20    u32   KeyframeOffset                 (0xB0 = start of track)
//   0x24    u16   KeyframeCount
//   0x26    u16   KeyframeStride                 (8 = bytes per keyframe)
//   0x28..  --    Padding (zeros) up to KeyframeOffset
//
//   Keyframe table @ KeyframeOffset, KeyframeCount entries of KeyframeStride(8) bytes:
//     +0x00  f32   Time (seconds, monotonically ascending)
//     +0x04  byte  Phoneme/event code:
//                    0x00..0x09 = mouth-shape / viseme index
//                    0xFE       = track-start sentinel (first keyframe)
//                    0xFF       = track-end sentinel   (last keyframe)
//     +0x05  byte  Channel/intensity tag (constant per file)
//     +0x06  u16   WeightRaw (kept raw; encoding not fully confirmed —
//                    a "rest" value of 0x2CCC recurs on sentinel/idle frames)
//
//   Invariant verified on every sample: KeyframeOffset + KeyframeCount*8 == FileSize
//   (a count one short of the table simply means the final 8 bytes are zero padding).
//
// AOT-Compatible: Native AOT ready, no reflection.

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// Parsed P3lip (lives::CResLipSync) header.
/// </summary>
public readonly struct P3lipHeader
{
    public uint HeaderSize { get; init; }
    public uint FileSize { get; init; }
    public float Duration { get; init; }
    public uint DataOffset { get; init; }
    public uint KeyframeOffset { get; init; }
    public ushort KeyframeCount { get; init; }
    public ushort KeyframeStride { get; init; }
}

/// <summary>
/// A single lip-sync keyframe.
/// </summary>
public readonly struct P3lipKeyframe
{
    /// <summary>Timestamp in seconds (monotonically ascending).</summary>
    public float Time { get; init; }

    /// <summary>
    /// Phoneme / viseme code (byte0 of the marker): 0x00..0x09 mouth shapes,
    /// 0xFE = start sentinel, 0xFF = end sentinel.
    /// </summary>
    public byte Phoneme { get; init; }

    /// <summary>Channel/intensity tag (byte1, constant per file).</summary>
    public byte Channel { get; init; }

    /// <summary>Raw 16-bit weight field (byte2..byte3, encoding unconfirmed).</summary>
    public ushort WeightRaw { get; init; }

    /// <summary>Full raw 32-bit marker (little-endian) for lossless round-trip.</summary>
    public uint MarkerRaw { get; init; }

    /// <summary>True if this is the start/end sentinel rather than a viseme.</summary>
    public bool IsSentinel => Phoneme is 0xFE or 0xFF;
}

/// <summary>
/// Fully parsed P3lip file: header + keyframe track.
/// </summary>
public sealed class P3lipFile
{
    public P3lipHeader Header { get; init; }
    public IReadOnlyList<P3lipKeyframe> Keyframes { get; init; } = Array.Empty<P3lipKeyframe>();
}

/// <summary>
/// AOT-compatible P3lip (LipSync) parser.
/// </summary>
public static class P3lipParser
{
    /// <summary>Magic bytes "lip\0".</summary>
    public static ReadOnlySpan<byte> Magic => "lip\0"u8;

    public const int HEADER_SIZE = 0x70;       // 112
    public const int KEYFRAME_OFFSET = 0xB0;   // 176
    public const int KEYFRAME_STRIDE = 8;

    /// <summary>Cheap magic check.</summary>
    public static bool IsP3lip(ReadOnlySpan<byte> data)
        => data.Length >= 4 && data[..4].SequenceEqual(Magic);

    /// <summary>Parse only the header.</summary>
    public static P3lipHeader ParseHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < HEADER_SIZE)
            throw new InvalidDataException($"Data too small for P3lip header: {data.Length} < {HEADER_SIZE}");
        if (!IsP3lip(data))
            throw new InvalidDataException("Invalid P3lip magic (expected 'lip\\0')");

        return new P3lipHeader
        {
            HeaderSize = BinaryPrimitives.ReadUInt32LittleEndian(data[0x04..]),
            FileSize = BinaryPrimitives.ReadUInt32LittleEndian(data[0x08..]),
            Duration = BinaryPrimitives.ReadSingleLittleEndian(data[0x14..]),
            DataOffset = BinaryPrimitives.ReadUInt32LittleEndian(data[0x18..]),
            KeyframeOffset = BinaryPrimitives.ReadUInt32LittleEndian(data[0x20..]),
            KeyframeCount = BinaryPrimitives.ReadUInt16LittleEndian(data[0x24..]),
            KeyframeStride = BinaryPrimitives.ReadUInt16LittleEndian(data[0x26..]),
        };
    }

    /// <summary>Parse the full file (header + keyframe track).</summary>
    public static P3lipFile Parse(ReadOnlySpan<byte> data)
    {
        var header = ParseHeader(data);

        int kOff = header.KeyframeOffset != 0 ? (int)header.KeyframeOffset : KEYFRAME_OFFSET;
        int stride = header.KeyframeStride != 0 ? header.KeyframeStride : KEYFRAME_STRIDE;
        int count = header.KeyframeCount;

        var frames = new List<P3lipKeyframe>(count);
        for (int i = 0; i < count; i++)
        {
            int off = kOff + i * stride;
            if (off + stride > data.Length)
                break; // tolerate the trailing zero-pad frame

            float time = BinaryPrimitives.ReadSingleLittleEndian(data[off..]);
            uint marker = BinaryPrimitives.ReadUInt32LittleEndian(data[(off + 4)..]);

            // Skip a fully-zero trailing pad entry (count occasionally includes it).
            if (i == count - 1 && marker == 0 && time == 0f)
                break;

            frames.Add(new P3lipKeyframe
            {
                Time = time,
                Phoneme = (byte)(marker & 0xFF),
                Channel = (byte)((marker >> 8) & 0xFF),
                WeightRaw = (ushort)((marker >> 16) & 0xFFFF),
                MarkerRaw = marker,
            });
        }

        return new P3lipFile { Header = header, Keyframes = frames };
    }

    /// <summary>Parse a P3lip file from disk.</summary>
    public static P3lipFile ParseFile(string path)
        => Parse(File.ReadAllBytes(path));

    /// <summary>Human-readable summary of a parsed file.</summary>
    public static string GetSummary(P3lipFile file)
    {
        var sb = new StringBuilder();
        var h = file.Header;
        sb.AppendLine($"Format:        P3lip (lives::CResLipSync)");
        sb.AppendLine($"Header size:   {h.HeaderSize} bytes");
        sb.AppendLine($"File size:     {h.FileSize:N0} bytes");
        sb.AppendLine($"Duration:      {h.Duration:0.###} s");
        sb.AppendLine($"Keyframes:     {file.Keyframes.Count} (declared {h.KeyframeCount})");
        sb.AppendLine($"Track offset:  0x{h.KeyframeOffset:X}, stride {h.KeyframeStride}");
        return sb.ToString();
    }
}
