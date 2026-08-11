// Upgraded G4PK Parser based on Kuriimu2 plugin_level5
// Format: .g4pk (Level-5 Graphics 4 Package)
// References: lib/Kuriimu2/plugins/Level5/plugin_level5/Switch/Archive/G4pk.cs
// AOT-Compatible: Native AOT ready, no reflection

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using IECODE.Core.Formats.Level5.CfgBin.Tools;
using IECODE.Core.Compression;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// G4PK Header Structure (64 bytes / 0x40)
/// Magic: "G4PK" - Level-5 Graphics 4 Package Container
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public unsafe struct G4pkHeader
{
    public uint Magic;              // "G4PK" (0x4734504B)
    public short HeaderSize;        // 0x40 (64 bytes)
    public short FileType;          // 0x64
    public int Version;             // 0x00100000
    public int ContentSize;         // Size after header

    public fixed byte Zeroes1[16];          // 0x10 padding

    public int FileCount;           // Number of files
    public short Table2EntryCount;  // Hash table size
    public short Table3EntryCount;  // String table size  
    public short Unknown2;
    public short Unknown3;

    public fixed byte Zeroes2[20];          // 0x14 padding

    public readonly bool IsValid => Magic == 0x4B503447; // "G4PK" (LE)
}

/// <summary>
/// Parsed G4PK file entry
/// </summary>
public readonly record struct G4pkFile(
    string Name,
    int Offset,
    int Size,
    uint Hash,
    ReadOnlyMemory<byte> Data
);

/// <summary>
/// AOT-Compatible G4PK Parser with Kuriimu2 features
/// </summary>
public static class G4pkParser
{
    public const uint MAGIC = 0x4B503447; // "G4PK" (LE)
    private const int HEADER_SIZE = 64;

