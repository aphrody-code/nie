// Format: @UTF (Criware Universal Table Format) — lecteur de table complet
// Source: RE des ACB réels + IECODE.Core.Formats.Criware.CriFs (flags/types des colonnes).
// Étend UtfParser (qui ne lit que les métadonnées) avec lecture réelle des
// colonnes et des cellules (row/default storage, types numériques, String, RawData).

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Text;

namespace IECODE.Core.Formats.Criware;

/// <summary>
/// Type d'une colonne @UTF (4 bits de poids faible du flag).
/// </summary>
public enum UtfColumnType : byte
{
    Byte = 0, SByte = 1, UInt16 = 2, Int16 = 3, UInt32 = 4, Int32 = 5,
    UInt64 = 6, Int64 = 7, Single = 8, Double = 9, String = 10, RawData = 11, Guid = 12
}

/// <summary>
/// Référence vers un bloc de données brut (RawData) : offset absolu + taille.
/// </summary>
public readonly record struct UtfBlob(int Offset, int Size);

/// <summary>
/// Lecteur AOT-compatible d'une table @UTF complète (colonnes + lignes).
/// Big-endian. Gère les trois modes de stockage CRI : row, default (constante), absent.
/// </summary>
public sealed class UtfTable
{
    private const byte FlagHasName = 0x10;
    private const byte FlagHasDefault = 0x20;
    private const byte FlagRowStorage = 0x40;

    private readonly byte[] _data;
    private readonly int _rowsOffset;
    private readonly int _stringPoolOffset;
    private readonly int _dataPoolOffset;
    private readonly int _rowSize;
    private readonly Encoding _encoding;

    private readonly struct Column
    {
        public readonly string Name;
        public readonly UtfColumnType Type;
        public readonly byte Flags;
        public readonly int DefaultOffset; // offset absolu de la valeur par défaut (si applicable)
        public Column(string name, UtfColumnType type, byte flags, int defaultOffset)
        { Name = name; Type = type; Flags = flags; DefaultOffset = defaultOffset; }
    }

    private readonly Column[] _columns;

    public int RowCount { get; }
    public int ColumnCount => _columns.Length;
    public IReadOnlyList<string> ColumnNames
    {
        get { var n = new string[_columns.Length]; for (int i = 0; i < n.Length; i++) n[i] = _columns[i].Name; return n; }
    }

    public static bool IsUtf(ReadOnlySpan<byte> data, int offset = 0)
        => data.Length >= offset + 4 && BinaryPrimitives.ReadUInt32BigEndian(data.Slice(offset, 4)) == 0x40555446;

    /// <summary>
    /// Parse une table @UTF présente dans <paramref name="data"/> à partir de <paramref name="baseOffset"/>.
    /// </summary>
    public UtfTable(byte[] data, int baseOffset = 0)
    {
        _data = data;
        var span = data.AsSpan();

        if (BinaryPrimitives.ReadUInt32BigEndian(span.Slice(baseOffset, 4)) != 0x40555446)
            throw new InvalidOperationException($"Magic @UTF invalide à 0x{baseOffset:X}");

        // Offsets relatifs à baseOffset + 8.
        int rel = baseOffset + 8;
        _rowsOffset = BinaryPrimitives.ReadUInt16BigEndian(span.Slice(baseOffset + 0x0A, 2)) + rel;
        _stringPoolOffset = BinaryPrimitives.ReadInt32BigEndian(span.Slice(baseOffset + 0x0C, 4)) + rel;
        _dataPoolOffset = BinaryPrimitives.ReadInt32BigEndian(span.Slice(baseOffset + 0x10, 4)) + rel;

        int columnCount = BinaryPrimitives.ReadUInt16BigEndian(span.Slice(baseOffset + 0x18, 2));
        _rowSize = BinaryPrimitives.ReadUInt16BigEndian(span.Slice(baseOffset + 0x1A, 2));
        RowCount = BinaryPrimitives.ReadInt32BigEndian(span.Slice(baseOffset + 0x1C, 4));

        _encoding = span[baseOffset + 0x09] != 0
            ? Encoding.UTF8
            : (CodePagesEncodingProvider.Instance.GetEncoding(932) ?? Encoding.UTF8);

        _columns = new Column[columnCount];
        int p = baseOffset + 0x20;
        for (int i = 0; i < columnCount; i++)
        {
            byte flag = span[p]; p += 1;
            var type = (UtfColumnType)(flag & 0x0F);
            byte flags = (byte)(flag & 0xF0);
            string name = string.Empty;
            if ((flags & FlagHasName) != 0)
            {
                int nameOff = BinaryPrimitives.ReadInt32BigEndian(span.Slice(p, 4)); p += 4;
                name = ReadString(nameOff);
            }
            int defaultOffset = -1;
            if ((flags & FlagHasDefault) != 0)
            {
                defaultOffset = p;
                p += ValueSize(type);
            }
            _columns[i] = new Column(name, type, flags, defaultOffset);
        }
    }

