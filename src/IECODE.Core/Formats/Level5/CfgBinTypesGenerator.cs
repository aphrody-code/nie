using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace IECODE.Core.Formats.Level5;

// ── Modèle de manifeste ───────────────────────────────────────────────────────

/// <summary>
/// Descripteur d'un champ inféré depuis un cfg.bin.
/// </summary>
public sealed record CfgBinFieldSchema(
    /// <summary>Nom du champ (résolu ou hex).</summary>
    string Name,
    /// <summary>Type sémantique LEVEL-5.</summary>
    CfgBinValueKind Kind,
    /// <summary>Apparaît dans plusieurs records (peut être un tableau TS).</summary>
    bool Repeated,
    /// <summary>Présent dans moins de la moitié des records échantillonnés (peut être optionnel).</summary>
    bool Optional);

/// <summary>
/// Schéma d'une table (RDBN) ou d'un type de record (T2B), inféré sur un échantillon de données.
/// </summary>
public sealed record CfgBinTableSchema(
    /// <summary>Nom de la table ou du record-type racine.</summary>
    string Name,
    /// <summary>Nom du type de ligne (RDBN) ; vide pour T2B.</summary>
    string TypeName,
    /// <summary>Nombre de lignes/records échantillonnés.</summary>
    int SampleCount,
    /// <summary>Champs inférés (ordre stable).</summary>
    IReadOnlyList<CfgBinFieldSchema> Fields);

/// <summary>
/// Manifeste typé d'UN fichier cfg.bin : format (T2B/RDBN), tables, encodage.
/// </summary>
public sealed record CfgBinManifest(
    /// <summary>Nom logique du config (sans chemin ni extension).</summary>
    string Config,
    /// <summary>Nom de fichier source.</summary>
    string SourceFile,
    /// <summary>Format : <c>"T2B"</c> ou <c>"RDBN"</c>.</summary>
    string Format,
    /// <summary>Encodage détecté (T2B) ou <c>"utf-8"</c> (RDBN).</summary>
    string Encoding,
    /// <summary>Tables/types inférés.</summary>
    IReadOnlyList<CfgBinTableSchema> Tables);

// ── Générateur ────────────────────────────────────────────────────────────────

/// <summary>
/// Génère un manifeste typé (<c>.d.ts</c> + <c>.json</c>) par fichier cfg.bin :
/// décode via <see cref="CfgBinDocument"/>, infère le schéma de chaque table/type de record,
/// et émet les fichiers de sortie.
///
/// <para>Robustesse mémoire : <see cref="GC.Collect"/> + écriture incrémentale de
/// <c>index.d.ts</c> / <c>verify.json</c> tous les 32 fichiers, catch exhaustif par fichier.</para>
/// </summary>
public sealed class CfgBinTypesGenerator
{
    // ── Génération d'un seul fichier ─────────────────────────────────────────

    /// <summary>
    /// Génère le manifeste d'un seul fichier <c>.cfg.bin</c>.
    /// </summary>
    [RequiresUnreferencedCode("Uses CfgBinDocument.Decode which calls ReadStruct<T> via BinaryDataReader.")]
    public CfgBinManifest Generate(string cfgBinPath)
    {
        var doc = CfgBinDocument.DecodeFile(cfgBinPath);
        string config = StripConfigName(Path.GetFileName(cfgBinPath));

        var tables = doc.Format == "RDBN"
            ? InferRdbnSchema(doc.Tables)
            : InferT2BSchema(doc.Records);

        return new CfgBinManifest(config, Path.GetFileName(cfgBinPath), doc.Format, doc.Encoding, tables);
    }

    // ── Inférence de schéma T2B ──────────────────────────────────────────────

