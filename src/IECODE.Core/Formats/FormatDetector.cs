using System;
using System.Buffers.Binary;
using System.Collections.Frozen;
using System.Collections.Generic;

namespace IECODE.Core.Formats;

/// <summary>
/// Unified format detection service using magic bytes.
/// All Level-5 formats identified from nie.exe reverse engineering.
/// AOT-Compatible: No reflection.
/// </summary>
public static class FormatDetector
{
    /// <summary>Detected file format</summary>
    public enum Format
    {
        Unknown = 0,

        // Level-5 Graphics Formats (G4*)
        G4TX,       // Texture container
        G4MD,       // Model data (geometry)
        G4MG,       // Model group
        G4MT,       // Material
        G4SK,       // Skeleton
        G4PK,       // Package
        G4RA,       // Resource archive

        // Level-5 Other Formats
        AGI,        // Animation/Graphics Info
        OBJB,       // Binary objects
        PXCL,       // Pixel/Collision
        CFGBIN,     // Configuration binary
        XFSA,       // Archive (Kuriimu2)
        XPCK,       // Level-5 Package

        // Criware Formats
        CPK,        // Criware Package
        AFS2,       // Audio archive
        ADX,        // Audio
        HCA,        // High Compression Audio
        USM,        // Video
        UTF,        // Universal Table Format
        ACB,        // Audio Container Bundle
        AWB,        // Audio Wave Bank

        // Standard Formats
        DDS,        // DirectDraw Surface
        PNG,        // Portable Network Graphics
        RIFF,       // Resource Interchange (WAV, AVI)
        NXTCH,      // Nintendo Switch Texture Chunk
        ZIP,        // ZIP archive
        GZIP,       // GZIP compressed
        ZSTD,       // Zstandard compressed
    }

    /// <summary>Format metadata</summary>
    public readonly record struct FormatInfo(
        Format Format,
        string Extension,
        string Description,
        bool IsBigEndian,
        uint MagicBE,
        uint MagicLE
    );

    // Magic bytes database (from nie.exe reverse engineering)
    private static readonly FrozenDictionary<uint, FormatInfo> MagicToFormat = new Dictionary<uint, FormatInfo>
    {
        // Level-5 G4* formats
        [0x58543447] = new(Format.G4TX, ".g4tx", "Level-5 Texture Container", false, 0x47345458, 0x58543447),
        [0x47345458] = new(Format.G4TX, ".g4tx", "Level-5 Texture Container (BE)", true, 0x47345458, 0x58543447),

        [0x444D3447] = new(Format.G4MD, ".g4md", "Level-5 Model Data", false, 0x47344D44, 0x444D3447),
        [0x47344D44] = new(Format.G4MD, ".g4md", "Level-5 Model Data (BE)", true, 0x47344D44, 0x444D3447),

        [0x474D3447] = new(Format.G4MG, ".g4mg", "Level-5 Model Group", false, 0x47344D47, 0x474D3447),
        [0x47344D47] = new(Format.G4MG, ".g4mg", "Level-5 Model Group (BE)", true, 0x47344D47, 0x474D3447),

        [0x544D3447] = new(Format.G4MT, ".g4mt", "Level-5 Material", false, 0x47344D54, 0x544D3447),
        [0x47344D54] = new(Format.G4MT, ".g4mt", "Level-5 Material (BE)", true, 0x47344D54, 0x544D3447),

        [0x4B533447] = new(Format.G4SK, ".g4sk", "Level-5 Skeleton", false, 0x47345348, 0x4B533447),
        [0x47345348] = new(Format.G4SK, ".g4sk", "Level-5 Skeleton (BE)", true, 0x47345348, 0x4B533447),

        [0x4B503447] = new(Format.G4PK, ".g4pk", "Level-5 Package", false, 0x47345048, 0x4B503447),
        [0x47345048] = new(Format.G4PK, ".g4pk", "Level-5 Package (BE)", true, 0x47345048, 0x4B503447),

        // NEW formats from nie.exe analysis
        [0x41523447] = new(Format.G4RA, ".g4ra", "Level-5 Resource Archive", false, 0x47345241, 0x41523447),
        [0x47345241] = new(Format.G4RA, ".g4ra", "Level-5 Resource Archive (BE)", true, 0x47345241, 0x41523447),

        [0x4147492E] = new(Format.AGI, ".agi", "Level-5 Animation/Graphics", false, 0x2E494741, 0x4147492E),
        [0x2E494741] = new(Format.AGI, ".agi", "Level-5 Animation/Graphics (BE)", true, 0x2E494741, 0x4147492E),

        [0x6F626A62] = new(Format.OBJB, ".objb", "Level-5 Binary Objects", false, 0x626A626F, 0x6F626A62),
        [0x626A626F] = new(Format.OBJB, ".objb", "Level-5 Binary Objects (BE)", true, 0x626A626F, 0x6F626A62),

        [0x5058434C] = new(Format.PXCL, ".pxcl", "Level-5 Pixel/Collision", false, 0x4C435850, 0x5058434C),
        [0x4C435850] = new(Format.PXCL, ".pxcl", "Level-5 Pixel/Collision (BE)", true, 0x4C435850, 0x5058434C),

        // Criware formats
        [0x204B5043] = new(Format.CPK, ".cpk", "Criware Package", false, 0x43504B20, 0x204B5043),
        [0x43504B20] = new(Format.CPK, ".cpk", "Criware Package (BE)", true, 0x43504B20, 0x204B5043),

        [0x32534641] = new(Format.AFS2, ".afs2", "Criware Audio Archive", false, 0x41465332, 0x32534641),
        [0x41465332] = new(Format.AFS2, ".afs2", "Criware Audio Archive (BE)", true, 0x41465332, 0x32534641),

        [0x00465455] = new(Format.UTF, ".utf", "Criware UTF Table", false, 0x55544600, 0x00465455),
        [0x55544600] = new(Format.UTF, ".utf", "Criware UTF Table (BE)", true, 0x55544600, 0x00465455),

        // Standard formats
        [0x20534444] = new(Format.DDS, ".dds", "DirectDraw Surface", false, 0x44445320, 0x20534444),
        [0x474E5089] = new(Format.PNG, ".png", "PNG Image", false, 0x89504E47, 0x474E5089),
        [0x46464952] = new(Format.RIFF, ".wav", "RIFF Audio/Video", false, 0x52494646, 0x46464952),

        // Additional formats
        [0x04034B50] = new(Format.ZIP, ".zip", "ZIP Archive", false, 0x504B0304, 0x04034B50),
        [0x8B1F] = new(Format.GZIP, ".gz", "GZIP Compressed", false, 0x1F8B, 0x8B1F),
        [0xFD2FB528] = new(Format.ZSTD, ".zst", "Zstandard Compressed", false, 0x28B52FFD, 0xFD2FB528),

        // Level-5 XPCK format
        [0x4B435058] = new(Format.XPCK, ".xpck", "Level-5 XPCK Package", false, 0x5850434B, 0x4B435058),
        [0x5850434B] = new(Format.XPCK, ".xpck", "Level-5 XPCK Package (BE)", true, 0x5850434B, 0x4B435058),

        // XFSA
        [0x41534658] = new(Format.XFSA, ".xfsa", "Level-5 XFSA Archive", false, 0x58465341, 0x41534658),
        [0x58465341] = new(Format.XFSA, ".xfsa", "Level-5 XFSA Archive (BE)", true, 0x58465341, 0x41534658),

        // Criware ACB/AWB
        [0x46544140] = new(Format.ACB, ".acb", "Criware ACB Container", false, 0x40415446, 0x46544140),

    }.ToFrozenDictionary();

