// G4MT Parser - Level-5 Graphics 4 Material/Texture
// Format: .g4mt (found inside .g4pk files)
// References: docs/nie-analysis/CHARACTER_FORMATS.md
// AOT-Compatible: Native AOT ready, no reflection

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// G4MT Header Structure
/// Magic: "G4MT" - Level-5 Graphics 4 Material/Texture
/// Purpose: Material definitions, animation data, or embedded textures
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly struct G4mtHeader
{
    public readonly uint Magic;              // "G4MT" (0x47344D54)
    public readonly int HeaderSize;
    public readonly int Version;
    public readonly int DataSize;
    public readonly int EntryCount;
    public readonly int TableOffset;

    public bool IsValid => Magic == 0x47344D54; // "G4MT"
}

/// <summary>
/// G4MT Entry - Offset/size pair for data blocks
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly struct G4mtEntry
{
    public readonly int Offset;
    public readonly int Size;
}

/// <summary>
/// Parsed G4MT data block
/// </summary>
public readonly record struct G4mtDataBlock(
    int Index,
    int Offset,
    int Size,
    ReadOnlyMemory<byte> Data
);

/// <summary>
/// AOT-Compatible G4MT Parser
/// </summary>
public static class G4mtParser
{
    public const uint MAGIC = 0x47344D54; // "G4MT"

    /// <summary>
    /// Parse G4MT header from binary data
    /// </summary>
    public static G4mtHeader ParseHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < Marshal.SizeOf<G4mtHeader>())
            throw new InvalidDataException("Data too small for G4MT header");

        ref readonly var header = ref MemoryMarshal.AsRef<G4mtHeader>(data);

        if (!header.IsValid)
            throw new InvalidDataException($"Invalid G4MT magic: 0x{header.Magic:X8}");

        return header;
    }

    /// <summary>
    /// Parse all data blocks from G4MT file
    /// </summary>
    public static List<G4mtDataBlock> ParseDataBlocks(ReadOnlySpan<byte> data)
    {
        var header = ParseHeader(data);
        var blocks = new List<G4mtDataBlock>();

        // Read entry table
        int entryOffset = header.TableOffset;
        var entries = MemoryMarshal.Cast<byte, G4mtEntry>(
            data.Slice(entryOffset, header.EntryCount * Marshal.SizeOf<G4mtEntry>()));

        // Extract data blocks
        for (int i = 0; i < entries.Length; i++)
        {
            ref readonly var entry = ref entries[i];

            if (entry.Size > 0 && entry.Offset + entry.Size <= data.Length)
            {
                var blockData = data.Slice(entry.Offset, entry.Size).ToArray();

                blocks.Add(new G4mtDataBlock(
                    Index: i,
                    Offset: entry.Offset,
                    Size: entry.Size,
                    Data: blockData
                ));
            }
        }

        return blocks;
    }

    /// <summary>
    /// Parse G4MT file from disk
    /// </summary>
    public static List<G4mtDataBlock> ParseFile(string path)
    {
        var data = File.ReadAllBytes(path);
        return ParseDataBlocks(data);
    }

    /// <summary>
    /// Extract all data blocks to directory
    /// </summary>
    public static void ExtractDataBlocks(string g4mtPath, string outputDir)
    {
        Directory.CreateDirectory(outputDir);

        var blocks = ParseFile(g4mtPath);

        for (int i = 0; i < blocks.Count; i++)
        {
            var block = blocks[i];
            var outputPath = Path.Combine(outputDir, $"block_{i:D3}_0x{block.Offset:X8}.bin");
            File.WriteAllBytes(outputPath, block.Data.ToArray());
        }
    }

    /// <summary>
    /// Check if data block contains float arrays (common in G4MT)
    /// </summary>
    public static bool ContainsFloatData(ReadOnlySpan<byte> data)
    {
        if (data.Length < 16 || data.Length % 4 != 0)
            return false;

        // Sample first few values
        for (int i = 0; i < Math.Min(4, data.Length / 4); i++)
        {
            float value = BinaryPrimitives.ReadSingleLittleEndian(data[(i * 4)..]);

            // Check if value is reasonable (common range for materials: 0-10)
            if (float.IsNaN(value) || float.IsInfinity(value) || Math.Abs(value) > 1000)
                return false;
        }

        return true;
    }
}
