// NXTCH Parser - Nintendo Switch Texture Chunk
// Format: .nxtch (extracted from G4TX files)
// References: lib/Kuriimu2/plugins/Level5/plugin_level5/Switch/Archive/G4txSupport.cs
// AOT-Compatible: Native AOT ready, no reflection

using System;
using System.Buffers.Binary;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// NXTCH texture format enumeration
/// Based on Switch GPU texture formats
/// </summary>
public enum NxtchTextureFormat
{
    Unknown = 0,
    BC1 = 0x01,      // DXT1
    BC2 = 0x02,      // DXT3
    BC3 = 0x03,      // DXT5
    BC4 = 0x04,      // ATI1/BC4
    BC5 = 0x05,      // ATI2/BC5
    BC6 = 0x06,      // BC6H
    BC7 = 0x07,      // BC7
    RGBA8 = 0x1F,    // RGBA8888
}

/// <summary>
/// AOT-Compatible NXTCH Parser
/// </summary>
public static class NxtchParser
{
    public const string MAGIC = "NXTCH";
    private const int HEADER_SIZE = 44;

    /// <summary>
    /// Parse NXTCH header from binary data
    /// </summary>
    public static NxtchHeader ParseHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < HEADER_SIZE)
            throw new InvalidDataException($"Data too small for NXTCH header: {data.Length} < {HEADER_SIZE}");

        ref readonly var header = ref MemoryMarshal.AsRef<NxtchHeader>(data[..HEADER_SIZE]);

        if (!header.IsValid)
            throw new InvalidDataException("Invalid NXTCH magic");

        return header;
    }

    /// <summary>
    /// Extract raw texture data (after header)
    /// </summary>
    public static ReadOnlySpan<byte> ExtractTextureData(ReadOnlySpan<byte> data)
    {
        var header = ParseHeader(data);
        return data[HEADER_SIZE..];
    }

    /// <summary>
    /// Get texture format as enum
    /// </summary>
    public static NxtchTextureFormat GetTextureFormat(NxtchHeader header)
    {
        return header.Format switch
        {
            0x01 => NxtchTextureFormat.BC1,
            0x02 => NxtchTextureFormat.BC2,
            0x03 => NxtchTextureFormat.BC3,
            0x04 => NxtchTextureFormat.BC4,
            0x05 => NxtchTextureFormat.BC5,
            0x06 => NxtchTextureFormat.BC6,
            0x07 => NxtchTextureFormat.BC7,
            0x1F => NxtchTextureFormat.RGBA8,
            _ => NxtchTextureFormat.Unknown
        };
    }

    /// <summary>
    /// Calculate expected texture data size
    /// </summary>
    public static int CalculateTextureDataSize(NxtchHeader header)
    {
        var format = GetTextureFormat(header);
        int width = header.Width;
        int height = header.Height;
        int mipmapCount = Math.Max(1, header.MipMapCount);

        int totalSize = 0;

        for (int mip = 0; mip < mipmapCount; mip++)
        {
            int mipWidth = Math.Max(1, width >> mip);
            int mipHeight = Math.Max(1, height >> mip);

            totalSize += format switch
            {
                NxtchTextureFormat.BC1 or NxtchTextureFormat.BC4 =>
                    ((mipWidth + 3) / 4) * ((mipHeight + 3) / 4) * 8,

                NxtchTextureFormat.BC2 or NxtchTextureFormat.BC3 or
                NxtchTextureFormat.BC5 or NxtchTextureFormat.BC7 =>
                    ((mipWidth + 3) / 4) * ((mipHeight + 3) / 4) * 16,

                NxtchTextureFormat.RGBA8 =>
                    mipWidth * mipHeight * 4,

                _ => 0
            };
        }

        return totalSize;
    }

    /// <summary>
    /// Parse NXTCH file from disk
    /// </summary>
    public static (NxtchHeader header, byte[] textureData) ParseFile(string path)
    {
        var data = File.ReadAllBytes(path);
        var header = ParseHeader(data);
        var textureData = ExtractTextureData(data).ToArray();

        return (header, textureData);
    }

    /// <summary>
    /// Convert NXTCH to DDS format
    /// </summary>
    public static byte[] ConvertToDds(ReadOnlySpan<byte> nxtchData)
    {
        var header = ParseHeader(nxtchData);
        var textureData = ExtractTextureData(nxtchData);

        // Create DDS header
        var ddsHeader = CreateDdsHeader(header);

        // Combine header + texture data
        var ddsData = new byte[ddsHeader.Length + textureData.Length];
        ddsHeader.CopyTo(ddsData, 0);
        textureData.CopyTo(ddsData.AsSpan()[ddsHeader.Length..]);

        return ddsData;
    }

    /// <summary>
    /// Create DDS header from NXTCH header
    /// </summary>
    private static byte[] CreateDdsHeader(NxtchHeader header)
    {
        var ddsHeader = new byte[128];
        var span = ddsHeader.AsSpan();

        // DDS magic
        BinaryPrimitives.WriteUInt32LittleEndian(span, 0x20534444); // "DDS "

        // DDS_HEADER
        BinaryPrimitives.WriteInt32LittleEndian(span[4..], 124); // dwSize
        BinaryPrimitives.WriteUInt32LittleEndian(span[8..], 0x1007); // dwFlags (CAPS | HEIGHT | WIDTH | PIXELFORMAT)
        BinaryPrimitives.WriteInt32LittleEndian(span[12..], header.Height);
        BinaryPrimitives.WriteInt32LittleEndian(span[16..], header.Width);

        var format = GetTextureFormat(header);
        int pitchOrLinearSize = format switch
        {
            NxtchTextureFormat.BC1 => Math.Max(1, ((header.Width + 3) / 4)) * 8,
            _ => Math.Max(1, ((header.Width + 3) / 4)) * 16
        };
        BinaryPrimitives.WriteInt32LittleEndian(span[20..], pitchOrLinearSize);

        BinaryPrimitives.WriteInt32LittleEndian(span[28..], Math.Max(1, header.MipMapCount));

        // DDS_PIXELFORMAT
        BinaryPrimitives.WriteInt32LittleEndian(span[76..], 32); // dwSize
        BinaryPrimitives.WriteUInt32LittleEndian(span[80..], 0x4); // dwFlags (FOURCC)

        // FourCC based on format
        uint fourcc = format switch
        {
            NxtchTextureFormat.BC1 => 0x31545844, // "DXT1"
            NxtchTextureFormat.BC2 => 0x33545844, // "DXT3"
            NxtchTextureFormat.BC3 => 0x35545844, // "DXT5"
            NxtchTextureFormat.BC4 => 0x31495441, // "ATI1"
            NxtchTextureFormat.BC5 => 0x32495441, // "ATI2"
            NxtchTextureFormat.BC7 => 0x00000000, // DX10 header needed
            _ => 0x00000000
        };
        BinaryPrimitives.WriteUInt32LittleEndian(span[84..], fourcc);

        // DDS_HEADER.dwCaps
        BinaryPrimitives.WriteUInt32LittleEndian(span[108..], 0x1000); // TEXTURE

        return ddsHeader;
    }
}
