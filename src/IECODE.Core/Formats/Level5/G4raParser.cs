using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// G4RA (Resource Archive) Parser - Reverse engineered from nie.exe (FUN_1404ce260)
/// Contains packed game resources with reference counting.
/// AOT-Compatible: No reflection.
/// </summary>
public static class G4raParser
{
    /// <summary>Magic bytes "G4RA" in Little-Endian</summary>
    public const uint MAGIC_LE = 0x41523447; // "AR4G" read as LE

    /// <summary>Magic bytes "G4RA" in Big-Endian</summary>
    public const uint MAGIC_BE = 0x47345241; // "G4RA"

    /// <summary>
    /// G4RA Header structure (inferred from decompilation)
    /// </summary>
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct G4raHeader
    {
        public uint Magic;              // 0x00: "G4RA"
        public ushort HeaderSize;       // 0x04: Header size
        public ushort Version;          // 0x06: Format version
        public uint Reserved08;         // 0x08
        public uint Reserved0C;         // 0x0C

        // Entry table info (offset 0x20+)
        public uint EntryTableOffset;   // 0x10: Offset to entry table
        public uint EntryCount;         // 0x14: Number of entries
        public uint StringTableOffset;  // 0x18: Offset to string table
        public uint StringTableSize;    // 0x1C: Size of string table

        // Reference tracking (from decompilation)
        public long DataPointer;        // 0x20: Runtime pointer (param_1 + 0x20)
        public long IndexPointer;       // 0x28: Runtime index pointer (param_1 + 0x28)

        public short Field30;           // 0x30: Index tracking
        public short ActiveCount;       // 0x32: Active entry count (checked in parser)
        public short Field34;           // 0x34
        public short Field36;           // 0x36
        public short Field38;           // 0x38
        public short Field3A;           // 0x3A: Counter (decremented on cleanup)
    }

    /// <summary>
    /// G4RA Entry structure (0x28 bytes stride from decompilation)
    /// </summary>
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct G4raEntry
    {
        public long DataPointer;        // 0x00: Pointer to data (runtime)
        public long NextPointer;        // 0x08: Next entry pointer (linked list)
        public long ResourcePointer;    // 0x10: Resource data pointer
        public uint ResourceSize;       // 0x18: Size of resource data
        public ushort RefCount;         // 0x20: Reference count (decremented on release)
        public byte Flags1;             // 0x23: Flags (checked in parser)
        public byte Flags2;             // 0x24
        public byte Flags3;             // 0x25: Active flag (checked in parser)
        public ushort Reserved26;       // 0x26
    }

    /// <summary>
    /// Parsed G4RA resource entry
    /// </summary>
    public readonly record struct G4raResource(
        int Index,
        string Name,
        uint Offset,
        uint Size,
        ushort RefCount,
        byte Flags
    );

    /// <summary>
    /// Parsed G4RA archive
    /// </summary>
    public sealed class G4raArchive
    {
        public G4raHeader Header { get; init; }
        public IReadOnlyList<G4raResource> Resources { get; init; } = [];
        public ReadOnlyMemory<byte> Data { get; init; }

        /// <summary>
        /// Extract a resource by index.
        /// </summary>
        public ReadOnlySpan<byte> GetResource(int index)
        {
            if (index < 0 || index >= Resources.Count)
                throw new ArgumentOutOfRangeException(nameof(index));

            var resource = Resources[index];
            return Data.Span.Slice((int)resource.Offset, (int)resource.Size);
        }

        /// <summary>
        /// Extract a resource by name.
        /// </summary>
        public ReadOnlySpan<byte> GetResource(string name)
        {
            foreach (var resource in Resources)
            {
                if (resource.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                    return Data.Span.Slice((int)resource.Offset, (int)resource.Size);
            }
            throw new KeyNotFoundException($"Resource not found: {name}");
        }

        /// <summary>
        /// Extract all resources to a directory.
        /// </summary>
        public void ExtractAll(string outputDir)
        {
            Directory.CreateDirectory(outputDir);

            foreach (var resource in Resources)
            {
                var data = GetResource(resource.Index);
                var outputPath = Path.Combine(outputDir, resource.Name);

                // Create subdirectories if needed
                var dir = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrEmpty(dir))
                    Directory.CreateDirectory(dir);

                File.WriteAllBytes(outputPath, data.ToArray());
            }
        }
    }

