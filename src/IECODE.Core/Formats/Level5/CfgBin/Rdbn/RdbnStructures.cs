using System.Runtime.InteropServices;

namespace IECODE.Core.Formats.Level5.CfgBin.Rdbn;

/// <summary>
/// En-tête d'un fichier RDBN (format IEVR/Level-5 moderne).
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct RdbnHeader
{
    public uint Magic;           // 0x4E424452 "RDBN"
    public short HeaderSize;     // Usually 0x50 (80)
    public int Version;          // Usually 0x64 (100)
    public short DataOffset;     // Offset >> 2
    public int DataSize;

    // Padding: 0x14 bytes
    public long Padding1;
    public long Padding2;
    public int Padding3;

    public short TypeOffset;
    public short TypeCount;
    public short FieldOffset;
    public short FieldCount;
    public short RootOffset;
    public short RootCount;
    public short StringHashOffset;
    public short StringOffsetsOffset;
    public short HashCount;
    public short ValueOffset;
    public int StringOffset;
}

/// <summary>
/// Entrée de type dans RDBN.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct RdbnTypeEntry
{
    public uint NameHash;
    public uint UnkHash;
    public short FieldIndex;
    public short FieldCount;
    // Padding: 0x14 bytes
}

/// <summary>
/// Entrée de champ dans RDBN.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct RdbnFieldEntry
{
    public uint NameHash;
    public short Type;
    public short TypeCategory;
    public int ValueSize;
    public int ValueOffset;
    public int ValueCount;
    // Padding: 0x0C bytes
}

/// <summary>
/// Entrée racine/liste dans RDBN.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public struct RdbnRootEntry
{
    public short TypeIndex;
    public short Unk1;
    public int ValueOffset;
    public int ValueSize;
    public int ValueCount;
    public uint NameHash;
    // Padding: 0x0C bytes
}

/// <summary>
/// Types de champs RDBN.
/// </summary>
public enum RdbnFieldType : short
{
    AbilityData = 0,
    EnhanceData = 1,
    StatusRate = 2,
    Bool = 3,
    Byte = 4,
    Short = 5,
    Int = 6,
    ActType = 9,
    Flag = 10,
    Float = 0xD,
    Hash = 0xF,
    Rates = 0x12,
    Position = 0x13,
    Condition = 0x14,
    ShortTuple = 0x15
}