    /// <summary>
    /// Parse G4PK header from binary data
    /// </summary>
    public static G4pkHeader ParseHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < HEADER_SIZE)
            throw new InvalidDataException($"Data too small for G4PK header: {data.Length} < {HEADER_SIZE}");

        ref readonly var header = ref MemoryMarshal.AsRef<G4pkHeader>(data[..HEADER_SIZE]);

        if (!header.IsValid)
            throw new InvalidDataException($"Invalid G4PK magic: 0x{header.Magic:X8}");

        return header;
    }

    /// <summary>
    /// Parse all files from G4PK archive with automatic decompression
    /// </summary>
    public static List<G4pkFile> ParseFiles(ReadOnlySpan<byte> data, bool autoDecompress = true)
    {
        var header = ParseHeader(data);
        var files = new List<G4pkFile>();

        // Read file offsets (shifted by 2 bits)
        int offsetTablePos = header.HeaderSize;
        var fileOffsets = new int[header.FileCount];
        for (int i = 0; i < header.FileCount; i++)
        {
            fileOffsets[i] = BinaryPrimitives.ReadInt32LittleEndian(
                data.Slice(offsetTablePos + i * 4, 4));
        }

        // Read file sizes
        int sizeTablePos = offsetTablePos + header.FileCount * 4;
        var fileSizes = new int[header.FileCount];
        for (int i = 0; i < header.FileCount; i++)
        {
            fileSizes[i] = BinaryPrimitives.ReadInt32LittleEndian(
                data.Slice(sizeTablePos + i * 4, 4));
        }

        // Read hashes (CRC32)
        int hashTablePos = sizeTablePos + header.FileCount * 4;
        var hashes = new uint[header.Table2EntryCount];
        for (int i = 0; i < header.Table2EntryCount; i++)
        {
            hashes[i] = BinaryPrimitives.ReadUInt32LittleEndian(
                data.Slice(hashTablePos + i * 4, 4));
        }

        // Read unknown IDs (skip for now)
        int unkTablePos = hashTablePos + header.Table2EntryCount * 4;

        // Read string offsets (aligned to 4 bytes)
        int stringOffsetPos = (unkTablePos + header.Table3EntryCount + 3) & ~3;
        int stringDataPos = stringOffsetPos;

        var stringOffsets = new short[header.Table3EntryCount / 2];
        for (int i = 0; i < stringOffsets.Length; i++)
        {
            stringOffsets[i] = BinaryPrimitives.ReadInt16LittleEndian(
                data.Slice(stringOffsetPos + i * 2, 2));
        }

        // Read files
        for (int i = 0; i < header.FileCount; i++)
        {
            // Read file name
            int namePos = stringDataPos + stringOffsets[i];
            string name = ReadNullTerminatedString(data[namePos..]);

            // Calculate actual file offset (shifted left by 2)
            int fileOffset = header.HeaderSize + (fileOffsets[i] << 2);
            int fileSize = fileSizes[i];

            // Extract file data
            var fileData = data.Slice(fileOffset, fileSize);

            // Auto-decompress if enabled
            byte[] finalData;
            if (autoDecompress && CompressionHelper.IsCompressed(fileData))
            {
                try
                {
                    finalData = CompressionHelper.Decompress(fileData);
                }
                catch
                {
                    // Decompression failed, use raw data
                    finalData = fileData.ToArray();
                }
            }
            else
            {
                finalData = fileData.ToArray();
            }

            files.Add(new G4pkFile(
                Name: name,
                Offset: fileOffset,
                Size: fileSize,
                Hash: i < hashes.Length ? hashes[i] : 0,
                Data: finalData
            ));
        }

        return files;
    }

    /// <summary>
    /// Read null-terminated string from binary data
    /// </summary>
    private static string ReadNullTerminatedString(ReadOnlySpan<byte> data)
    {
        int nullIndex = data.IndexOf((byte)0);
        if (nullIndex == -1)
            nullIndex = data.Length;

        return Encoding.UTF8.GetString(data[..nullIndex]);
    }

    /// <summary>
    /// Parse G4PK file from disk
    /// </summary>
    public static List<G4pkFile> ParseFile(string path)
    {
        var data = File.ReadAllBytes(path);
        return ParseFiles(data);
    }

    /// <summary>
    /// Extract all files from G4PK to directory
    /// </summary>
    public static void ExtractFiles(string g4pkPath, string outputDir)
    {
        Directory.CreateDirectory(outputDir);

        var files = ParseFile(g4pkPath);

        foreach (var file in files)
        {
            var outputPath = Path.Combine(outputDir, file.Name);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            File.WriteAllBytes(outputPath, file.Data.ToArray());
        }
    }

    /// <summary>
    /// Calculate CRC32 hash for filename (used for hash table)
    /// </summary>
    public static uint CalculateFileHash(string filename)
    {
        return Crc32.Compute(Encoding.UTF8.GetBytes(filename));
    }

    /// <summary>
    /// Detect compression format for data
    /// </summary>
    public static CompressionFormat DetectCompression(ReadOnlySpan<byte> data)
    {
        return CompressionHelper.DetectFormat(data);
    }

    /// <summary>
    /// Detect the Level-5 sub-format of an extracted G4PK entry by its 4-byte
    /// ASCII magic (G4SK/G4MG/G4TX/G4MD/G4MT/G4NV/G4RA…). Falls back to the file
    /// name extension when the payload carries no recognizable magic (e.g. objbin,
    /// cfg.bin), and to "raw" otherwise.
    /// </summary>
    public static string DetectSubFormat(string name, ReadOnlySpan<byte> data)
    {
        if (data.Length >= 4 &&
            IsPrintableMagic(data[0], data[1], data[2], data[3]))
        {
            // Level-5 containers consistently use a "G4??" ASCII magic.
            if (data[0] == (byte)'G' && data[1] == (byte)'4')
            {
                return Encoding.ASCII.GetString(data[..4]);
            }
        }

        // No container magic: classify by extension (objbin, cfg.bin, …).
        string ext = Path.GetExtension(name);
        if (!string.IsNullOrEmpty(ext))
            return ext.TrimStart('.').ToLowerInvariant();

        return "raw";
    }

    private static bool IsPrintableMagic(byte a, byte b, byte c, byte d)
        => IsPrintable(a) && IsPrintable(b) && IsPrintable(c) && IsPrintable(d);

    private static bool IsPrintable(byte v) => v >= 0x20 && v < 0x7F;
}

