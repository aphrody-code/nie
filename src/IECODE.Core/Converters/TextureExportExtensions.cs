using System;
using System.Threading;
using System.Threading.Tasks;
using IECODE.Core.Formats.Level5;
using IECODE.Core.Graphics;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;

namespace IECODE.Core.Converters;

public static class TextureExportExtensions
{
    // -------------------------------------------------------------------------
    // PNG
    // -------------------------------------------------------------------------

    public static void SaveAsPng(this G4txTexture texture, string outputPath,
        PngCompressionLevel compression = PngCompressionLevel.BestCompression)
    {
        using var image = texture.ToImage();
        image.Save(outputPath, new PngEncoder
        {
            CompressionLevel = compression,
            ColorType = PngColorType.RgbWithAlpha
        });
    }

    public static async Task SaveAsPngAsync(this G4txTexture texture, string outputPath,
        PngCompressionLevel compression = PngCompressionLevel.BestCompression,
        CancellationToken ct = default)
    {
        using var image = texture.ToImage();
        await image.SaveAsync(outputPath, new PngEncoder
        {
            CompressionLevel = compression,
            ColorType = PngColorType.RgbWithAlpha
        }, ct);
    }

    // -------------------------------------------------------------------------
    // WebP
    // -------------------------------------------------------------------------

    public static void SaveAsWebp(this G4txTexture texture, string outputPath,
        WebpFileFormatType fileFormat = WebpFileFormatType.Lossless,
        int quality = 90)
    {
        using var image = texture.ToImage();
        image.Save(outputPath, new WebpEncoder { FileFormat = fileFormat, Quality = quality });
    }

    public static async Task SaveAsWebpAsync(this G4txTexture texture, string outputPath,
        WebpFileFormatType fileFormat = WebpFileFormatType.Lossless,
        int quality = 90,
        CancellationToken ct = default)
    {
        using var image = texture.ToImage();
        await image.SaveAsync(outputPath, new WebpEncoder { FileFormat = fileFormat, Quality = quality }, ct);
    }

    // -------------------------------------------------------------------------
    // Shared decode — ReadOnlyMemory path (zero-copy through the full pipeline)
    // -------------------------------------------------------------------------

    /// <summary>
    /// Decodes a G4TX texture to an ImageSharp <see cref="Image{Rgba32}"/>.
    /// Uses the zero-copy Memory path: no intermediate byte[] allocation.
    /// Caller must dispose.
    /// </summary>
    public static Image<Rgba32> ToImage(this G4txTexture texture)
    {
        if (texture.IsDds)
            return TextureConverter.LoadDdsToImage(texture.TextureData);

        // Extract pixel data after NXTCH header — still a zero-copy slice.
        ReadOnlyMemory<byte> pixelData = G4txParser.ExtractNxtchTextureData(texture.TextureData);
        TextureFormat format = TextureConverter.MapG4txFormat(texture.Format);

        if (format == TextureFormat.Unknown)
            throw new NotSupportedException($"Unsupported G4TX format: 0x{texture.Format:X}");

        return TextureConverter.DecompressToImage(pixelData, texture.Width, texture.Height, format);
    }
}
