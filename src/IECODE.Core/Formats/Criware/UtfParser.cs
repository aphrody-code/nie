// Auto-généré par Parser Generator
// Format: @UTF (Criware Universal Table Format)
// Source: FUN_14067d2ec + IECODE.Core.Formats.Criware.CriFs

using System;
using System.Buffers.Binary;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace IECODE.Core.Formats.Criware;

/// <summary>
/// Header du format @UTF (Criware Universal Table Format)
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
public readonly struct UtfHeader
{
    public readonly uint Magic;        // 0x40555446 ("@UTF")
    public readonly uint TableSize;    // Taille de la table (big endian)

    public bool IsValid => Magic == 0x40555446; // "@UTF"
}

/// <summary>
/// Métadonnées d'une table UTF (depuis IECODE.Core.Formats.Criware.CriFs)
/// </summary>
public readonly record struct UtfTableMetadata(
    ushort RowsOffset,
    int StringPoolOffset,
    int DataPoolOffset,
    ushort ColumnCount,
    ushort RowSizeBytes,
    int RowCount,
    bool IsUtf8  // true = UTF-8, false = Shift-JIS
);

/// <summary>
/// Parser AOT-compatible pour tables @UTF Criware
/// </summary>
/// <remarks>
/// Le format @UTF est utilisé par le SDK Criware pour stocker des métadonnées
/// sous forme de tables relationnelles. Utilisé dans CPK, ACB, ACF, etc.
/// </remarks>
public static class UtfParser
{
    public const uint MAGIC = 0x40555446; // "@UTF"
    public const int BASE_OFFSET = 0x08;
    public const int COLUMN_OFFSET = 0x20;

    /// <summary>
    /// Parse le header UTF
    /// </summary>
    public static UtfHeader ParseHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < Marshal.SizeOf<UtfHeader>())
            throw new InvalidDataException("Data too small for UTF header");

        ref readonly var header = ref MemoryMarshal.AsRef<UtfHeader>(data);

        if (!header.IsValid)
            throw new InvalidDataException($"Invalid UTF magic: 0x{header.Magic:X8}");

        return header;
    }

    /// <summary>
    /// Parse les métadonnées d'une table UTF
    /// </summary>
    /// <remarks>
    /// Structure basée sur IECODE.Core.Formats.Criware.CriFs.Structs.CriTableMetadata
    /// </remarks>
    public static UtfTableMetadata ParseMetadata(ReadOnlySpan<byte> data)
    {
        var header = ParseHeader(data);

        if (data.Length < COLUMN_OFFSET)
            throw new InvalidDataException("Data too small for UTF metadata");

        // Tous les champs sont big-endian
        ushort rowsOffset = BinaryPrimitives.ReadUInt16BigEndian(data[0x0A..0x0C]);
        int stringPoolOffset = BinaryPrimitives.ReadInt32BigEndian(data[0x0C..0x10]);
        int dataPoolOffset = BinaryPrimitives.ReadInt32BigEndian(data[0x10..0x14]);

        // Métadonnées colonnes/lignes
        ushort columnCount = BinaryPrimitives.ReadUInt16BigEndian(data[0x18..0x1A]);
        ushort rowSizeBytes = BinaryPrimitives.ReadUInt16BigEndian(data[0x1A..0x1C]);
        int rowCount = BinaryPrimitives.ReadInt32BigEndian(data[0x1C..0x20]);

        // Encodage: byte 0x09 = 0 → Shift-JIS, sinon UTF-8
        bool isUtf8 = data[0x09] != 0;

        // Rendre les offsets absolus
        rowsOffset += BASE_OFFSET;
        stringPoolOffset += BASE_OFFSET;
        dataPoolOffset += BASE_OFFSET;

        return new UtfTableMetadata(
            RowsOffset: rowsOffset,
            StringPoolOffset: stringPoolOffset,
            DataPoolOffset: dataPoolOffset,
            ColumnCount: columnCount,
            RowSizeBytes: rowSizeBytes,
            RowCount: rowCount,
            IsUtf8: isUtf8
        );
    }

    /// <summary>
    /// Parse un fichier UTF depuis le disque
    /// </summary>
    public static UtfTableMetadata ParseFile(string path)
    {
        var data = File.ReadAllBytes(path);
        return ParseMetadata(data);
    }

    /// <summary>
    /// Vérifie si les données commencent par un magic @UTF
    /// </summary>
    public static bool IsUtfFile(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4)
            return false;

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        return magic == MAGIC;
    }

    /// <summary>
    /// Obtient l'encoding d'une table UTF
    /// </summary>
    public static Encoding GetEncoding(ReadOnlySpan<byte> data)
    {
        if (data.Length < 10)
            throw new InvalidDataException("Data too small");

        // Byte 0x09: 0 = Shift-JIS (CP932), sinon UTF-8
        return data[0x09] == 0
            ? CodePagesEncodingProvider.Instance.GetEncoding(932) ?? Encoding.UTF8
            : Encoding.UTF8;
    }
}

