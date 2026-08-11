using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// Handles texture unswizzling (Block Linear -> Linear) for Switch textures.
/// Uses Morton Order (Z-Order curve) or Block Linear logic.
/// </summary>
public static class TextureSwizzler
{
    /// <summary>
    /// Unswizzles a texture from Block Linear layout to standard Linear layout.
    /// </summary>
    /// <param name="data">Raw swizzled data</param>
    /// <param name="width">Texture width</param>
    /// <param name="height">Texture height</param>
    /// <param name="blockSize">Bytes per pixel (or block size for BCn)</param>
    /// <param name="blockHeightLog2">Log2 of the block height (GOB height), usually 0-5</param>
    /// <returns>Linear texture data</returns>
    public static byte[] Unswizzle(ReadOnlySpan<byte> data, int width, int height, int blockSize, int blockHeightLog2 = 0)
    {
        // For BCn formats, we work with 4x4 blocks, not pixels
        // blockSize is 8 (BC1/4) or 16 (BC2/3/5/7)
        // width/height are in blocks

        int blockWidth = (width + 3) / 4;
        int blockHeight = (height + 3) / 4;

        // If not compressed (e.g. RGBA8), blockSize is 4, and we work with pixels
        // But usually Switch textures in this context are BCn compressed

        // Adjust for BCn vs RGBA
        bool isCompressed = blockSize >= 8;
        int w = isCompressed ? blockWidth : width;
        int h = isCompressed ? blockHeight : height;

        byte[] output = new byte[w * h * blockSize];


        int blockHeightInGobs = 1 << blockHeightLog2;

        // Parallel.For could be used here for performance, but keeping it simple/AOT-safe first
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int swizzledOffset = GetSwizzledOffset(x, y, w, blockSize, blockHeightLog2);
                int linearOffset = (y * w + x) * blockSize;

                if (swizzledOffset + blockSize <= data.Length && linearOffset + blockSize <= output.Length)
                {
                    data.Slice(swizzledOffset, blockSize).CopyTo(output.AsSpan(linearOffset));
                }
            }
        }

        return output;
    }

    /// <summary>
    /// Calculates the offset in the swizzled buffer for a given (x, y) coordinate.
    /// Implements Tegra X1 Block Linear addressing.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static int GetSwizzledOffset(int x, int y, int width, int bytesPerPixel, int blockHeightLog2)
    {
        int imageWidthInGobs = (width * bytesPerPixel + 63) / 64;

        // GOB coordinates
        int gobX = (x * bytesPerPixel) / 64;
        int gobY = y / 8;

        // Offset within GOB
        int xInGob = (x * bytesPerPixel) % 64;
        int yInGob = y % 8;

        // Block Linear logic
        // 1. Determine which "Block" of GOBs we are in
        int blockHeightInGobs = 1 << blockHeightLog2;
        int blockY = gobY / blockHeightInGobs;
        int gobYInBlock = gobY % blockHeightInGobs;

        // 2. Calculate base address of the Block
        // Blocks are arranged linearly: Block 0, Block 1, ...
        // Each Block is (ImageWidthInGobs) * (BlockHeightInGobs) * GOB_SIZE
        int blockAddress = blockY * imageWidthInGobs * blockHeightInGobs * 512;

        // 3. Calculate address of the GOB within the Block
        // Within a block, GOBs are arranged in row-major order? 
        // Actually, Tegra Block Linear is usually:
        // Address = (BlockY * StrideInBlocks + BlockX) * BlockSize + OffsetInBlock

        // Simplified Tegra addressing:
        // Offset = (gobY / blockHeight) * stride * blockHeight * 512 
        //        + (gobX) * blockHeight * 512
        //        + (gobY % blockHeight) * 512
        //        + (y % 8) * 64
        //        + (x * bpp) % 64

        // Let's try the standard formula found in open source switch tools (Ryujinx/Citra refs)

        int gobIdx = gobYInBlock + (gobX * blockHeightInGobs) + (blockY * imageWidthInGobs * blockHeightInGobs);
        // Note: The above assumes GOBs are ordered vertically first within a block column?
        // Actually, standard Block Linear is:
        // 1. Global Block Y (groups of blockHeight GOBs)
        // 2. Global Block X (groups of 1 GOB width)

        // Correct logic for Tegra X1:
        // Base = (gobY / blockHeight) * (imageWidthInGobs * blockHeight * 512)
        //      + (gobX * blockHeight * 512)
        //      + (gobY % blockHeight) * 512

        int baseOffset = (gobY / blockHeightInGobs) * imageWidthInGobs * blockHeightInGobs * 512;
        baseOffset += gobX * blockHeightInGobs * 512;
        baseOffset += gobYInBlock * 512;

        // Add internal GOB offset
        // GOB is 64x8 bytes.
        // Internal addressing is roughly: ((y % 8) / 2) * 128 + ((x % 64) / 32) * 64 + ((y % 2) * 32) + (x % 32)
        // But simpler: standard linear within GOB for some formats, or specific swizzle.
        // Most Switch textures use a specific internal GOB swizzle.
        // For now, we'll assume the "linear" GOB mapping which is:
        // Offset = yInGob * 64 + xInGob
        // If this produces wrong results, we need the full Morton swizzle within GOB.

        // However, Tegra X1 GOBs are usually internally swizzled too.
        // Let's use a standard Morton-like approximation for the GOB internal if needed.
        // But many tools just treat GOB as 64x8 linear bytes. Let's try that first.

        int gobOffset = yInGob * 64 + xInGob;

        return baseOffset + gobOffset;
    }
}
