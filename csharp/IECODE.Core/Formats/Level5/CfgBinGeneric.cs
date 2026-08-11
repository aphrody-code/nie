using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using CfgBinFile = IECODE.Core.Formats.Level5.CfgBin.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Encryption;
using IECODE.Core.Formats.Level5.CfgBin.Logic;
using IECODE.Core.Formats.Level5.CfgBin.Rdbn;
using IECODE.Core.Formats.Level5.CfgBin.Tools;

namespace IECODE.Core.Formats.Level5;

// ── Types du document ─────────────────────────────────────────────────────────

/// <summary>
/// Type d'une valeur dans un nœud de <see cref="CfgBinDocument"/>.
/// </summary>
public enum CfgBinValueKind
{
    /// <summary>Chaîne de caractères UTF-8.</summary>
    String,
    /// <summary>Entier 32 bits signé.</summary>
    Int,
    /// <summary>Flottant 32 bits IEEE 754.</summary>
    Float,
    /// <summary>Hash CRC-32 LEVEL-5 (affiché en hex, ex. <c>0xABCD1234</c>).</summary>
    Hash,
    /// <summary>Booléen (vrai/faux).</summary>
    Bool,
    /// <summary>Entier court 16 bits signé.</summary>
    Short,
    /// <summary>Octet non signé 8 bits.</summary>
    Byte,
    /// <summary>Tuple de flottants (ex. Rates 4×float, Position 4×float, ShortTuple 2×short).</summary>
    Tuple,
    /// <summary>Blob binaire affiché en hexadécimal.</summary>
    Blob,
    /// <summary>Type inconnu / non décodé.</summary>
    Unknown,
}

/// <summary>
/// Nœud feuille d'un <see cref="CfgBinRecord"/> — valeur typée.
/// </summary>
public sealed class CfgBinValue
{
    /// <summary>Nom du champ (résolu depuis le dictionnaire, sinon hex).</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>Type sémantique de la valeur.</summary>
    public CfgBinValueKind Kind { get; init; }

    /// <summary>
    /// Valeur brute : <c>string</c>, <c>int</c>, <c>float</c>, <c>uint</c>, <c>bool</c>,
    /// <c>short</c>, <c>byte</c>, <c>float[]</c>, <c>short[]</c>, <c>string</c> (hex blob).
    /// </summary>
    public object? Value { get; init; }

    /// <inheritdoc/>
    public override string ToString() => Kind switch
    {
        CfgBinValueKind.Hash => $"0x{(uint)(Value ?? 0u):X8}",
        CfgBinValueKind.Float => ((float)(Value ?? 0f)).ToString("G", CultureInfo.InvariantCulture),
        CfgBinValueKind.Tuple when Value is float[] fa =>
            "[" + string.Join(", ", Array.ConvertAll(fa, f => f.ToString("G", CultureInfo.InvariantCulture))) + "]",
        CfgBinValueKind.Tuple when Value is short[] sa =>
            "[" + string.Join(", ", sa) + "]",
        _ => Value?.ToString() ?? "null",
    };
}

/// <summary>
/// Enregistrement (ligne / entrée) dans un <see cref="CfgBinDocument"/>.
/// Un record peut contenir des valeurs nommées <em>et</em> des sous-records enfants
/// (format T2B uniquement — en RDBN, les records sont plats).
/// </summary>
public sealed class CfgBinRecord
{
    /// <summary>Nom du record (résolu depuis la table de clés, sinon hex).</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>Champs de ce record.</summary>
    public IReadOnlyList<CfgBinValue> Fields { get; init; } = Array.Empty<CfgBinValue>();

    /// <summary>Records enfants (hiérarchie T2B ; vide pour RDBN).</summary>
    public IReadOnlyList<CfgBinRecord> Children { get; init; } = Array.Empty<CfgBinRecord>();
}

/// <summary>
/// Table de records homotypée dans un document RDBN.
/// </summary>
public sealed class CfgBinTable
{
    /// <summary>Nom de la liste (ex. <c>m_EventMovieInfoList</c>).</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>Nom du type de ligne (ex. <c>EVENT_MOVIE_INFO</c>).</summary>
    public string TypeName { get; init; } = string.Empty;

    /// <summary>Lignes de la table.</summary>
    public IReadOnlyList<CfgBinRecord> Rows { get; init; } = Array.Empty<CfgBinRecord>();
}

