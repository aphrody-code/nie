using System.Collections.Concurrent;

namespace IECODE.Core.Dump;

/// <summary>
/// Transforme un dump iecode brut en l'arborescence EXACTE que `inagle push`
/// (createInagleService, DATA_PATH) consomme.
///
/// Contrat inagle (vérifié empiriquement contre packages/inagle/src/core/paths.ts
/// + cfgbin-db.ts + data-loader.ts + le dossier <c>data/</c> du jeu) :
///
///  1. PAS de préfixe `data/`. inagle lit `DATA_ROOT/common/gamedata/...`,
///     `DATA_ROOT/common/text/...` — alors que le dump iecode écrit avec le
///     préfixe `data/` hérité de cpk_list (`data/common/gamedata/...`).
///     → on strip `data/` en tête de chemin.
///
///  2. inagle lit des `.cfg.bin.json` PRÉ-DÉCODÉS (et non les `.cfg.bin` bruts) :
///       - data-loader.loadConfig*  → `{ entries: ConfigNode[] }`      (format T2B)
///       - parsers spécialisés       → `{ version, lists:[{name,typeName,values}] }` (format RDBN)
///     Le décodeur iecode (CfgBinService.ExportToJson) route AUTOMATIQUEMENT
///     T2B→entries / RDBN→lists ; la sortie est byte-identique à la référence
///     du dump de jeu (validé sur chara_exp_table RDBN et chara_param T2B).
///     → pour CHAQUE `<x>.cfg.bin`, on émet le sibling `<x>.cfg.bin.json`.
///
///  3. On conserve aussi le `.cfg.bin` brut à côté (le tree de référence
///     de jeu a les deux ; certains consommateurs iecode/cfgbin-db
///     repartent du binaire). Lossless, jamais de recompression.
///
/// Idempotent : un fichier `.json` déjà présent et plus récent que sa source
/// `.cfg.bin` est sauté (sauf <paramref name="force"/>).
///
/// NOTE : ne couvre PAS all-gamedata/*.json, lua-decompiled/**, images/menu/** :
///  - all-gamedata/{exp_table,growth_tables}.json sont lus par cli-push depuis le
///    package inagle (`packages/inagle/data/all-gamedata/…`), PAS depuis DATA_ROOT,
///    et les builders du service (buildGrowthTableDatabase…) les RE-DÉRIVENT des
///    cfg.bin.json — donc non requis pour un push propre.
///  - lua-decompiled n'est consommé par AUCUN importer de cli-push (déclaré dans
///    paths.ts mais inutilisé).
///  - images/menu (+ menu-maps) ne stockent que des CHEMINS dans la DB (l'API image
///    a un fallback déterministe) → hors du contrat cfg.bin de la donnée.
/// </summary>
public sealed class DataPathExporter
{
    private readonly IEVRGame _game;

    public DataPathExporter(IEVRGame game)
    {
        _game = game;
    }

    public sealed class Options
    {
        /// <summary>
        /// Racine d'entrée : un dump iecode (`iecode dump -o &lt;dir&gt;`), typiquement
        /// `&lt;dir&gt;/data/common/gamedata/...`. Si null, on part de l'install vive (game/data).
        /// </summary>
        public string? InputDir { get; init; }

        /// <summary>Racine DATA_PATH de sortie (ex. /tmp/iecode-data-export).</summary>
        public required string OutputDir { get; init; }

        /// <summary>Ré-écrire les `.json` même s'ils sont à jour.</summary>
        public bool Force { get; init; }

        /// <summary>Copier le `.cfg.bin` brut à côté du `.json` (défaut true, comme dans le dump de jeu).</summary>
        public bool CopyRawCfgBin { get; init; } = true;

        /// <summary>Parallélisme du décodage.</summary>
        public int MaxParallelism { get; init; } = Math.Max(2, Environment.ProcessorCount);

        /// <summary>Callback progression (path relatif décodé).</summary>
        public Action<string>? OnProgress { get; init; }
    }

    public sealed class Result
    {
        public int CfgBinDecoded { get; set; }
        public int CfgBinSkipped { get; set; }
        public int CfgBinFailed { get; set; }
        public int RawCopied { get; set; }
        public int OtherCopied { get; set; }
        public List<string> Failures { get; } = new();
        public string OutputDir { get; set; } = string.Empty;
    }

    /// <summary>
    /// Strip un éventuel segment de tête `data/` (insensible au séparateur) du
    /// chemin relatif interne, pour matcher le layout DATA_ROOT d'inagle.
    /// </summary>
    public static string StripDataPrefix(string relativePath)
    {
        var norm = relativePath.Replace('\\', '/').TrimStart('/');
        if (norm.StartsWith("data/", StringComparison.OrdinalIgnoreCase))
        {
            norm = norm.Substring("data/".Length);
        }
        return norm;
    }