    private static IReadOnlyList<CfgBinTableSchema> InferT2BSchema(
        IReadOnlyList<CfgBinRecord> roots)
    {
        // T2B : les records racines sont des « types » ; leurs fields + enfants imbriqués
        // forment le schéma. On regroupe les records par nom.
        var byName = new Dictionary<string, List<CfgBinRecord>>(StringComparer.Ordinal);
        CollectT2BByName(roots, byName);

        var result = new List<CfgBinTableSchema>(byName.Count);
        foreach (var (name, records) in byName)
        {
            var fields = InferFieldsFromRecords(records);
            result.Add(new CfgBinTableSchema(name, string.Empty, records.Count, fields));
        }
        return result;
    }

    private static void CollectT2BByName(
        IReadOnlyList<CfgBinRecord> records,
        Dictionary<string, List<CfgBinRecord>> byName)
    {
        foreach (var r in records)
        {
            if (!byName.TryGetValue(r.Name, out var list))
                byName[r.Name] = list = [];
            list.Add(r);
            if (r.Children.Count > 0)
                CollectT2BByName(r.Children, byName);
        }
    }

    // ── Inférence de schéma RDBN ─────────────────────────────────────────────

    private static IReadOnlyList<CfgBinTableSchema> InferRdbnSchema(
        IReadOnlyList<CfgBinTable> tables)
    {
        var result = new List<CfgBinTableSchema>(tables.Count);
        foreach (var t in tables)
        {
            var fields = InferFieldsFromRecords(t.Rows);
            result.Add(new CfgBinTableSchema(t.Name, t.TypeName, t.Rows.Count, fields));
        }
        return result;
    }

    // ── Inférence des champs depuis un échantillon de records ────────────────

    private static IReadOnlyList<CfgBinFieldSchema> InferFieldsFromRecords(
        IReadOnlyList<CfgBinRecord> records)
    {
        if (records.Count == 0) return [];

        // Inférence en UNE passe : kind dominant, fréquence moyenne par record (→ Optional si
        // < 50 % des records) et répétition (→ Repeated si un record a >1 occurrence du champ).
        var kinds         = new Dictionary<string, Dictionary<CfgBinValueKind, int>>(StringComparer.Ordinal);
        var perRecordFreq = new Dictionary<string, double>(StringComparer.Ordinal);
        var repeated      = new HashSet<string>(StringComparer.Ordinal);

        int sample = Math.Min(records.Count, 200);  // max 200 records pour l'inférence
        var localCount = new Dictionary<string, int>(StringComparer.Ordinal);
        for (int i = 0; i < sample; i++)
        {
            localCount.Clear();
            foreach (var f in records[i].Fields)
            {
                if (!kinds.TryGetValue(f.Name, out var kd))
                    kinds[f.Name] = kd = [];
                kd.TryGetValue(f.Kind, out int cnt);
                kd[f.Kind] = cnt + 1;

                localCount.TryGetValue(f.Name, out int lc);
                localCount[f.Name] = lc + 1;
            }
            foreach (var (name, lc) in localCount)
            {
                perRecordFreq.TryGetValue(name, out double existing);
                perRecordFreq[name] = existing + lc;
                if (lc > 1) repeated.Add(name);
            }
        }

        var result = new List<CfgBinFieldSchema>(perRecordFreq.Count);
        foreach (var (name, totalOccurrences) in perRecordFreq)
        {
            double avgPerRecord = totalOccurrences / sample;
            bool optional = avgPerRecord < 0.5;
            bool rep      = repeated.Contains(name);

            CfgBinValueKind dominantKind = CfgBinValueKind.Unknown;
            if (kinds.TryGetValue(name, out var kd))
                dominantKind = kd.MaxBy(kv => kv.Value).Key;

            result.Add(new CfgBinFieldSchema(name, dominantKind, rep, optional));
        }

        return result;
    }

    // ── Bilan de génération ──────────────────────────────────────────────────

    /// <summary>Bilan d'un run <see cref="GenerateAll"/>.</summary>
    public sealed record GenerateSummary(
        int Total, int Decoded, int ParsedOk, int Failed,
        IReadOnlyList<string> Failures);

    // ── GenerateAll ──────────────────────────────────────────────────────────

