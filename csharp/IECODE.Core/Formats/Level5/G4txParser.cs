// G4TX Parser — Level-5 Graphics 4 Texture Container
// AOT-Compatible. Zero-copy: texture data is sliced from the original file buffer.

using System;
using System.Buffers;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using IECODE.Core.Formats.Level5.CfgBin.Tools;

namespace IECODE.Core.Formats.Level5;

/// <summary>G4TX Header (0x60 bytes).</summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly struct G4txHeader
{
    public readonly uint Magic;
    public readonly short HeaderSize;
    public readonly short FileType;
    public readonly int Unknown1;
    public readonly int TableSize;
    public readonly ulong Zeroes1;
    public readonly ulong Zeroes2;
    public readonly short TextureCount;
    public readonly short TotalCount;
    public readonly byte Unknown2;
    public readonly byte SubTextureCount;
    public readonly short Unknown3;
    public readonly int Unknown4;
    public readonly int TextureDataSize;
    public readonly long Unknown5;
    public readonly ulong Unknown6_1;
    public readonly ulong Unknown6_2;
    public readonly ulong Unknown6_3;
    public readonly ulong Unknown6_4;
    public readonly ulong Unknown6_5;

    public bool IsValid => Magic == 0x58543447; // "G4TX" LE
}

/// <summary>G4TX Main Texture Entry (0x30 bytes).</summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly struct G4txEntry
{
    public readonly int Unknown1;
    public readonly int NxtchOffset;
    public readonly int NxtchSize;
    public readonly int Unknown2;
    public readonly int Unknown3;
    public readonly int Unknown4;
    public readonly short Width;
    public readonly short Height;
    public readonly int Const2;
    public readonly ulong Unknown5_1;
    public readonly ulong Unknown5_2;
}

/// <summary>G4TX Sub-Texture Entry (0x18 bytes) — atlas region.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly struct G4txSubEntry
{
    public readonly short EntryId;
    public readonly short Unknown1;
    public readonly short X;
    public readonly short Y;
    public readonly short Width;
    public readonly short Height;
    public readonly int Unknown2;
    public readonly int Unknown3;
    public readonly int Unknown4;
}

/// <summary>NXTCH Header (Nintendo Switch Texture Chunk).</summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly struct NxtchHeader
{
    public readonly ulong Magic;
    public readonly int TextureDataSize;
    public readonly int Unknown1;
    public readonly int Unknown2;
    public readonly int Width;
    public readonly int Height;
    public readonly int Unknown3;
    public readonly int Unknown4;
    public readonly int Format;
    public readonly int MipMapCount;
    public readonly int TextureDataSize2;

    public bool IsValid => (Magic & 0xFFFFFFFFFF) == 0x484354584E; // "NXTCH"
}

/// <summary>Parsed G4TX texture. TextureData is a zero-copy view of the source file buffer.</summary>
public readonly record struct G4txTexture(
    byte Id,
    string Name,
    int Width,
    int Height,
    int Format,
    int MipMapCount,
    ReadOnlyMemory<byte> TextureData,
    bool IsDds,
    IReadOnlyList<G4txSubTexture> SubTextures
);

/// <summary>Parsed atlas region.</summary>
public readonly record struct G4txSubTexture(
    byte Id,
    string Name,
    short X,
    short Y,
    short Width,
    short Height
);

public static class G4txParser
{
    public const uint MAGIC = 0x47345458; // "G4TX"
    private const int HEADER_SIZE    = 0x60;
    private const int ENTRY_SIZE     = 0x30;
    private const int SUB_ENTRY_SIZE = 0x18;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /// <summary>Parse all textures from a G4TX file on disk.</summary>
    public static List<G4txTexture> ParseFile(string path)
    {
        // Keep as ReadOnlyMemory<byte> so slices are zero-copy.
        ReadOnlyMemory<byte> data = File.ReadAllBytes(path);
        return ParseTextures(data);
    }