    public async Task<Result> ExecuteAsync(Options options, CancellationToken ct = default)
    {
        string inputRoot = options.InputDir ?? _game.DataPath;
        if (!Directory.Exists(inputRoot))
        {
            throw new DirectoryNotFoundException($"Input dir introuvable : {inputRoot}");
        }
        Directory.CreateDirectory(options.OutputDir);

        var result = new Result { OutputDir = options.OutputDir };

        // On ne traite que les sous-arbres que DATA_PATH expose (common/{gamedata,text}).
        // On découvre la base réelle (avec ou sans préfixe data/) en cherchant `common`.
        var commonRoots = FindCommonRoots(inputRoot);
        if (commonRoots.Count == 0)
        {
            throw new InvalidOperationException(
                $"Aucun dossier `common/` trouvé sous {inputRoot} — est-ce bien un dump iecode ?");
        }

        var files = new List<string>();
        foreach (var common in commonRoots)
        {
            files.AddRange(Directory.EnumerateFiles(common, "*", SearchOption.AllDirectories));
        }

        var cfgBinFiles = new List<string>();
        var looseFiles = new List<string>();
        foreach (var f in files)
        {
            if (f.EndsWith(".cfg.bin.json", StringComparison.OrdinalIgnoreCase))
            {
                // Une référence peut déjà contenir des .json : on les ignore en entrée
                // (on les régénère depuis le .cfg.bin pour garantir l'exactitude).
                continue;
            }
            if (f.EndsWith(".cfg.bin", StringComparison.OrdinalIgnoreCase))
            {
                cfgBinFiles.Add(f);
            }
            else
            {
                looseFiles.Add(f);
            }
        }

        // Copie des fichiers non-cfg.bin (textes loose, .lua, etc.) tels quels (strip data/).
        foreach (var src in looseFiles)
        {
            ct.ThrowIfCancellationRequested();
            string rel = StripDataPrefix(Path.GetRelativePath(inputRoot, src));
            string dst = Path.Combine(options.OutputDir, rel);
            if (CopyIfNeeded(src, dst, options.Force))
            {
                result.OtherCopied++;
            }
        }

        // Décodage parallèle des cfg.bin → .cfg.bin.json (+ copie du brut).
        var failures = new ConcurrentBag<string>();
        int decoded = 0, skipped = 0, failed = 0, rawCopied = 0;

        await Parallel.ForEachAsync(
            cfgBinFiles,
            new ParallelOptions { MaxDegreeOfParallelism = options.MaxParallelism, CancellationToken = ct },
            (src, token) =>
            {
                string rel = StripDataPrefix(Path.GetRelativePath(inputRoot, src));
                string dstBin = Path.Combine(options.OutputDir, rel);
                string dstJson = dstBin + ".json";

                Directory.CreateDirectory(Path.GetDirectoryName(dstJson)!);

                if (options.CopyRawCfgBin && CopyIfNeeded(src, dstBin, options.Force))
                {
                    Interlocked.Increment(ref rawCopied);
                }

                bool jsonFresh =
                    !options.Force
                    && File.Exists(dstJson)
                    && File.GetLastWriteTimeUtc(dstJson) >= File.GetLastWriteTimeUtc(src)
                    && new FileInfo(dstJson).Length > 0;

                if (jsonFresh)
                {
                    Interlocked.Increment(ref skipped);
                    return ValueTask.CompletedTask;
                }

                try
                {
                    // Décodage universel : route T2B→{entries} / RDBN→{version,lists}.
                    _game.CfgBin.ExportToJsonFile(src, dstJson, decrypt: true);
                    Interlocked.Increment(ref decoded);
                    options.OnProgress?.Invoke(rel + ".json");
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref failed);
                    failures.Add($"{rel}: {ex.Message}");
                    // best-effort : on supprime un .json partiel pour rester idempotent.
                    try { if (File.Exists(dstJson)) File.Delete(dstJson); } catch { /* ignore */ }
                }

                return ValueTask.CompletedTask;
            });

        result.CfgBinDecoded = decoded;
        result.CfgBinSkipped = skipped;
        result.CfgBinFailed = failed;
        result.RawCopied = rawCopied;
        result.Failures.AddRange(failures);

        return result;
    }

    /// <summary>
    /// Trouve les dossiers `common` à scanner. Gère :
    ///   &lt;input&gt;/common                 (dump déjà strippé ou install /data)
    ///   &lt;input&gt;/data/common            (dump iecode brut, préfixe data/)
    /// </summary>
    private static List<string> FindCommonRoots(string inputRoot)
    {
        var roots = new List<string>();
        string direct = Path.Combine(inputRoot, "common");
        if (Directory.Exists(direct)) roots.Add(direct);

        string nested = Path.Combine(inputRoot, "data", "common");
        if (Directory.Exists(nested)) roots.Add(nested);

        return roots;
    }

    /// <summary>Copie idempotente (skip si dest à jour). True si copie effectuée.</summary>
    private static bool CopyIfNeeded(string src, string dst, bool force)
    {
        if (!force && File.Exists(dst))
        {
            var s = new FileInfo(src);
            var d = new FileInfo(dst);
            if (d.Length == s.Length && d.LastWriteTimeUtc >= s.LastWriteTimeUtc)
            {
                return false;
            }
        }
        Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
        File.Copy(src, dst, overwrite: true);
        return true;
    }
}