    /// <summary>
    /// Validate G4RA magic bytes.
    /// </summary>
    public static bool IsG4ra(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4) return false;

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        return magic == MAGIC_LE || magic == MAGIC_BE;
    }

    /// <summary>
    /// Parse G4RA archive from binary data.
    /// Note: Full parsing requires runtime context from nie.exe.
    /// This implementation provides static file parsing.
    /// </summary>
    public static G4raArchive Parse(ReadOnlySpan<byte> data)
    {
        if (!IsG4ra(data))
            throw new InvalidDataException("Invalid G4RA magic");

        // Determine endianness
        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        bool isBigEndian = magic == MAGIC_BE;

        var header = ParseHeader(data, isBigEndian);
        var resources = new List<G4raResource>();

        // Parse entry table
        if (header.EntryTableOffset > 0 && header.EntryCount > 0)
        {
            int offset = (int)header.EntryTableOffset;

            for (int i = 0; i < header.EntryCount && offset + 0x28 <= data.Length; i++)
            {
                var entryData = data.Slice(offset, 0x28);

                uint resourceOffset = isBigEndian
                    ? BinaryPrimitives.ReadUInt32BigEndian(entryData[0x18..])
                    : BinaryPrimitives.ReadUInt32LittleEndian(entryData[0x18..]);

                ushort refCount = isBigEndian
                    ? BinaryPrimitives.ReadUInt16BigEndian(entryData[0x20..])
                    : BinaryPrimitives.ReadUInt16LittleEndian(entryData[0x20..]);

                byte flags = entryData[0x25];

                // Try to read name from string table
                string name = $"resource_{i:D4}";
                if (header.StringTableOffset > 0 && header.StringTableOffset + i * 4 < data.Length)
                {
                    int nameOffset = isBigEndian
                        ? BinaryPrimitives.ReadInt32BigEndian(data.Slice((int)header.StringTableOffset + i * 4, 4))
                        : BinaryPrimitives.ReadInt32LittleEndian(data.Slice((int)header.StringTableOffset + i * 4, 4));

                    if (nameOffset > 0 && nameOffset < data.Length)
                    {
                        name = ReadNullTerminatedString(data[nameOffset..]);
                    }
                }

                resources.Add(new G4raResource(
                    Index: i,
                    Name: name,
                    Offset: resourceOffset,
                    Size: 0, // Size determined at extraction
                    RefCount: refCount,
                    Flags: flags
                ));

                offset += 0x28;
            }
        }

        return new G4raArchive
        {
            Header = header,
            Resources = resources,
            Data = data.ToArray()
        };
    }

    private static G4raHeader ParseHeader(ReadOnlySpan<byte> data, bool isBigEndian)
    {
        return new G4raHeader
        {
            Magic = isBigEndian
                ? BinaryPrimitives.ReadUInt32BigEndian(data)
                : BinaryPrimitives.ReadUInt32LittleEndian(data),
            HeaderSize = isBigEndian
                ? BinaryPrimitives.ReadUInt16BigEndian(data[4..])
                : BinaryPrimitives.ReadUInt16LittleEndian(data[4..]),
            Version = isBigEndian
                ? BinaryPrimitives.ReadUInt16BigEndian(data[6..])
                : BinaryPrimitives.ReadUInt16LittleEndian(data[6..]),
            EntryTableOffset = isBigEndian
                ? BinaryPrimitives.ReadUInt32BigEndian(data[0x10..])
                : BinaryPrimitives.ReadUInt32LittleEndian(data[0x10..]),
            EntryCount = isBigEndian
                ? BinaryPrimitives.ReadUInt32BigEndian(data[0x14..])
                : BinaryPrimitives.ReadUInt32LittleEndian(data[0x14..]),
            StringTableOffset = isBigEndian
                ? BinaryPrimitives.ReadUInt32BigEndian(data[0x18..])
                : BinaryPrimitives.ReadUInt32LittleEndian(data[0x18..]),
            StringTableSize = isBigEndian
                ? BinaryPrimitives.ReadUInt32BigEndian(data[0x1C..])
                : BinaryPrimitives.ReadUInt32LittleEndian(data[0x1C..]),
            ActiveCount = isBigEndian
                ? BinaryPrimitives.ReadInt16BigEndian(data[0x32..])
                : BinaryPrimitives.ReadInt16LittleEndian(data[0x32..]),
        };
    }

    private static string ReadNullTerminatedString(ReadOnlySpan<byte> data)
    {
        int nullIndex = data.IndexOf((byte)0);
        if (nullIndex == -1) nullIndex = Math.Min(data.Length, 256);
        return System.Text.Encoding.UTF8.GetString(data[..nullIndex]);
    }

    /// <summary>
    /// Parse G4RA from file.
    /// </summary>
    public static G4raArchive ParseFile(string path)
    {
        var data = File.ReadAllBytes(path);
        return Parse(data);
    }

    /// <summary>
    /// Get summary information.
    /// </summary>
    public static string GetSummary(ReadOnlySpan<byte> data)
    {
        if (!IsG4ra(data))
            return "Not a valid G4RA file";

        var archive = Parse(data);

        return $"""
            G4RA Resource Archive
            ---------------------
            Version: {archive.Header.Version}
            Entries: {archive.Resources.Count}
            Active: {archive.Header.ActiveCount}
            Entry Table: 0x{archive.Header.EntryTableOffset:X}
            String Table: 0x{archive.Header.StringTableOffset:X}
            """;
    }
}
