using System.Buffers.Binary;
using System.Runtime.InteropServices;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// Parser DDS optimisé pour textures G4TX (DXT1/BC1).
/// 100% AOT-compatible, pas de reflection.
/// </summary>
public static class DdsParser
{
    public const uint DDS_MAGIC = 0x20534444; // "DDS "
    private const int DDS_HEADER_SIZE = 128;

    /// <summary>
    /// Header DDS (124 bytes après magic)
    /// </summary>
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public readonly struct DdsHeader
    {
        public readonly uint Size;              // Must be 124
        public readonly uint Flags;
        public readonly uint Height;
        public readonly uint Width;
        public readonly uint PitchOrLinearSize;
        public readonly uint Depth;
        public readonly uint MipMapCount;
        // Reserved1[11] - 44 bytes
        public readonly uint Reserved1_0, Reserved1_1, Reserved1_2, Reserved1_3;
        public readonly uint Reserved1_4, Reserved1_5, Reserved1_6, Reserved1_7;
        public readonly uint Reserved1_8, Reserved1_9, Reserved1_10;
        // PixelFormat - 32 bytes
        public readonly uint PfSize;
        public readonly uint PfFlags;
        public readonly uint PfFourCC;
        public readonly uint PfRGBBitCount;
        public readonly uint PfRBitMask;
        public readonly uint PfGBitMask;
        public readonly uint PfBBitMask;
        public readonly uint PfABitMask;
        // Caps - 16 bytes
        public readonly uint Caps;
        public readonly uint Caps2;
        public readonly uint Caps3;
        public readonly uint Caps4;
        public readonly uint Reserved2;

        public bool IsDxt1 => PfFourCC == 0x31545844; // "DXT1"
    }

    /// <summary>
    /// Parse le header DDS depuis les données brutes.
    /// </summary>
    public static DdsHeader ParseHeader(ReadOnlySpan<byte> ddsData)
    {
        if (ddsData.Length < DDS_HEADER_SIZE)
            throw new InvalidDataException($"DDS file too small: {ddsData.Length} bytes");

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(ddsData);
        if (magic != DDS_MAGIC)
            throw new InvalidDataException($"Invalid DDS magic: 0x{magic:X8}");

        return MemoryMarshal.Read<DdsHeader>(ddsData.Slice(4, 124));
    }

    /// <summary>
    /// Extrait les données DXT1 (sans header).
    /// </summary>
    public static ReadOnlySpan<byte> ExtractDxt1Data(ReadOnlySpan<byte> ddsData)
    {
        return ddsData.Slice(DDS_HEADER_SIZE);
    }

    /// <summary>
    /// Décompresse DXT1 → RGBA32 pour ImageSharp.
    /// Algorithme BC1 optimisé pour AOT.
    /// </summary>
    public static Image<Rgba32> DecompressDxt1(int width, int height, ReadOnlySpan<byte> dxt1Data)
    {
        int blocksX = (width + 3) / 4;
        int blocksY = (height + 3) / 4;
        int expectedSize = blocksX * blocksY * 8; // 8 bytes per block

        if (dxt1Data.Length < expectedSize)
            throw new InvalidDataException($"DXT1 data too small: {dxt1Data.Length} < {expectedSize}");

        var image = new Image<Rgba32>(width, height);

        int blockIndex = 0;
        for (int by = 0; by < blocksY; by++)
        {
            for (int bx = 0; bx < blocksX; bx++)
            {
                DecompressDxt1Block(
                    dxt1Data.Slice(blockIndex * 8, 8),
                    image,
                    bx * 4,
                    by * 4,
                    width,
                    height);
                blockIndex++;
            }
        }

        return image;
    }

    /// <summary>
    /// Décompresse un bloc DXT1 4x4 pixels.
    /// </summary>
    private static void DecompressDxt1Block(
        ReadOnlySpan<byte> blockData,
        Image<Rgba32> image,
        int startX,
        int startY,
        int imageWidth,
        int imageHeight)
    {
        // Color0 et Color1 (RGB565)
        ushort color0 = BinaryPrimitives.ReadUInt16LittleEndian(blockData);
        ushort color1 = BinaryPrimitives.ReadUInt16LittleEndian(blockData.Slice(2));

        // Décompresser RGB565 → RGB888
        Rgba32 c0 = Rgb565ToRgba32(color0);
        Rgba32 c1 = Rgb565ToRgba32(color1);

        // Palette de 4 couleurs
        Span<Rgba32> palette = stackalloc Rgba32[4];
        palette[0] = c0;
        palette[1] = c1;

        if (color0 > color1)
        {
            // Mode opaque: interpolation 2/3, 1/3
            palette[2] = LerpRgba(c0, c1, 2, 1);
            palette[3] = LerpRgba(c0, c1, 1, 2);
        }
        else
        {
            // Mode transparent: interpolation 1/1, alpha=0
            palette[2] = LerpRgba(c0, c1, 1, 1);
            palette[3] = new Rgba32(0, 0, 0, 0);
        }

        // Indices (2 bits par pixel, 4 bytes pour 4x4)
        uint indices = BinaryPrimitives.ReadUInt32LittleEndian(blockData.Slice(4));

        // Remplir le bloc 4x4
        for (int y = 0; y < 4; y++)
        {
            for (int x = 0; x < 4; x++)
            {
                int pixelX = startX + x;
                int pixelY = startY + y;

                if (pixelX < imageWidth && pixelY < imageHeight)
                {
                    int shift = (y * 4 + x) * 2;
                    int colorIndex = (int)((indices >> shift) & 0x3);
                    image[pixelX, pixelY] = palette[colorIndex];
                }
            }
        }
    }

    /// <summary>
    /// Convertit RGB565 → RGBA32.
    /// </summary>
    private static Rgba32 Rgb565ToRgba32(ushort rgb565)
    {
        byte r = (byte)(((rgb565 >> 11) & 0x1F) * 255 / 31);
        byte g = (byte)(((rgb565 >> 5) & 0x3F) * 255 / 63);
        byte b = (byte)((rgb565 & 0x1F) * 255 / 31);
        return new Rgba32(r, g, b, 255);
    }

    /// <summary>
    /// Interpolation linéaire de couleurs RGBA.
    /// </summary>
    private static Rgba32 LerpRgba(Rgba32 c0, Rgba32 c1, int weight0, int weight1)
    {
        int totalWeight = weight0 + weight1;
        byte r = (byte)((c0.R * weight0 + c1.R * weight1) / totalWeight);
        byte g = (byte)((c0.G * weight0 + c1.G * weight1) / totalWeight);
        byte b = (byte)((c0.B * weight0 + c1.B * weight1) / totalWeight);
        byte a = (byte)((c0.A * weight0 + c1.A * weight1) / totalWeight);
        return new Rgba32(r, g, b, a);
    }
}