    private static int ValueSize(UtfColumnType t) => t switch
    {
        UtfColumnType.Byte or UtfColumnType.SByte => 1,
        UtfColumnType.UInt16 or UtfColumnType.Int16 => 2,
        UtfColumnType.UInt32 or UtfColumnType.Int32 or UtfColumnType.Single or UtfColumnType.String => 4,
        UtfColumnType.UInt64 or UtfColumnType.Int64 or UtfColumnType.Double or UtfColumnType.RawData => 8,
        UtfColumnType.Guid => 16,
        _ => 0
    };

    private string ReadString(int offsetInPool)
    {
        int start = _stringPoolOffset + offsetInPool;
        int end = start;
        while (end < _data.Length && _data[end] != 0) end++;
        return _encoding.GetString(_data, start, end - start);
    }

    /// <summary>Index d'une colonne par nom, ou -1.</summary>
    public int IndexOf(string columnName)
    {
        for (int i = 0; i < _columns.Length; i++)
            if (_columns[i].Name == columnName) return i;
        return -1;
    }

    public bool HasColumn(string columnName) => IndexOf(columnName) >= 0;

    /// <summary>Pointeur (offset absolu) de la valeur d'une cellule, ou -1 si absente.</summary>
    private int CellPointer(int row, int columnIndex)
    {
        int rowPtr = _rowsOffset + row * _rowSize;
        for (int c = 0; c < _columns.Length; c++)
        {
            var col = _columns[c];
            // Priorité DEFAULT (0x20) > ROW (0x40), conforme à vgmstream cri_utf.c : une
            // colonne DEFAULT porte une valeur constante (schéma) et ne consomme AUCUN
            // octet par ligne — donc rowPtr n'avance que pour les colonnes ROW.
            if ((col.Flags & FlagHasDefault) != 0)
            {
                if (c == columnIndex) return col.DefaultOffset;
                continue;
            }
            if ((col.Flags & FlagRowStorage) != 0)
            {
                int vp = rowPtr;
                if (c == columnIndex) return vp;
                rowPtr += ValueSize(col.Type);
                continue;
            }
            if (c == columnIndex) return -1; // colonne sans stockage
        }
        return -1;
    }

    private long ReadNumber(int row, int columnIndex)
    {
        int vp = CellPointer(row, columnIndex);
        if (vp < 0) return 0;
        var span = _data.AsSpan();
        return _columns[columnIndex].Type switch
        {
            UtfColumnType.Byte => _data[vp],
            UtfColumnType.SByte => (sbyte)_data[vp],
            UtfColumnType.UInt16 => BinaryPrimitives.ReadUInt16BigEndian(span.Slice(vp, 2)),
            UtfColumnType.Int16 => BinaryPrimitives.ReadInt16BigEndian(span.Slice(vp, 2)),
            UtfColumnType.UInt32 => BinaryPrimitives.ReadUInt32BigEndian(span.Slice(vp, 4)),
            UtfColumnType.Int32 => BinaryPrimitives.ReadInt32BigEndian(span.Slice(vp, 4)),
            UtfColumnType.UInt64 => (long)BinaryPrimitives.ReadUInt64BigEndian(span.Slice(vp, 8)),
            UtfColumnType.Int64 => BinaryPrimitives.ReadInt64BigEndian(span.Slice(vp, 8)),
            _ => 0
        };
    }

    /// <summary>Lit une cellule numérique en long (0 si colonne absente).</summary>
    public long GetLong(int row, string columnName)
    {
        int i = IndexOf(columnName);
        return i < 0 ? 0 : ReadNumber(row, i);
    }

    /// <summary>Lit une cellule numérique en int.</summary>
    public int GetInt(int row, string columnName) => (int)GetLong(row, columnName);

    /// <summary>Lit une cellule String (chaîne du pool).</summary>
    public string GetString(int row, string columnName)
    {
        int i = IndexOf(columnName);
        if (i < 0 || _columns[i].Type != UtfColumnType.String) return string.Empty;
        int vp = CellPointer(row, i);
        if (vp < 0) return string.Empty;
        int off = BinaryPrimitives.ReadInt32BigEndian(_data.AsSpan(vp, 4));
        return ReadString(off);
    }

    /// <summary>Lit une cellule RawData (offset absolu + taille), ou (0,0) si absente.</summary>
    public UtfBlob GetBlob(int row, string columnName)
    {
        int i = IndexOf(columnName);
        if (i < 0 || _columns[i].Type != UtfColumnType.RawData) return default;
        int vp = CellPointer(row, i);
        if (vp < 0) return default;
        var span = _data.AsSpan();
        int off = BinaryPrimitives.ReadInt32BigEndian(span.Slice(vp, 4));
        int size = BinaryPrimitives.ReadInt32BigEndian(span.Slice(vp + 4, 4));
        return new UtfBlob(_dataPoolOffset + off, size);
    }

    /// <summary>Sous-table @UTF imbriquée référencée par une colonne RawData.</summary>
    public UtfTable? GetSubTable(int row, string columnName)
    {
        var blob = GetBlob(row, columnName);
        if (blob.Size <= 4 || !IsUtf(_data, blob.Offset)) return null;
        return new UtfTable(_data, blob.Offset);
    }
}