/// <summary>
/// Document cfg.bin générique — arbre typé unifié, compatible T2B et RDBN.
///
/// API principale :
/// <list type="bullet">
///   <item><see cref="CfgBinDocument.Decode(byte[], string?)"/> — point d'entrée.</item>
///   <item><see cref="ToJson(bool)"/> — sérialisation JSON.</item>
///   <item><see cref="Format"/> — format détecté (<c>"T2B"</c> / <c>"RDBN"</c>).</item>
///   <item><see cref="Records"/> — racines (T2B) ou <see cref="Tables"/> (RDBN).</item>
/// </list>
/// </summary>
public sealed class CfgBinDocument
{
    /// <summary>Format source : <c>"T2B"</c> ou <c>"RDBN"</c>.</summary>
    public string Format { get; init; } = string.Empty;

    /// <summary>Encodage de chaîne détecté (T2B uniquement ; UTF-8 pour RDBN).</summary>
    public string Encoding { get; init; } = "utf-8";

    /// <summary>
    /// Records racines du document T2B.
    /// Vide pour les documents RDBN (utiliser <see cref="Tables"/>).
    /// </summary>
    public IReadOnlyList<CfgBinRecord> Records { get; init; } = Array.Empty<CfgBinRecord>();

    /// <summary>
    /// Tables RDBN (listes homotypées).
    /// Vide pour les documents T2B (utiliser <see cref="Records"/>).
    /// </summary>
    public IReadOnlyList<CfgBinTable> Tables { get; init; } = Array.Empty<CfgBinTable>();

    // ── Point d'entrée ────────────────────────────────────────────────────────