    /// <summary>
    /// Génère manifestes + <c>.d.ts</c> pour tous les <c>*.cfg.bin</c> d'un dossier (ou un fichier).
    /// </summary>
    /// <param name="input">Fichier <c>.cfg.bin</c> ou dossier.</param>
    /// <param name="outDir">Dossier de sortie (créé si absent).</param>
    /// <param name="onProgress">Callback de progression (optionnel).</param>
    /// <returns>Bilan de vérification.</returns>
    [RequiresUnreferencedCode("Uses CfgBinDocument.Decode which calls ReadStruct<T>.")]
    public GenerateSummary GenerateAll(string input, string outDir, Action<string>? onProgress = null)
    {
        Directory.CreateDirectory(outDir);

        IEnumerable<string> files = Directory.Exists(input)
            ? Directory.EnumerateFiles(input, "*.cfg.bin", SearchOption.AllDirectories).OrderBy(p => p)
            : [input];

        var index    = new List<object>();
        int total    = 0, decoded = 0, parsedOk = 0;
        var failures = new List<string>();

        foreach (var file in files)
        {
            CfgBinManifest manifest;
            try
            {
                manifest = Generate(file);
                parsedOk++;
            }
            catch (Exception ex)
            {
                // Un cfg.bin défaillant (chiffré sans clé, corrompu…) ne doit jamais
                // avorter le run — on le saute et on continue.
                failures.Add(Path.GetFileName(file));
                onProgress?.Invoke($"[skip] {Path.GetFileName(file)} : {ex.Message}");
                total++;
                continue;
            }

            decoded++;
            total++;

            File.WriteAllText(
                Path.Combine(outDir, $"{manifest.Config}.json"),
                ToJson(manifest));
            File.WriteAllText(
                Path.Combine(outDir, $"{manifest.Config}.d.ts"),
                ToDts(manifest));

            index.Add(new
            {
                config  = manifest.Config,
                source  = manifest.SourceFile,
                format  = manifest.Format,
                tables  = manifest.Tables.Count,
                fields  = manifest.Tables.Sum(t => t.Fields.Count),
            });

            onProgress?.Invoke(
                $"[{manifest.Format}] {manifest.Config} : {manifest.Tables.Count} table(s), " +
                $"{manifest.Tables.Sum(t => t.Fields.Count)} champ(s)");

            // Robustesse mémoire : libère les données accumulées et écrit un snapshot
            // périodique de l'index/verify (le bilan survit même si le process est tué).
            if (total % 32 == 0)
            {
                WriteIndexAndVerify(outDir, index, MakeSummary());
                GC.Collect();
                GC.WaitForPendingFinalizers();
            }
        }

        var summary = MakeSummary();
        WriteIndexAndVerify(outDir, index, summary);
        return summary;

        GenerateSummary MakeSummary() => new(total, decoded, parsedOk, failures.Count, failures);
    }

    private static void WriteIndexAndVerify(
        string outDir, IReadOnlyList<object> index, GenerateSummary summary)
    {
        File.WriteAllText(Path.Combine(outDir, "index.json"),   JsonSerializer.Serialize(index,   JsonOpts));
        File.WriteAllText(Path.Combine(outDir, "index.d.ts"),   ToIndexDts(index));
        File.WriteAllText(Path.Combine(outDir, "verify.json"),  JsonSerializer.Serialize(summary, JsonOpts));
    }

    // ── Émission .d.ts ────────────────────────────────────────────────────────