    /// <summary>
    /// Parse all textures from an in-memory buffer.
    /// <paramref name="data"/> is held alive for the lifetime of the returned textures;
    /// TextureData fields are slices of it — no extra copies.
    /// </summary>
    public static List<G4txTexture> ParseTextures(ReadOnlyMemory<byte> data)
    {
        var span   = data.Span;
        var header = ParseHeader(span);

        int entryOffset    = HEADER_SIZE;
        int subEntryOffset = entryOffset + header.TextureCount * ENTRY_SIZE;
        int hashOffset     = (subEntryOffset + header.SubTextureCount * SUB_ENTRY_SIZE + 0xF) & ~0xF;
        int idOffset       = hashOffset + header.TotalCount * 4;
        int stringOffset   = (idOffset + header.TotalCount + 0x3) & ~0x3;

        var entries    = ParseEntries(span[entryOffset..], header.TextureCount);
        var subEntries = ParseSubEntries(span[subEntryOffset..], header.SubTextureCount);
        var ids        = span.Slice(idOffset, header.TotalCount);

        // String offsets — rent from pool to avoid heap allocation.
        short[] stringOffsetsRented = ArrayPool<short>.Shared.Rent(header.TotalCount);
        try
        {
            for (int i = 0; i < header.TotalCount; i++)
                stringOffsetsRented[i] = BinaryPrimitives.ReadInt16LittleEndian(span.Slice(stringOffset + i * 2, 2));

            int nxtchBase = (header.HeaderSize + header.TableSize + 0xF) & ~0xF;
            var textures  = new List<G4txTexture>(header.TextureCount);

            for (int i = 0; i < header.TextureCount; i++)
            {
                ref readonly var entry = ref entries[i];

                string name = ReadNullTerminatedString(span[(stringOffset + stringOffsetsRented[i])..]);

                int nxtchOffset = nxtchBase + entry.NxtchOffset;

                // Zero-copy: slice the original memory buffer — no ToArray().
                ReadOnlyMemory<byte> textureData = data.Slice(nxtchOffset, entry.NxtchSize);

                bool isDds = false;
                int  width = 0, height = 0, format = 0, mipMapCount = 0;

                var texSpan = textureData.Span;
                if (texSpan.Length >= 4 && BinaryPrimitives.ReadUInt32LittleEndian(texSpan) == DdsParser.DDS_MAGIC)
                {
                    isDds = true;
                    var ddsHeader = DdsParser.ParseHeader(texSpan);
                    width       = (int)ddsHeader.Width;
                    height      = (int)ddsHeader.Height;
                    format      = (int)ddsHeader.PfFourCC;
                    mipMapCount = (int)ddsHeader.MipMapCount;
                }
                else
                {
                    var nxtch = ParseNxtchHeader(texSpan);
                    width       = nxtch.Width;
                    height      = nxtch.Height;
                    format      = nxtch.Format;
                    mipMapCount = nxtch.MipMapCount;
                }

                var subTextures = BuildSubTextures(subEntries, ids, span, stringOffset, stringOffsetsRented, i, header.TextureCount);

                textures.Add(new G4txTexture(
                    Id: ids[i],
                    Name: name,
                    Width: width,
                    Height: height,
                    Format: format,
                    MipMapCount: mipMapCount,
                    TextureData: textureData,
                    IsDds: isDds,
                    SubTextures: subTextures));
            }

            return textures;
        }
        finally
        {
            ArrayPool<short>.Shared.Return(stringOffsetsRented);
        }
    }

    /// <summary>Span overload — allocates one copy. Prefer the Memory overload when possible.</summary>
    public static List<G4txTexture> ParseTextures(ReadOnlySpan<byte> data)
        => ParseTextures(new ReadOnlyMemory<byte>(data.ToArray()));

    // -------------------------------------------------------------------------
    // NXTCH helpers
    // -------------------------------------------------------------------------

