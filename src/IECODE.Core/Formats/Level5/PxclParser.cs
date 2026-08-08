using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// Parser pour le format COL (extension .col) — géométrie de collision Level-5.
///
/// Le magic réel n'est PAS "COL" mais "PXCL" (0x5058434C, "Pixel Collision"),
/// suivi d'un en-tête Level-5 standard (headerSize u16 + typeId u16), d'une taille
/// de données, puis d'une table de sections et d'un ou plusieurs sous-blocs
/// (notamment "SEBD" — Scene Body / collision body data) contenant une BVH et
/// des triangles/AABB.
///
/// Structure validée sur s43g001b.col (26988 octets) :
///   0x00  char[4]  magic       "PXCL"
///   0x04  u16      headerSize  0x0030 (48)
///   0x06  u16      typeId      0x0065
///   0x08  u16      reserved0   0x0000
///   0x0A  u16      align       0x000C (12)
///   0x0C  u32      dataSize    0x0000693C (26940) — dataSize + headerSize == fileSize
///   0x10  u8[16]   padding (zéros)
///   0x20  u32      sectionSize  0x00006858 (26712)
///   0x24  u32      sectionOff   0x00000040 (64)
///   ...   sous-blocs ("SEBD", …) : BVH + triangles
///
/// Relation vérifiée : dataSize (0x693C) + headerSize (48) == fileSize (26988).
/// </summary>
public sealed class PxclParser
{
    /// <summary>Magic "PXCL" en little-endian.</summary>
    public const uint MAGIC = 0x4C435850;

    /// <summary>Magic du sous-bloc "SEBD" (collision body).</summary>
    public const uint SEBD_MAGIC = 0x44424553;

    public struct PxclHeader
    {
        public uint Magic;
        public ushort HeaderSize;
        public ushort TypeId;
        public ushort Reserved0;
        public ushort Align;
        public uint DataSize;
        // Champs @0x20/@0x24 : sémantique NON vérifiée sur données réelles (sur ao111.col,
        // Field0x24=16 ne pointe pas le 1er sous-bloc SEBD@0x40, et Field0x20 ne couvre pas
        // la section). Exposés bruts ; la navigation se fait par scan du magic "SEBD".
        public uint Field0x20;
        public uint Field0x24;
    }

    public struct SubBlock
    {
        public string Tag;       // "SEBD", …
        public long Offset;      // position dans le fichier
        public uint Field0;      // premier u32 après le tag
        public uint Field1;      // deuxième u32 après le tag
    }

    public PxclHeader Header { get; private set; }
    public long FileSize { get; private set; }
    public IReadOnlyList<SubBlock> SubBlocks { get; private set; } = Array.Empty<SubBlock>();

    public static bool IsPxcl(ReadOnlySpan<byte> data)
        => data.Length >= 4 && BinaryPrimitives.ReadUInt32LittleEndian(data) == MAGIC;

    public static PxclParser Parse(string filePath)
        => Parse(File.ReadAllBytes(filePath));

    public static PxclParser Parse(ReadOnlySpan<byte> span)
    {
        if (span.Length < 0x28)
            throw new InvalidDataException($"Fichier COL/PXCL trop court : {span.Length} octets");

        if (!IsPxcl(span))
            throw new InvalidDataException(
                $"Magic COL/PXCL invalide : 0x{BinaryPrimitives.ReadUInt32LittleEndian(span):X8} (attendu 0x{MAGIC:X8})");

        var parser = new PxclParser { FileSize = span.Length };

        var header = new PxclHeader
        {
            Magic = BinaryPrimitives.ReadUInt32LittleEndian(span[0..]),
            HeaderSize = BinaryPrimitives.ReadUInt16LittleEndian(span[4..]),
            TypeId = BinaryPrimitives.ReadUInt16LittleEndian(span[6..]),
            Reserved0 = BinaryPrimitives.ReadUInt16LittleEndian(span[8..]),
            Align = BinaryPrimitives.ReadUInt16LittleEndian(span[10..]),
            DataSize = BinaryPrimitives.ReadUInt32LittleEndian(span[12..]),
            Field0x20 = BinaryPrimitives.ReadUInt32LittleEndian(span[0x20..]),
            Field0x24 = BinaryPrimitives.ReadUInt32LittleEndian(span[0x24..]),
        };
        parser.Header = header;

        // Recensement des sous-blocs connus (SEBD) par scan du magic.
        var blocks = new List<SubBlock>();
        for (int i = 0x20; i + 12 <= span.Length; i += 4)
        {
            uint tag = BinaryPrimitives.ReadUInt32LittleEndian(span[i..]);
            if (tag == SEBD_MAGIC)
            {
                blocks.Add(new SubBlock
                {
                    Tag = "SEBD",
                    Offset = i,
                    Field0 = BinaryPrimitives.ReadUInt32LittleEndian(span[(i + 4)..]),
                    Field1 = BinaryPrimitives.ReadUInt32LittleEndian(span[(i + 8)..]),
                });
            }
        }
        parser.SubBlocks = blocks;

        return parser;
    }

    /// <summary>
    /// Vérifie la relation dataSize + headerSize == fileSize (intégrité de l'en-tête).
    /// </summary>
    public bool HeaderConsistent => Header.DataSize + Header.HeaderSize == FileSize;

    public string GetSummary()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"COL (PXCL) collision mesh");
        sb.AppendLine($"  Magic        : PXCL (0x{Header.Magic:X8})");
        sb.AppendLine($"  HeaderSize   : {Header.HeaderSize}");
        sb.AppendLine($"  TypeId       : 0x{Header.TypeId:X4}");
        sb.AppendLine($"  Align        : {Header.Align}");
        sb.AppendLine($"  DataSize     : {Header.DataSize} (0x{Header.DataSize:X})");
        sb.AppendLine($"  Field0x20    : {Header.Field0x20} (0x{Header.Field0x20:X})");
        sb.AppendLine($"  Field0x24    : {Header.Field0x24}");
        sb.AppendLine($"  FileSize     : {FileSize}");
        sb.AppendLine($"  Consistent   : {HeaderConsistent} (dataSize+headerSize==fileSize)");
        sb.AppendLine($"  SubBlocks    : {SubBlocks.Count}");
        foreach (var b in SubBlocks)
            sb.AppendLine($"    {b.Tag} @0x{b.Offset:X}  f0=0x{b.Field0:X8}  f1=0x{b.Field1:X8}");
        return sb.ToString();
    }
}