    private static string ToDts(CfgBinManifest m)
    {
        var sb = new StringBuilder();
        sb.AppendLine("// AUTO-GÉNÉRÉ par `iecode cfg types` — NE PAS ÉDITER.");
        sb.AppendLine($"// Config : {m.Config}  (source : {m.SourceFile}, format : {m.Format})");
        sb.AppendLine();

        foreach (var table in m.Tables)
        {
            string ifaceName = Pascal(m.Config) + Pascal(CleanName(table.TypeName.Length > 0 ? table.TypeName : table.Name));
            sb.AppendLine($"/** {table.Name}{(table.TypeName.Length > 0 ? $" ({table.TypeName})" : "")} — {table.SampleCount} entrée(s). */");
            sb.AppendLine($"export interface {ifaceName} {{");

            foreach (var f in table.Fields)
            {
                string tsType = KindToTs(f.Kind);
                string optional = f.Optional ? "?" : "";
                string comment = BuildFieldComment(f);
                if (comment.Length > 0)
                    sb.AppendLine($"  /** {comment} */");
                string arrSuffix = f.Repeated ? "[]" : "";
                sb.AppendLine($"  {TsKey(f.Name)}{optional}: {tsType}{arrSuffix};");
            }

            sb.AppendLine("}");
            sb.AppendLine();
        }

        return sb.ToString();
    }

    private static string ToIndexDts(IReadOnlyList<object> index)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(index, JsonOpts));
        var names = doc.RootElement.EnumerateArray()
            .Select(e => e.GetProperty("config").GetString()!)
            .ToList();

        var sb = new StringBuilder();
        sb.AppendLine("// AUTO-GÉNÉRÉ par `iecode cfg types` — NE PAS ÉDITER.");
        sb.AppendLine("// Union typée de tous les cfg.bin IEVR analysés.");
        sb.AppendLine();
        sb.AppendLine("export type IevrCfgBin =");
        if (names.Count == 0)
            sb.AppendLine("  never;");
        else
            for (int i = 0; i < names.Count; i++)
                sb.AppendLine($"  | \"{names[i]}\"{(i == names.Count - 1 ? ";" : "")}");
        return sb.ToString();
    }

    // ── Helpers TS ────────────────────────────────────────────────────────────

    private static string KindToTs(CfgBinValueKind kind) => kind switch
    {
        CfgBinValueKind.String  => "string",
        CfgBinValueKind.Int     => "number",
        CfgBinValueKind.Short   => "number",
        CfgBinValueKind.Byte    => "number",
        CfgBinValueKind.Float   => "number",
        CfgBinValueKind.Bool    => "boolean",
        CfgBinValueKind.Hash    => "`0x${string}`",
        CfgBinValueKind.Tuple   => "number[]",
        CfgBinValueKind.Blob    => "string",
        _                       => "unknown",
    };

    private static string BuildFieldComment(CfgBinFieldSchema f)
    {
        var parts = new List<string>();
        parts.Add(f.Kind.ToString());
        if (f.Optional) parts.Add("optionnel");
        if (f.Repeated) parts.Add("répété");
        return string.Join(", ", parts);
    }

    private static string TsKey(string name)
        => Regex.IsMatch(name, @"^[A-Za-z_$][A-Za-z0-9_$]*$") ? name : $"\"{name}\"";

    private static string Pascal(string s)
    {
        if (string.IsNullOrEmpty(s)) return "Root";
        var parts = s.Split(['_', '-', '.', ' '], StringSplitOptions.RemoveEmptyEntries);
        return string.Concat(parts.Select(p => char.ToUpperInvariant(p[0]) + p[1..]));
    }

    private static string CleanName(string name)
    {
        // Retire les préfixes m_ / s_ courants en RDBN et les suffixes de listes
        name = Regex.Replace(name, @"^m_|^s_", "");
        name = Regex.Replace(name, @"List$", "");
        return name;
    }

    private static string StripConfigName(string fileName)
    {
        string n = fileName;
        if (n.EndsWith(".cfg.bin", StringComparison.OrdinalIgnoreCase)) n = n[..^8];
        // Retire le suffixe de version éventuel (ex. _1.02.75.00)
        n = Regex.Replace(n, @"[_\-]\d+\.\d+[\.\d]*$", "");
        return n;
    }

    // ── Sérialisation JSON ────────────────────────────────────────────────────

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>Sérialise un manifeste en JSON (camelCase).</summary>
    public static string ToJson(CfgBinManifest m) => JsonSerializer.Serialize(m, JsonOpts);
}