    public static NxtchHeader ParseNxtchHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < Marshal.SizeOf<NxtchHeader>())
            return default;
        return MemoryMarshal.AsRef<NxtchHeader>(data);
    }

    /// <summary>
    /// Returns the pixel data that follows the NXTCH header as a zero-copy Memory slice.
    /// </summary>
    public static ReadOnlyMemory<byte> ExtractNxtchTextureData(ReadOnlyMemory<byte> nxtchData)
    {
        int headerSize = Marshal.SizeOf<NxtchHeader>();
        return nxtchData.Length > headerSize ? nxtchData[headerSize..] : ReadOnlyMemory<byte>.Empty;
    }

    /// <summary>Span overload for callers that only have a span.</summary>
    public static ReadOnlyMemory<byte> ExtractNxtchTextureData(ReadOnlySpan<byte> nxtchData)
    {
        int headerSize = Marshal.SizeOf<NxtchHeader>();
        return nxtchData.Length > headerSize ? nxtchData[headerSize..].ToArray() : ReadOnlyMemory<byte>.Empty;
    }

    // -------------------------------------------------------------------------
    // Misc
    // -------------------------------------------------------------------------

    public static G4txHeader ParseHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < HEADER_SIZE)
            throw new InvalidDataException($"Data too small for G4TX header: {data.Length} < {HEADER_SIZE}");
        ref readonly var header = ref MemoryMarshal.AsRef<G4txHeader>(data[..HEADER_SIZE]);
        if (!header.IsValid)
            throw new InvalidDataException($"Invalid G4TX magic: 0x{header.Magic:X8}");
        return header;
    }

    public static uint CalculateNameHash(string name)
        => Crc32.Compute(Encoding.UTF8.GetBytes(name));

    public static void ExtractTextureFiles(string g4txPath, string outputDir)
    {
        Directory.CreateDirectory(outputDir);
        var textures = ParseFile(g4txPath);
        foreach (var tex in textures)
        {
            string ext  = tex.IsDds ? "dds" : "nxtch";
            string dest = Path.Combine(outputDir, $"{tex.Name}.{ext}");
            // ToArray() only at the final write boundary.
            File.WriteAllBytes(dest, tex.TextureData.ToArray());
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private static ReadOnlySpan<G4txEntry> ParseEntries(ReadOnlySpan<byte> data, int count)
    {
        if (data.Length < count * ENTRY_SIZE)
            throw new InvalidDataException($"Insufficient data for {count} G4TX entries");
        return MemoryMarshal.Cast<byte, G4txEntry>(data[..(count * ENTRY_SIZE)]);
    }

    private static ReadOnlySpan<G4txSubEntry> ParseSubEntries(ReadOnlySpan<byte> data, int count)
    {
        if (data.Length < count * SUB_ENTRY_SIZE)
            throw new InvalidDataException($"Insufficient data for {count} G4TX sub-entries");
        return MemoryMarshal.Cast<byte, G4txSubEntry>(data[..(count * SUB_ENTRY_SIZE)]);
    }

    private static IReadOnlyList<G4txSubTexture> BuildSubTextures(
        ReadOnlySpan<G4txSubEntry> subEntries,
        ReadOnlySpan<byte> ids,
        ReadOnlySpan<byte> fullData,
        int stringOffset,
        short[] stringOffsets,
        int textureIndex,
        int textureCount)
    {
        // Count first to avoid List resizing.
        int count = 0;
        foreach (ref readonly var sub in subEntries)
            if (sub.EntryId == textureIndex) count++;

        if (count == 0)
            return Array.Empty<G4txSubTexture>();

        var result   = new G4txSubTexture[count];
        int written  = 0;
        int subIdBase = textureCount; // sub-texture IDs start after main textures
        int subIdx   = 0;

        foreach (ref readonly var sub in subEntries)
        {
            if (sub.EntryId == textureIndex)
            {
                int absoluteId = subIdBase + subIdx;
                string subName = ReadNullTerminatedString(fullData[(stringOffset + stringOffsets[absoluteId])..]);
                result[written++] = new G4txSubTexture(
                    Id: ids[absoluteId],
                    Name: subName,
                    X: sub.X, Y: sub.Y,
                    Width: sub.Width, Height: sub.Height);
            }
            subIdx++;
        }

        return result;
    }

    private static string ReadNullTerminatedString(ReadOnlySpan<byte> data)
    {
        int end = data.IndexOf((byte)0);
        if (end < 0) end = data.Length;
        return Encoding.UTF8.GetString(data[..end]);
    }
}