    /// <summary>
    /// Décode un fichier cfg.bin (T2B ou RDBN) en arbre typé générique.
    ///
    /// <para>Le format est détecté automatiquement. Si le fichier est chiffré,
    /// le déchiffrement est tenté via <see cref="CriwareCrypt"/> avec
    /// <paramref name="fileNameKey"/> comme clé (nom du fichier).</para>
    ///
    /// <para>Les clés CRC-32 sont résolues via la table de clés embarquée dans le
    /// fichier (toujours présente). Un <paramref name="hashDictionary"/> externe
    /// (optionnel) permet de résoudre les hashes RDBN qui n'ont pas de table de
    /// clés en clair.</para>
    /// </summary>
    /// <param name="data">Octets bruts du fichier (chiffré ou non).</param>
    /// <param name="fileNameKey">
    /// Nom du fichier, utilisé comme clé de déchiffrement si le fichier est
    /// chiffré (ex. <c>"cpk_list.cfg.bin"</c>). <c>null</c> désactive le
    /// déchiffrement automatique.
    /// </param>
    /// <param name="hashDictionary">
    /// Dictionnaire hash→nom optionnel pour la résolution RDBN.
    /// </param>
    /// <exception cref="InvalidDataException">
    /// Le fichier n'est ni T2B ni RDBN même après tentative de déchiffrement.
    /// </exception>
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode(
        "Uses CfgBin.Open which calls ReadStruct<T> via BinaryDataReader.")]
    public static CfgBinDocument Decode(
        byte[] data,
        string? fileNameKey = null,
        IReadOnlyDictionary<uint, string>? hashDictionary = null)
    {
        // ── Déchiffrement optionnel ───────────────────────────────────────────
        if (fileNameKey is not null
            && !CfgBinFile.HasValidFooter(data)
            && !RdbnReader.IsRdbn(data))
        {
            data = CriwareCrypt.Decrypt(data, fileNameKey!);
        }

        // ── Détection du format ───────────────────────────────────────────────
        if (RdbnReader.IsRdbn(data))
            return DecodeRdbn(data, hashDictionary);

        if (CfgBinFile.HasValidFooter(data))
            return DecodeT2B(data);

        throw new InvalidDataException(
            "Format cfg.bin non reconnu : ni T2B (footer 01 74 32 62) ni RDBN (magic 0x4E424452).");
    }

    /// <summary>
    /// Décode un fichier depuis le système de fichiers.
    /// </summary>
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode(
        "Uses Decode which calls ReadStruct<T> via BinaryDataReader.")]
    public static CfgBinDocument DecodeFile(
        string filePath,
        IReadOnlyDictionary<uint, string>? hashDictionary = null)
    {
        var data = File.ReadAllBytes(filePath);
        return Decode(data, Path.GetFileName(filePath), hashDictionary);
    }

    // ── Sérialisation JSON ────────────────────────────────────────────────────

    /// <summary>
    /// Sérialise le document en JSON.
    /// Produit un objet avec les champs <c>format</c>, <c>encoding</c> et
    /// (selon le format) soit <c>records</c> soit <c>tables</c>.
    /// </summary>
    public string ToJson(bool indented = true)
    {
        using var ms = new MemoryStream();
        var opts = new JsonWriterOptions
        {
            Indented = indented,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            MaxDepth = int.MaxValue,
        };
        using var w = new Utf8JsonWriter(ms, opts);

        w.WriteStartObject();
        w.WriteString("format", Format);
        w.WriteString("encoding", Encoding);

        if (Format == "RDBN")
        {
            w.WritePropertyName("tables");
            w.WriteStartArray();
            foreach (var table in Tables)
                WriteTable(w, table);
            w.WriteEndArray();
        }
        else
        {
            w.WritePropertyName("records");
            w.WriteStartArray();
            foreach (var record in Records)
                WriteRecord(w, record);
            w.WriteEndArray();
        }

        w.WriteEndObject();
        w.Flush();
        return System.Text.Encoding.UTF8.GetString(ms.ToArray());
    }

    // ── Décodage T2B ─────────────────────────────────────────────────────────

    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode(
        "Uses CfgBin.Open which calls ReadStruct<T> via BinaryDataReader.")]
    private static CfgBinDocument DecodeT2B(byte[] data)
    {
        var cfgBin = new CfgBinFile();
        cfgBin.Open(data);

        var records = new List<CfgBinRecord>(cfgBin.Entries.Count);
        foreach (var entry in cfgBin.Entries)
            records.Add(ConvertEntry(entry));

        return new CfgBinDocument
        {
            Format = "T2B",
            Encoding = cfgBin.Encoding.WebName,
            Records = records,
        };
    }

    private static CfgBinRecord ConvertEntry(Entry entry)
    {
        var fields = new List<CfgBinValue>(entry.Variables.Count);
        for (int i = 0; i < entry.Variables.Count; i++)
        {
            var v = entry.Variables[i];
            fields.Add(new CfgBinValue
            {
                Name = v.Name ?? $"#{i}",
                Kind = v.Type switch
                {
                    VariableType.String  => CfgBinValueKind.String,
                    VariableType.Int     => CfgBinValueKind.Int,
                    VariableType.Float   => CfgBinValueKind.Float,
                    _                    => CfgBinValueKind.Unknown,
                },
                Value = v.Value,
            });
        }

        var children = new List<CfgBinRecord>(entry.Children.Count);
        foreach (var child in entry.Children)
            children.Add(ConvertEntry(child));

        return new CfgBinRecord
        {
            Name     = entry.Name,
            Fields   = fields,
            Children = children,
        };
    }

    // ── Décodage RDBN ─────────────────────────────────────────────────────────

    private static CfgBinDocument DecodeRdbn(
        byte[] data,
        IReadOnlyDictionary<uint, string>? extraDict)
    {
        var rdbn = RdbnReader.Read(data);
        if (rdbn is null)
            throw new InvalidDataException("Échec du décodage RDBN : données invalides.");

        var tables = new List<CfgBinTable>(rdbn.Lists.Count);

        foreach (var list in rdbn.Lists)
        {
            var rows = new List<CfgBinRecord>(list.Values.Count);
            foreach (var valueDict in list.Values)
            {
                var fields = new List<CfgBinValue>(valueDict.Count);
                foreach (var (k, v) in valueDict)
                {
                    var (kind, resolved) = ClassifyRdbnValue(k, v, extraDict);
                    fields.Add(new CfgBinValue
                    {
                        Name  = k,
                        Kind  = kind,
                        Value = resolved,
                    });
                }

                rows.Add(new CfgBinRecord
                {
                    Name   = list.TypeName,
                    Fields = fields,
                });
            }

            tables.Add(new CfgBinTable
            {
                Name     = list.Name,
                TypeName = list.TypeName,
                Rows     = rows,
            });
        }

        return new CfgBinDocument
        {
            Format   = "RDBN",
            Encoding = "utf-8",
            Tables   = tables,
        };
    }

    /// <summary>
    /// Classifie une valeur RDBN (qui vient du <see cref="RdbnReader"/> sous forme
    /// d'<c>object</c>) en un <see cref="CfgBinValueKind"/> et une valeur canonique.
    /// </summary>
    private static (CfgBinValueKind Kind, object? Value) ClassifyRdbnValue(
        string fieldName,
        object? raw,
        IReadOnlyDictionary<uint, string>? dict)
    {
        return raw switch
        {
            bool b     => (CfgBinValueKind.Bool, b),
            byte by    => (CfgBinValueKind.Byte, by),
            short s    => (CfgBinValueKind.Short, s),
            int i      => (CfgBinValueKind.Int, i),
            float f    => (CfgBinValueKind.Float, f),
            float[] fa => (CfgBinValueKind.Tuple, fa),
            short[] sa => (CfgBinValueKind.Tuple, sa),

            // Le RdbnReader encode les Hash comme "0xXXXXXXXX"
            string s when s.StartsWith("0x", StringComparison.OrdinalIgnoreCase) =>
                ResolveHashString(s, dict),

            string s   => (CfgBinValueKind.String, s),
            _          => (CfgBinValueKind.Unknown, raw),
        };
    }

    private static (CfgBinValueKind, object?) ResolveHashString(
        string hexStr, IReadOnlyDictionary<uint, string>? dict)
    {
        if (uint.TryParse(hexStr.AsSpan(2), System.Globalization.NumberStyles.HexNumber, null, out uint h))
        {
            // Tente la résolution via le dictionnaire externe
            if (dict is not null && dict.TryGetValue(h, out var name))
                return (CfgBinValueKind.String, name);

            return (CfgBinValueKind.Hash, h);
        }
        return (CfgBinValueKind.String, hexStr);
    }

    // ── Sérialisation JSON (helpers) ──────────────────────────────────────────

    private static void WriteTable(Utf8JsonWriter w, CfgBinTable table)
    {
        w.WriteStartObject();
        w.WriteString("name",     table.Name);
        w.WriteString("typeName", table.TypeName);
        w.WritePropertyName("rows");
        w.WriteStartArray();
        foreach (var row in table.Rows)
            WriteRecordFlat(w, row);
        w.WriteEndArray();
        w.WriteEndObject();
    }

    /// <summary>Record plat (RDBN) : un objet JSON dont les clés sont les champs.</summary>
    private static void WriteRecordFlat(Utf8JsonWriter w, CfgBinRecord record)
    {
        w.WriteStartObject();
        foreach (var f in record.Fields)
            WriteValueProperty(w, f);
        w.WriteEndObject();
    }

    /// <summary>Record arborescent (T2B) : conserve la structure name/fields/children.</summary>
    private static void WriteRecord(Utf8JsonWriter w, CfgBinRecord record)
    {
        w.WriteStartObject();
        w.WriteString("name", record.Name);

        if (record.Fields.Count > 0)
        {
            w.WritePropertyName("fields");
            w.WriteStartArray();
            foreach (var f in record.Fields)
            {
                w.WriteStartObject();
                w.WriteString("name", f.Name);
                w.WriteString("kind", f.Kind.ToString());
                WriteValueProperty(w, f, "value");
                w.WriteEndObject();
            }
            w.WriteEndArray();
        }

        if (record.Children.Count > 0)
        {
            w.WritePropertyName("children");
            w.WriteStartArray();
            foreach (var child in record.Children)
                WriteRecord(w, child);
            w.WriteEndArray();
        }

        w.WriteEndObject();
    }

    /// <summary>
    /// Écrit la valeur d'un champ comme propriété JSON nommée <paramref name="propName"/>
    /// (ou directement en objet plat si <paramref name="propName"/> est <c>null</c>).
    /// </summary>
    private static void WriteValueProperty(Utf8JsonWriter w, CfgBinValue field, string? propName = null)
    {
        string pn = propName ?? field.Name;

        switch (field.Kind)
        {
            case CfgBinValueKind.String:
                w.WriteString(pn, field.Value as string ?? string.Empty);
                break;

            case CfgBinValueKind.Int:
                w.WriteNumber(pn, Convert.ToInt64(field.Value));
                break;

            case CfgBinValueKind.Short:
                w.WriteNumber(pn, Convert.ToInt32(field.Value));
                break;

            case CfgBinValueKind.Byte:
                w.WriteNumber(pn, Convert.ToInt32(field.Value));
                break;

            case CfgBinValueKind.Float:
                var fv = Convert.ToSingle(field.Value);
                if (float.IsNaN(fv) || float.IsInfinity(fv))
                    w.WriteString(pn, fv.ToString(CultureInfo.InvariantCulture));
                else
                    w.WriteNumber(pn, fv);
                break;

            case CfgBinValueKind.Bool:
                w.WriteBoolean(pn, Convert.ToBoolean(field.Value));
                break;

            case CfgBinValueKind.Hash:
                w.WriteString(pn, $"0x{(uint)(field.Value ?? 0u):X8}");
                break;

            case CfgBinValueKind.Tuple when field.Value is float[] fa:
                w.WritePropertyName(pn);
                w.WriteStartArray();
                foreach (var f in fa) w.WriteNumberValue(f);
                w.WriteEndArray();
                break;

            case CfgBinValueKind.Tuple when field.Value is short[] sa:
                w.WritePropertyName(pn);
                w.WriteStartArray();
                foreach (var s in sa) w.WriteNumberValue(s);
                w.WriteEndArray();
                break;

            default:
                w.WriteString(pn, field.Value?.ToString() ?? "null");
                break;
        }
    }
}
