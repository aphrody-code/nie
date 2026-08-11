using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace IECODE.Core.Formats.Level5.CfgBin.Rdbn;

/// <summary>
/// Lecteur de fichiers RDBN (format Level-5 moderne utilisé dans IEVR).
/// </summary>
public sealed class RdbnReader
{
    public const uint RdbnMagic = 0x4E424452; // "RDBN"
    public const int MinimumSize = 0x50;
    public const int EntrySize = 0x20;

    /// <summary>
    /// Vérifie si les données sont au format RDBN.
    /// </summary>
    public static bool IsRdbn(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4) return false;
        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        return magic == RdbnMagic;
    }

    /// <summary>
    /// Lit un fichier RDBN et retourne les données structurées.
    /// </summary>
    public static RdbnData? Read(ReadOnlySpan<byte> data)
    {
        if (data.Length < MinimumSize)
            return null;

        // Lire le header
        var header = ReadHeader(data);
        if (header.Magic != RdbnMagic)
            return null;

        int dataOffset = header.DataOffset << 2;

        // Lire les entrées racine
        int rootOffset = (header.RootOffset << 2) + dataOffset;
        var rootEntries = ReadRootEntries(data, rootOffset, header.RootCount);

        // Lire les types
        int typeOffset = (header.TypeOffset << 2) + dataOffset;
        var typeEntries = ReadTypeEntries(data, typeOffset, header.TypeCount);

        // Lire les champs
        int fieldOffset = (header.FieldOffset << 2) + dataOffset;
        var fieldEntries = ReadFieldEntries(data, fieldOffset, header.FieldCount);

        // Lire les chaînes
        int hashOffset = (header.StringHashOffset << 2) + dataOffset;
        int offsetsOffset = (header.StringOffsetsOffset << 2) + dataOffset;
        int stringOffset = header.StringOffset + dataOffset;
        var strings = ReadStrings(data, header.HashCount, hashOffset, offsetsOffset, stringOffset);

        // Lire les valeurs
        int valueOffset = (header.ValueOffset << 2) + dataOffset;

        return CreateRdbnData(data, header, valueOffset, stringOffset,
            rootEntries, typeEntries, fieldEntries, strings);
    }

    /// <summary>
    /// Exporte un fichier RDBN vers JSON.
    /// </summary>
    public static string ToJson(ReadOnlySpan<byte> data, bool indented = true)
    {
        var rdbn = Read(data);
        if (rdbn == null)
            throw new InvalidOperationException("Invalid RDBN data");

        var options = new JsonSerializerOptions
        {
            WriteIndented = indented,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        return JsonSerializer.Serialize(rdbn, options);
    }

    #region Private Methods

    private static RdbnHeader ReadHeader(ReadOnlySpan<byte> data)
    {
        return new RdbnHeader
        {
            Magic = BinaryPrimitives.ReadUInt32LittleEndian(data),
            HeaderSize = BinaryPrimitives.ReadInt16LittleEndian(data[4..]),
            Version = BinaryPrimitives.ReadInt32LittleEndian(data[6..]),
            DataOffset = BinaryPrimitives.ReadInt16LittleEndian(data[10..]),
            DataSize = BinaryPrimitives.ReadInt32LittleEndian(data[12..]),
            // Skip padding (0x14 bytes at offset 16)
            TypeOffset = BinaryPrimitives.ReadInt16LittleEndian(data[0x24..]),
            TypeCount = BinaryPrimitives.ReadInt16LittleEndian(data[0x26..]),
            FieldOffset = BinaryPrimitives.ReadInt16LittleEndian(data[0x28..]),
            FieldCount = BinaryPrimitives.ReadInt16LittleEndian(data[0x2A..]),
            RootOffset = BinaryPrimitives.ReadInt16LittleEndian(data[0x2C..]),
            RootCount = BinaryPrimitives.ReadInt16LittleEndian(data[0x2E..]),
            StringHashOffset = BinaryPrimitives.ReadInt16LittleEndian(data[0x30..]),
            StringOffsetsOffset = BinaryPrimitives.ReadInt16LittleEndian(data[0x32..]),
            HashCount = BinaryPrimitives.ReadInt16LittleEndian(data[0x34..]),
            ValueOffset = BinaryPrimitives.ReadInt16LittleEndian(data[0x36..]),
            StringOffset = BinaryPrimitives.ReadInt32LittleEndian(data[0x38..])
        };
    }

    private static RdbnRootEntry[] ReadRootEntries(ReadOnlySpan<byte> data, int offset, int count)
    {
        var entries = new RdbnRootEntry[count];
        for (int i = 0; i < count; i++)
        {
            int pos = offset + i * EntrySize;
            entries[i] = new RdbnRootEntry
            {
                TypeIndex = BinaryPrimitives.ReadInt16LittleEndian(data[pos..]),
                Unk1 = BinaryPrimitives.ReadInt16LittleEndian(data[(pos + 2)..]),
                ValueOffset = BinaryPrimitives.ReadInt32LittleEndian(data[(pos + 4)..]),
                ValueSize = BinaryPrimitives.ReadInt32LittleEndian(data[(pos + 8)..]),
                ValueCount = BinaryPrimitives.ReadInt32LittleEndian(data[(pos + 12)..]),
                NameHash = BinaryPrimitives.ReadUInt32LittleEndian(data[(pos + 16)..])
            };
        }
        return entries;
    }

    private static RdbnTypeEntry[] ReadTypeEntries(ReadOnlySpan<byte> data, int offset, int count)
    {
        var entries = new RdbnTypeEntry[count];
        for (int i = 0; i < count; i++)
        {
            int pos = offset + i * EntrySize;
            entries[i] = new RdbnTypeEntry
            {
                NameHash = BinaryPrimitives.ReadUInt32LittleEndian(data[pos..]),
                UnkHash = BinaryPrimitives.ReadUInt32LittleEndian(data[(pos + 4)..]),
                FieldIndex = BinaryPrimitives.ReadInt16LittleEndian(data[(pos + 8)..]),
                FieldCount = BinaryPrimitives.ReadInt16LittleEndian(data[(pos + 10)..])
            };
        }
        return entries;
    }

    private static RdbnFieldEntry[] ReadFieldEntries(ReadOnlySpan<byte> data, int offset, int count)
    {
        var entries = new RdbnFieldEntry[count];
        for (int i = 0; i < count; i++)
        {
            int pos = offset + i * EntrySize;
            entries[i] = new RdbnFieldEntry
            {
                NameHash = BinaryPrimitives.ReadUInt32LittleEndian(data[pos..]),
                Type = BinaryPrimitives.ReadInt16LittleEndian(data[(pos + 4)..]),
                TypeCategory = BinaryPrimitives.ReadInt16LittleEndian(data[(pos + 6)..]),
                ValueSize = BinaryPrimitives.ReadInt32LittleEndian(data[(pos + 8)..]),
                ValueOffset = BinaryPrimitives.ReadInt32LittleEndian(data[(pos + 12)..]),
                ValueCount = BinaryPrimitives.ReadInt32LittleEndian(data[(pos + 16)..])
            };
        }
        return entries;
    }

    private static Dictionary<uint, string> ReadStrings(ReadOnlySpan<byte> data, int count,
        int hashOffset, int offsetsOffset, int stringOffset)
    {
        var result = new Dictionary<uint, string>();

        for (int i = 0; i < count; i++)
        {
            uint hash = BinaryPrimitives.ReadUInt32LittleEndian(data[(hashOffset + i * 4)..]);
            int strOff = BinaryPrimitives.ReadInt32LittleEndian(data[(offsetsOffset + i * 4)..]);

            int strPos = stringOffset + strOff;
            if (strPos < data.Length)
            {
                string str = ReadNullTerminatedString(data[strPos..]);
                result[hash] = str;
            }
        }

        return result;
    }

    private static string ReadNullTerminatedString(ReadOnlySpan<byte> data)
    {
        int len = 0;
        while (len < data.Length && data[len] != 0)
            len++;
        return Encoding.UTF8.GetString(data[..len]);
    }

    private static RdbnData CreateRdbnData(ReadOnlySpan<byte> data, RdbnHeader header,
        int valueOffset, int stringOffset,
        RdbnRootEntry[] rootEntries, RdbnTypeEntry[] typeEntries,
        RdbnFieldEntry[] fieldEntries, Dictionary<uint, string> strings)
    {
        var result = new RdbnData
        {
            Version = header.Version,
            Lists = new List<RdbnList>()
        };

        foreach (var root in rootEntries)
        {
            if (!strings.TryGetValue(root.NameHash, out var listName))
                listName = $"Unknown_0x{root.NameHash:X8}";

            var type = typeEntries[root.TypeIndex];
            if (!strings.TryGetValue(type.NameHash, out var typeName))
                typeName = $"Type_0x{type.NameHash:X8}";

            var list = new RdbnList
            {
                Name = listName,
                TypeName = typeName,
                Values = new List<Dictionary<string, object>>()
            };

            int rootValueOffset = valueOffset + root.ValueOffset;

            for (int v = 0; v < root.ValueCount; v++)
            {
                var entry = new Dictionary<string, object>();
                int entryOffset = rootValueOffset + v * root.ValueSize;

                for (int f = 0; f < type.FieldCount; f++)
                {
                    var field = fieldEntries[type.FieldIndex + f];
                    if (!strings.TryGetValue(field.NameHash, out var fieldName))
                        fieldName = $"Field_0x{field.NameHash:X8}";

                    int fieldValueOffset = entryOffset + field.ValueOffset;

                    object value = ReadFieldValue(data, fieldValueOffset, field, stringOffset, strings);
                    entry[fieldName] = value;
                }

                list.Values.Add(entry);
            }

            result.Lists.Add(list);
        }

        return result;
    }

    private static object ReadFieldValue(ReadOnlySpan<byte> data, int offset,
        RdbnFieldEntry field, int stringOffset, Dictionary<uint, string> strings)
    {
        if (offset + field.ValueSize > data.Length)
            return "<invalid>";

        var slice = data[offset..];

        return (RdbnFieldType)field.Type switch
        {
            RdbnFieldType.Bool => slice[0] != 0,
            RdbnFieldType.Byte => slice[0],
            RdbnFieldType.Short => BinaryPrimitives.ReadInt16LittleEndian(slice),
            RdbnFieldType.Int => BinaryPrimitives.ReadInt32LittleEndian(slice),
            RdbnFieldType.ActType => BinaryPrimitives.ReadInt16LittleEndian(slice),
            RdbnFieldType.Flag => BinaryPrimitives.ReadInt32LittleEndian(slice),
            RdbnFieldType.Float => BinaryPrimitives.ReadSingleLittleEndian(slice),
            RdbnFieldType.Hash => $"0x{BinaryPrimitives.ReadUInt32LittleEndian(slice):X8}",
            RdbnFieldType.Rates => new float[]
            {
                BinaryPrimitives.ReadSingleLittleEndian(slice),
                BinaryPrimitives.ReadSingleLittleEndian(slice[4..]),
                BinaryPrimitives.ReadSingleLittleEndian(slice[8..]),
                BinaryPrimitives.ReadSingleLittleEndian(slice[12..])
            },
            RdbnFieldType.Position => new float[]
            {
                BinaryPrimitives.ReadSingleLittleEndian(slice),
                BinaryPrimitives.ReadSingleLittleEndian(slice[4..]),
                BinaryPrimitives.ReadSingleLittleEndian(slice[8..]),
                BinaryPrimitives.ReadSingleLittleEndian(slice[12..])
            },
            RdbnFieldType.Condition => ReadConditionValue(data, offset, stringOffset),
            RdbnFieldType.ShortTuple => new short[]
            {
                BinaryPrimitives.ReadInt16LittleEndian(slice),
                BinaryPrimitives.ReadInt16LittleEndian(slice[2..])
            },
            RdbnFieldType.AbilityData or RdbnFieldType.EnhanceData or RdbnFieldType.StatusRate
                => ReadBlobAsHex(slice, field.ValueSize),
            _ => ReadBlobAsHex(slice, field.ValueSize)
        };
    }

    private static object ReadConditionValue(ReadOnlySpan<byte> data, int offset, int stringOffset)
    {
        uint value = BinaryPrimitives.ReadUInt32LittleEndian(data[offset..]);
        int strPos = stringOffset + (int)value;

        if (strPos < data.Length && strPos > 0)
        {
            return ReadNullTerminatedString(data[strPos..]);
        }

        return value;
    }

    private static string ReadBlobAsHex(ReadOnlySpan<byte> data, int size)
    {
        int len = Math.Min(size, data.Length);
        return Convert.ToHexString(data[..len]);
    }

    #endregion
}

#region Data Models

/// <summary>
/// Données RDBN parsées.
/// </summary>
public sealed class RdbnData
{
    public int Version { get; set; }
    public List<RdbnList> Lists { get; set; } = new();
}

/// <summary>
/// Liste/table dans un fichier RDBN.
/// </summary>
public sealed class RdbnList
{
    public string Name { get; set; } = string.Empty;
    public string TypeName { get; set; } = string.Empty;
    public List<Dictionary<string, object>> Values { get; set; } = new();
}

#endregion