    /// <summary>
    /// Detect format from binary data.
    /// </summary>
    public static FormatInfo Detect(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4)
            return new FormatInfo(Format.Unknown, "", "Unknown", false, 0, 0);

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);

        if (MagicToFormat.TryGetValue(magic, out var info))
            return info;

        // Try Big-Endian
        magic = BinaryPrimitives.ReadUInt32BigEndian(data);
        if (MagicToFormat.TryGetValue(magic, out info))
            return info;

        // Check for special cases

        // NXTCH (8-byte magic)
        if (data.Length >= 8)
        {
            ulong magic8 = BinaryPrimitives.ReadUInt64LittleEndian(data);
            if ((magic8 & 0xFFFFFFFFFF) == 0x484354584E) // "NXTCH"
                return new FormatInfo(Format.NXTCH, ".nxtch", "Nintendo Switch Texture", false, 0, 0);
        }

        // cfg.bin (check for specific patterns)
        if (data.Length >= 8)
        {
            // cfg.bin starts with entry count + string table offset pattern
            uint first = BinaryPrimitives.ReadUInt32LittleEndian(data);
            uint second = BinaryPrimitives.ReadUInt32LittleEndian(data[4..]);
            if (first < 0x10000 && second > first && second < 0x100000)
            {
                // Could be cfg.bin - check extension or additional patterns
            }
        }

        return new FormatInfo(Format.Unknown, "", "Unknown format", false, 0, 0);
    }

    /// <summary>
    /// Detect format from file path.
    /// </summary>
    public static FormatInfo DetectFromFile(string filePath)
    {
        using var fs = File.OpenRead(filePath);
        Span<byte> header = stackalloc byte[16];
        int read = fs.Read(header);
        return Detect(header[..read]);
    }

    /// <summary>
    /// Get format info by format enum.
    /// </summary>
    public static FormatInfo GetInfo(Format format)
    {
        foreach (var kvp in MagicToFormat)
        {
            if (kvp.Value.Format == format && !kvp.Value.IsBigEndian)
                return kvp.Value;
        }
        return new FormatInfo(Format.Unknown, "", "Unknown", false, 0, 0);
    }

    /// <summary>
    /// Check if data matches expected format.
    /// </summary>
    public static bool IsFormat(ReadOnlySpan<byte> data, Format expected)
    {
        var detected = Detect(data);
        return detected.Format == expected;
    }

    /// <summary>
    /// Get all supported formats.
    /// </summary>
    public static IEnumerable<FormatInfo> GetSupportedFormats()
    {
        var seen = new HashSet<Format>();
        foreach (var kvp in MagicToFormat)
        {
            if (!kvp.Value.IsBigEndian && seen.Add(kvp.Value.Format))
                yield return kvp.Value;
        }
    }
}
