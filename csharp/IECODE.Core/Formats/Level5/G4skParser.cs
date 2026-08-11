using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// Parser for G4SK (Level-5 Graphics 4 Skeleton).
/// Contains bone hierarchy and animation data.
/// </summary>
public class G4skParser
{
    public const uint MAGIC = 0x4B533447; // "G4SK"

    public struct G4skHeader
    {
        public uint Magic;
        public ushort HeaderSize;
        public ushort TypeId;
        public uint FileSize;
        public ushort BoneCount;
        // Offsets are currently unknown/confusing, so we use heuristics
    }

    public class Bone
    {
        public int Index;
        public string Name = string.Empty;
        public short ParentIndex;
        // Matrix or Transform data would go here
    }

    public G4skHeader Header { get; private set; }
    public List<Bone> Bones { get; private set; } = new();

    public void Parse(string filePath)
    {
        var data = File.ReadAllBytes(filePath);
        var span = data.AsSpan();

        // 1. Parse Header
        Header = ParseHeader(span);

        // 2. Parse Bones using heuristics
        ParseBones(span);
    }

    private G4skHeader ParseHeader(ReadOnlySpan<byte> span)
    {
        var header = new G4skHeader();
        header.Magic = BinaryPrimitives.ReadUInt32LittleEndian(span.Slice(0, 4));

        if (header.Magic != MAGIC)
            throw new InvalidDataException($"Invalid G4SK magic: 0x{header.Magic:X8}");

        header.HeaderSize = BinaryPrimitives.ReadUInt16LittleEndian(span.Slice(4, 2));
        header.TypeId = BinaryPrimitives.ReadUInt16LittleEndian(span.Slice(6, 2));
        header.FileSize = BinaryPrimitives.ReadUInt32LittleEndian(span.Slice(12, 4));

        // Offset 0x20 seems to be Bone Count
        header.BoneCount = BinaryPrimitives.ReadUInt16LittleEndian(span.Slice(0x20, 2));

        return header;
    }

    private void ParseBones(ReadOnlySpan<byte> span)
    {
        Bones.Clear();

        // Heuristic: Find parent indices
        // We look for an array of BoneCount shorts where values are between -1 and BoneCount
        int parentIndicesOffset = FindParentIndicesOffset(span, Header.BoneCount);
        if (parentIndicesOffset == -1)
        {
            // Fallback: if not found, assume linear hierarchy or root only?
            // Or throw exception.
            // For now, let's try to find the string table first.
            // If we can't find parents, we can't build hierarchy, but we can list bones.
            Console.WriteLine("Warning: Could not locate parent indices. Hierarchy will be flat.");
        }

        // Heuristic: Find string table
        // It usually follows the data. We'll look for the first string after parent indices.

        int stringTableOffset = -1;
        if (parentIndicesOffset != -1)
        {
            // Start scanning after parent indices
            int startScan = parentIndicesOffset + Header.BoneCount * 2;

            // Align to 4 bytes
            while (startScan % 4 != 0) startScan++;

            // Scan for the first valid string (min length 3)
            for (int i = startScan; i < span.Length - 4; i++)
            {
                if (IsPrintable(span[i]) && IsPrintable(span[i + 1]) && IsPrintable(span[i + 2]))
                {
                    // Check if it looks like a table (multiple strings)
                    // This is a bit expensive but safer
                    if (IsValidStringTable(span, i, 5)) // Check next 5 strings
                    {
                        stringTableOffset = i;
                        break;
                    }
                }
            }
        }

        // Parse Bones
        int currentStringOffset = stringTableOffset;

        for (int i = 0; i < Header.BoneCount; i++)
        {
            var bone = new Bone();
            bone.Index = i;

            // Read Parent Index
            if (parentIndicesOffset != -1)
            {
                int pIdxOffset = parentIndicesOffset + i * 2;
                if (pIdxOffset + 2 <= span.Length)
                    bone.ParentIndex = BinaryPrimitives.ReadInt16LittleEndian(span.Slice(pIdxOffset, 2));
            }
            else
            {
                bone.ParentIndex = -1;
            }

            // Read Name
            if (currentStringOffset != -1 && currentStringOffset < span.Length)
            {
                bone.Name = ReadNullTerminatedString(span, ref currentStringOffset);
            }
            else
            {
                bone.Name = $"Bone_{i}";
            }

            Bones.Add(bone);
        }
    }

    private int FindParentIndicesOffset(ReadOnlySpan<byte> span, int boneCount)
    {
        // Look for a sequence of 'boneCount' shorts
        // Heuristic: 
        // 1. First few values are usually -1 or 0.
        // 2. Values must be < boneCount.
        // 3. Values generally increase (parents are defined before children).

        int arraySize = boneCount * 2;
        // Start scanning after the header area (e.g. 0x1000) to avoid false positives in matrices
        for (int i = 0x1000; i <= span.Length - arraySize; i += 2)
        {
            bool valid = true;
            int zeroCount = 0;
            int negCount = 0;

            for (int j = 0; j < boneCount; j++)
            {
                short val = BinaryPrimitives.ReadInt16LittleEndian(span.Slice(i + j * 2, 2));
                if (val < -1 || val >= boneCount)
                {
                    valid = false;
                    break;
                }
                if (val == 0) zeroCount++;
                if (val == -1) negCount++;
            }

            if (valid)
            {
                // Additional check: check if it looks like the array we found (0,0,0... then increasing)
                // The root bone usually has parent -1.
                // Children of root have parent 0.
                // So we expect at least one -1 or 0.
                if (zeroCount > 0 || negCount > 0)
                {
                    return i;
                }
            }
        }
        return -1;
    }

    private bool IsValidStringTable(ReadOnlySpan<byte> span, int offset, int checkCount)
    {
        int current = offset;
        for (int k = 0; k < checkCount; k++)
        {
            int len = 0;
            while (current + len < span.Length && span[current + len] != 0)
            {
                if (!IsPrintable(span[current + len])) return false;
                len++;
            }

            if (len == 0) return false; // Empty string? Maybe allowed but suspicious for start of table
            if (current + len >= span.Length) return false; // End of file

            current += len + 1; // Skip null
        }
        return true;
    }

    private string ReadNullTerminatedString(ReadOnlySpan<byte> span, ref int offset)
    {
        int end = offset;
        while (end < span.Length && span[end] != 0)
        {
            end++;
        }

        string s = System.Text.Encoding.UTF8.GetString(span.Slice(offset, end - offset));
        offset = end + 1; // Skip null terminator
        return s;
    }

    private bool IsPrintable(byte b)
    {
        return b >= 0x20 && b <= 0x7E;
    }
}
