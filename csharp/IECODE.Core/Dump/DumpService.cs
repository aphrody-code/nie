using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using System.Threading.Channels;
using IECODE.Core.Config;
using IECODE.Core.Serialization;

namespace IECODE.Core.Dump;

/// <summary>
/// Service de dump haute performance pour IEVR.
/// Gère l'extraction parallélisée de tous les CPK avec déduplication et reprise.
/// </summary>
public sealed class DumpService
{
    private readonly IEVRGame _game;

    /// <summary>
    /// Facteur de majoration compressé→décompressé pour le fallback d'estimation disque
    /// (quand on ne dispose PAS de cpk_list pour lire les tailles décompressées exactes).
    /// Les CPK IEVR contiennent surtout des assets déjà compressés (textures G4TX, audio),
    /// d'où un gonflement modéré ; on majore pour pécher par excès de prudence.
    /// </summary>
    private const double CpkExpansionFactor = 1.6;

    /// <summary>Intervalle de re-vérification de l'espace libre pendant l'extraction.</summary>
    private static readonly TimeSpan SpaceRecheckInterval = TimeSpan.FromSeconds(5);

    /// <summary>Taille de bloc FS supposée pour l'arrondi de l'empreinte disque (4 Kio).</summary>
    private const long FsBlockBytes = 4096;

    /// <summary>Arrondit une taille de fichier au bloc FS supérieur (≥ 1 bloc).</summary>
    private static long RoundUpToBlock(long bytes)
    {
        if (bytes <= 0) return FsBlockBytes;
        return ((bytes + FsBlockBytes - 1) / FsBlockBytes) * FsBlockBytes;
    }

    public DumpService(IEVRGame game)
    {
        _game = game;
    }

    /// <summary>
    /// Exécute un dump complet du jeu avec toutes les optimisations.
    /// </summary>
    public async Task<DumpResult> ExecuteAsync(DumpOptions options, CancellationToken ct = default)
    {
        var result = new DumpResult
        {
            StartTime = DateTime.UtcNow,
            OutputPath = options.OutputPath
        };

        var stopwatch = Stopwatch.StartNew();

        try
        {
            // 1. Charger ou créer le manifest
            var manifest = await LoadOrCreateManifestAsync(options, ct);
            result.IsResume = manifest.ExtractedFiles.Count > 0;

            // 2. Construire la liste des fichiers à extraire
            var extractionPlan = await BuildExtractionPlanAsync(options, manifest, ct);
            result.TotalFiles = extractionPlan.TotalFiles;
            result.TotalCpks = extractionPlan.CpkPlans.Count;
            result.SkippedFiles = extractionPlan.SkippedFiles;
            result.EstimatedBytes = extractionPlan.EstimatedExtractBytes;

            options.OnProgress?.Invoke(new DumpProgress
            {
                Phase = DumpPhase.Planning,
                Message = $"Plan: {result.TotalFiles:N0} fichiers dans {result.TotalCpks} CPKs ({result.SkippedFiles:N0} déjà extraits)"
            });

            // 2b. Garde-fou disque : le dump DÉCOMPRESSE → la sortie peut dépasser de loin
            // les CPK compressés. On compare la somme estimée des tailles décompressées à
            // l'espace réellement libre de la partition de sortie (moins une réserve), et on
            // refuse AVANT d'écrire quoi que ce soit si ça ne tient pas (sauf override).
            if (!CheckDiskBudget(options, extractionPlan, result, ct))
            {
                return result; // result.Error déjà rempli
            }

            // 3. Exécuter l'extraction parallélisée
            await ExecuteExtractionAsync(extractionPlan, manifest, options, result, ct);

            // 4. Copier les loose files
            if (options.IncludeLooseFiles)
            {
                await CopyLooseFilesAsync(options, manifest, result, ct);
            }

            // 5. Sauvegarder le manifest final
            await SaveManifestAsync(manifest, options.OutputPath, ct);

            result.Success = true;
        }
        catch (OperationCanceledException)
        {
            result.WasCancelled = true;
            options.OnProgress?.Invoke(new DumpProgress
            {
                Phase = DumpPhase.Cancelled,
                Message = "Dump annulé par l'utilisateur"
            });
        }
        catch (Exception ex)
        {
            result.Error = ex.Message;
            options.OnProgress?.Invoke(new DumpProgress
            {
                Phase = DumpPhase.Error,
                Message = $"Erreur: {ex.Message}"
            });
        }

        stopwatch.Stop();
        result.Duration = stopwatch.Elapsed;
        result.EndTime = DateTime.UtcNow;

        return result;
    }

    /// <summary>
    /// Charge un manifest existant ou en crée un nouveau.
    /// </summary>
    private async Task<DumpManifest> LoadOrCreateManifestAsync(DumpOptions options, CancellationToken ct)
    {
        string manifestPath = Path.Combine(options.OutputPath, ".iecode-manifest.json");

        if (options.SmartDump && File.Exists(manifestPath))
        {
            try
            {
                string json = await File.ReadAllTextAsync(manifestPath, ct);
                var manifest = JsonSerializer.Deserialize(json, (JsonTypeInfo<DumpManifest>)AppJsonContext.Options.GetTypeInfo(typeof(DumpManifest)));
                if (manifest != null)
                {
                    options.OnProgress?.Invoke(new DumpProgress
                    {
                        Phase = DumpPhase.Loading,
                        Message = $"Manifest chargé: {manifest.ExtractedFiles.Count:N0} fichiers déjà extraits"
                    });
                    return manifest;
                }
            }
            catch
            {
                // Manifest corrompu, on repart de zéro
            }
        }

        return new DumpManifest
        {
            GamePath = _game.GamePath,
            CreatedAt = DateTime.UtcNow
        };
    }

    /// <summary>
    /// Construit le plan d'extraction basé sur cpk_list.cfg.bin.
    /// </summary>
    private async Task<ExtractionPlan> BuildExtractionPlanAsync(
        DumpOptions options,
        DumpManifest manifest,
        CancellationToken ct)
    {
        await Task.CompletedTask; // Pour async
        var plan = new ExtractionPlan();

        options.OnProgress?.Invoke(new DumpProgress
        {
            Phase = DumpPhase.Planning,
            Message = "Lecture de cpk_list.cfg.bin..."
        });

        // Utiliser cpk_list pour construire le plan d'extraction
        CpkListData? cpkList = null;
        if (options.UseCpkList && File.Exists(_game.CpkListPath))
        {
            try
            {
                cpkList = _game.CfgBin.ReadCpkList();
                options.OnProgress?.Invoke(new DumpProgress
                {
                    Phase = DumpPhase.Planning,
                    Message = $"cpk_list chargé: {cpkList.Files.Count:N0} entrées"
                });
            }
            catch (Exception ex)
            {
                options.OnProgress?.Invoke(new DumpProgress
                {
                    Phase = DumpPhase.Planning,
                    Message = $"Erreur cpk_list: {ex.Message}, fallback enumération CPK"
                });
            }
        }

        // Si cpk_list est disponible, l'utiliser pour construire le plan
        if (cpkList != null)
        {
            return BuildPlanFromCpkList(cpkList, options, manifest, plan);
        }

        // Fallback: énumérer les CPK directement
        return BuildPlanFromCpkEnumeration(options, manifest, plan, ct);
    }

    /// <summary>Ensemble de filtres : globs d'inclusion + d'exclusion (préfixe `!`).</summary>
    private sealed record FilterSet(
        System.Text.RegularExpressions.Regex[] Include,
        System.Text.RegularExpressions.Regex[] Exclude)
    {
        public bool IsEmpty => Include.Length == 0 && Exclude.Length == 0;
    }

    /// <summary>Parse un filtre (globs séparés par des virgules ; `!glob` = exclusion). Vide = tout.</summary>
    private static FilterSet ParseFilter(string? filter)
    {
        if (string.IsNullOrWhiteSpace(filter)) return new FilterSet([], []);
        var include = new List<System.Text.RegularExpressions.Regex>();
        var exclude = new List<System.Text.RegularExpressions.Regex>();
        foreach (var raw in filter.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (raw.StartsWith('!')) exclude.Add(GlobToRegex(raw[1..]));
            else include.Add(GlobToRegex(raw));
        }
        return new FilterSet([.. include], [.. exclude]);
    }

    /// <summary>Convertit un glob (`*` = segment, `**` = récursif, `?`) en regex ancrée, sur chemin `/`.</summary>
    private static System.Text.RegularExpressions.Regex GlobToRegex(string glob)
    {
        var sb = new System.Text.StringBuilder("^");
        for (int i = 0; i < glob.Length; i++)
        {
            char c = glob[i];
            if (c == '*')
            {
                if (i + 1 < glob.Length && glob[i + 1] == '*') { sb.Append(".*"); i++; }
                else sb.Append("[^/]*");
            }
            else if (c == '?') sb.Append("[^/]");
            else sb.Append(System.Text.RegularExpressions.Regex.Escape(c.ToString()));
        }
        sb.Append('$');
        return new System.Text.RegularExpressions.Regex(
            sb.ToString(),
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Compiled);
    }

    /// <summary>Vrai si le chemin est retenu : aucune exclusion, et (aucune inclusion ⇒ tout, sinon match).</summary>
    private static bool MatchesFilter(string fullPath, FilterSet filter)
    {
        if (filter.IsEmpty) return true;
        string normalized = fullPath.Replace('\\', '/');
        foreach (var e in filter.Exclude)
        {
            if (e.IsMatch(normalized)) return false;
        }
        if (filter.Include.Length == 0) return true;
        foreach (var i in filter.Include)
        {
            if (i.IsMatch(normalized)) return true;
        }
        return false;
    }

    /// <summary>
    /// Construit le plan à partir de cpk_list.cfg.bin (plus rapide et plus fiable).
    /// Trie les CPKs par taille (plus petits d'abord).
    /// </summary>
    private ExtractionPlan BuildPlanFromCpkList(
        CpkListData cpkList,
        DumpOptions options,
        DumpManifest manifest,
        ExtractionPlan plan)
    {
        // Filtre (globs ; `!` = exclusion) sur le chemin interne : ne garde que les
        // fichiers nécessaires → les CPK sans match sont ignorés (dump des seuls packs utiles).
        var filter = ParseFilter(options.FileFilter);

        // Grouper par CPK, en DÉDUPLIQUANT par chemin : un même FullPath peut exister dans
        // plusieurs CPK (base + patch) ; on ne garde que la dernière occurrence (override),
        // évitant d'extraire/charger les doublons inutilement.
        var filesByCpk = cpkList.Files
            .Where(f => !f.IsLoose && MatchesFilter(f.FullPath, filter))
            .GroupBy(f => f.FullPath.Replace('\\', '/'), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.Last())
            .GroupBy(f => f.CpkName)
            .Select(g => new { CpkName = g.Key, Files = g.ToList() })
            .ToList();

        // Créer la liste des CPKs avec leur taille pour le tri
        var cpkPlans = new List<CpkExtractionPlan>();

        // Copier les CPKs complétés pour éviter la modification pendant l'itération
        var completedCpks = new HashSet<string>(manifest.CompletedCpks, StringComparer.OrdinalIgnoreCase);
        var extractedFiles = new Dictionary<string, ExtractedFileInfo>(manifest.ExtractedFiles, StringComparer.OrdinalIgnoreCase);

        foreach (var cpkGroup in filesByCpk)
        {
            string cpkName = cpkGroup.CpkName;
            var files = cpkGroup.Files;

            // Utiliser le PacksPath personnalisé si fourni
            string packsPath = options.PacksPath ?? _game.PacksPath;
            string cpkPath = Path.Combine(packsPath, cpkName);

            if (!File.Exists(cpkPath))
            {
                continue; // CPK non trouvé, skipper
            }

            // Vérifier si ce CPK est déjà complètement extrait
            if (options.SmartDump && completedCpks.Contains(cpkName))
            {
                plan.SkippedFiles += files.Count;
                continue;
            }

            long cpkSize = GetFileSize(cpkPath);

            var cpkPlan = new CpkExtractionPlan
            {
                CpkPath = cpkPath,
                CpkName = cpkName,
                CpkSize = cpkSize
            };

            foreach (var file in files)
            {
                string outputPath = Path.Combine(options.OutputPath, file.FullPath);
                string normalizedPath = file.FullPath.Replace('\\', '/').ToLowerInvariant();

                // Vérifier si déjà extrait (smart dump)
                if (options.SmartDump && extractedFiles.ContainsKey(normalizedPath))
                {
                    if (File.Exists(outputPath))
                    {
                        plan.SkippedFiles++;
                        continue;
                    }
                }

                cpkPlan.Files.Add(new FileExtractionInfo
                {
                    FullPath = file.FullPath,
                    OutputPath = outputPath,
                    ExtractSize = file.FileSize,
                    IsCompressed = false
                });
                plan.TotalFiles++;
                plan.TotalBytes += file.FileSize;
                // cpk_list.FileSize = taille LOGIQUE (décompressée) du fichier → c'est
                // exactement ce qui sera écrit sur disque. On la somme pour le garde-fou,
                // ARRONDIE au bloc FS supérieur : les dumps de preset comptent des dizaines
                // de milliers de petits fichiers, et le slack de bloc (4 Kio min/fichier)
                // gonfle l'empreinte réelle bien au-dessus de la somme logique brute.
                plan.EstimatedExtractBytes += RoundUpToBlock(file.FileSize);
            }

            if (cpkPlan.Files.Count > 0)
            {
                cpkPlans.Add(cpkPlan);
            }
        }

        // Trier par taille croissante (plus petits CPKs d'abord)
        plan.CpkPlans.AddRange(cpkPlans.OrderBy(p => p.CpkSize));

        return plan;
    }

    /// <summary>
    /// Construit le plan en énumérant les CPK (fallback sans ouvrir les fichiers).
    /// Trie les CPKs par taille (plus petits d'abord) et skip ceux déjà complétés.
    /// </summary>
    private ExtractionPlan BuildPlanFromCpkEnumeration(
        DumpOptions options,
        DumpManifest manifest,
        ExtractionPlan plan,
        CancellationToken ct)
    {
        // Copier les CPKs complétés pour éviter la modification pendant l'itération
        var completedCpks = new HashSet<string>(manifest.CompletedCpks, StringComparer.OrdinalIgnoreCase);

        // Utiliser le PacksPath personnalisé si fourni
        string packsPath = options.PacksPath ?? _game.PacksPath;

        if (!Directory.Exists(packsPath))
        {
            return plan;
        }

        var cpkFiles = Directory.EnumerateFiles(packsPath, "*.cpk", SearchOption.AllDirectories)
            .Select(path => new { Path = path, Size = GetFileSize(path) })
            .OrderBy(x => x.Size) // Trier par taille croissante
            .ToList();

        foreach (var cpk in cpkFiles)
        {
            ct.ThrowIfCancellationRequested();

            string cpkName = Path.GetFileName(cpk.Path);

            // Vérifier si ce CPK est déjà complètement extrait
            bool alreadyCompleted = options.SmartDump && completedCpks.Contains(cpkName);

            if (alreadyCompleted)
            {
                plan.SkippedFiles++; // On compte comme un CPK skippé
                continue;
            }

            var cpkPlan = new CpkExtractionPlan
            {
                CpkPath = cpk.Path,
                CpkName = cpkName,
                CpkSize = cpk.Size
            };

            // On ne peut pas déterminer les fichiers sans ouvrir le CPK
            // donc on ajoute un fichier "placeholder" qui sera remplacé par l'extraction réelle
            cpkPlan.Files.Add(new FileExtractionInfo
            {
                FullPath = "*",
                OutputPath = options.OutputPath,
                ExtractSize = 0,
                IsCompressed = false
            });

            plan.TotalFiles++; // Placeholder, sera mis à jour pendant l'extraction
            plan.TotalBytes += cpk.Size;
            // Fallback sans cpk_list : on n'ouvre pas chaque CPK pour lire ses tailles
            // décompressées. On MAJORE prudemment l'estimation (× CpkExpansionFactor) pour
            // ne pas sous-estimer l'espace requis ; le re-check en cours d'extraction reste
            // le filet de sécurité réel si la majoration s'avère trop basse.
            plan.EstimatedExtractBytes += (long)(cpk.Size * CpkExpansionFactor);
            plan.CpkPlans.Add(cpkPlan);
        }

        return plan;
    }

    /// <summary>
    /// Obtient la taille d'un fichier de manière sûre.
    /// </summary>
    private static long GetFileSize(string path)
    {
        try
        {
            return new FileInfo(path).Length;
        }
        catch
        {
            return long.MaxValue; // En cas d'erreur, mettre à la fin
        }
    }

    /// <summary>
    /// Garde-fou disque PRÉ-extraction : compare l'estimation décompressée du plan à
    /// l'espace libre réel de la partition de sortie. Renvoie <c>false</c> (et remplit
    /// <see cref="DumpResult.Error"/>) si ça ne tient pas et que l'override n'est pas posé.
    ///
    /// Comportement choisi (le plus sûr) : <b>refus avant toute écriture</b> avec un message
    /// chiffré (« dump estimé X > Y libres »). L'utilisateur peut forcer via
    /// <see cref="DumpOptions.IgnoreSpaceCheck"/> ou relever explicitement le plafond via
    /// <see cref="DumpOptions.MaxDiskBytes"/> — auquel cas le re-check EN COURS d'extraction
    /// (cf. <see cref="ExecuteExtractionAsync"/>) reste le filet de sécurité.
    /// </summary>
    private static bool CheckDiskBudget(
        DumpOptions options,
        ExtractionPlan plan,
        DumpResult result,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        if (options.IgnoreSpaceCheck)
        {
            options.OnProgress?.Invoke(new DumpProgress
            {
                Phase = DumpPhase.Planning,
                Message = $"Contrôle d'espace désactivé (--no-space-check) ; estimé {FormatGiB(plan.EstimatedExtractBytes)}"
            });
            return true;
        }

        var (free, total) = GetDiskSpace(options.OutputPath);
        if (free < 0)
        {
            // Partition non interrogeable : on n'a pas de quoi décider → on laisse passer
            // (le re-check en cours d'extraction, lui aussi best-effort, prendra le relais).
            return true;
        }

        // Plafond effectif = min(budget réel de la partition, plafond utilisateur s'il existe).
        long budget = DiskBudget.UsableBudget(free, total);
        if (options.MaxDiskBytes is long cap && cap >= 0)
        {
            budget = Math.Min(budget, cap);
        }

        if (plan.EstimatedExtractBytes <= budget)
        {
            options.OnProgress?.Invoke(new DumpProgress
            {
                Phase = DumpPhase.Planning,
                Message = $"Espace OK : estimé {FormatGiB(plan.EstimatedExtractBytes)} ≤ {FormatGiB(budget)} disponibles (réserve {FormatGiB(DiskBudget.Reserve(total))})"
            });
            return true;
        }

        result.Error =
            $"Espace insuffisant : dump estimé {FormatGiB(plan.EstimatedExtractBytes)} > {FormatGiB(budget)} utilisables " +
            $"({FormatGiB(free)} libres − réserve {FormatGiB(DiskBudget.Reserve(total))}). " +
            "Affinez la sélection (--preset/--include), libérez de l'espace, ou forcez avec --no-space-check.";
        options.OnProgress?.Invoke(new DumpProgress { Phase = DumpPhase.Error, Message = result.Error });
        return false;
    }

    /// <summary>
    /// Espace libre / total de la partition contenant <paramref name="outputPath"/>.
    /// Renvoie <c>(-1, -1)</c> si indéterminable (chemin invalide, partition inconnue).
    /// </summary>
    private static (long free, long total) GetDiskSpace(string outputPath)
    {
        try
        {
            // La racine peut ne pas exister encore (sortie pas créée) : on remonte au
            // premier ancêtre existant pour interroger la BONNE partition.
            string probe = Path.GetFullPath(outputPath);
            while (!Directory.Exists(probe))
            {
                var parent = Path.GetDirectoryName(probe);
                if (string.IsNullOrEmpty(parent) || parent == probe) break;
                probe = parent;
            }

            var drive = new DriveInfo(Path.GetPathRoot(probe) ?? probe);
            return (drive.AvailableFreeSpace, drive.TotalSize);
        }
        catch
        {
            return (-1, -1);
        }
    }

    private static string FormatGiB(long bytes) =>
        $"{bytes / 1024.0 / 1024.0 / 1024.0:F1} Gio";

    /// <summary>
    /// Exécute l'extraction parallélisée avec pipeline haute performance.
    /// </summary>
    private async Task ExecuteExtractionAsync(
        ExtractionPlan plan,
        DumpManifest manifest,
        DumpOptions options,
        DumpResult result,
        CancellationToken ct)
    {
        var progress = new DumpProgressState
        {
            TotalFiles = plan.TotalFiles,
            TotalBytes = plan.TotalBytes
        };

        var stopwatch = Stopwatch.StartNew();
        var errors = new ConcurrentBag<string>();

        // Batch les mises à jour du manifest pour éviter les locks fréquents
        var manifestUpdates = Channel.CreateBounded<(string path, string cpkName)>(
            new BoundedChannelOptions(10000) { SingleReader = true, SingleWriter = false });

        // Tâche de fond pour mettre à jour le manifest de manière groupée
        var manifestTask = Task.Run(async () =>
        {
            var batch = new List<(string path, string cpkName)>(1000);
            await foreach (var update in manifestUpdates.Reader.ReadAllAsync(ct))
            {
                batch.Add(update);

                // Flush le batch tous les 1000 fichiers
                if (batch.Count >= 1000)
                {
                    lock (manifest)
                    {
                        foreach (var (path, cpkName) in batch)
                        {
                            manifest.ExtractedFiles[path] = new ExtractedFileInfo
                            {
                                Size = 0,
                                CpkName = cpkName,
                                ExtractedAt = DateTime.UtcNow
                            };
                        }
                    }
                    batch.Clear();
                }
            }

            // Flush les restants
            if (batch.Count > 0)
            {
                lock (manifest)
                {
                    foreach (var (path, cpkName) in batch)
                    {
                        manifest.ExtractedFiles[path] = new ExtractedFileInfo
                        {
                            Size = 0,
                            CpkName = cpkName,
                            ExtractedAt = DateTime.UtcNow
                        };
                    }
                }
            }
        }, ct);

        // CTS liée : permet d'arrêter PROPREMENT l'extraction si l'espace libre tombe sous
        // la réserve en cours de route (estimation fausse / voisin qui remplit le disque),
        // sans annuler le token de l'appelant.
        using var diskCts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        // Cap CPK-parallèle : volontairement borné (mono-disque, I/O bound). Surchargeable
        // par IECODE_DUMP_CPK_PARALLELISM pour les cas RAM/CPU-bound (filtre serré, petits
        // fichiers) où le disque n'est pas le goulot — défaut historique = 4.
        int cpkParallelism = Math.Min(options.MaxParallelism, options.CpkParallelism);
        var parallelOptions = new ParallelOptions
        {
            MaxDegreeOfParallelism = cpkParallelism,
            CancellationToken = diskCts.Token
        };

        int cpkIndex = 0;
        var lastSaveTime = DateTime.UtcNow;
        var lastSpaceCheck = DateTime.UtcNow;
        var spaceLock = new object();
        bool diskAborted = false;

        // Traiter les CPKs en parallèle (limité pour éviter la saturation I/O)
        try
        {
        await Parallel.ForEachAsync(plan.CpkPlans, parallelOptions, async (cpkPlan, token) =>
        {
            int localIndex = Interlocked.Increment(ref cpkIndex);

            if (cpkPlan.Error != null)
            {
                errors.Add($"{cpkPlan.CpkName}: {cpkPlan.Error}");
                return;
            }

            options.OnProgress?.Invoke(new DumpProgress
            {
                Phase = DumpPhase.Extracting,
                CurrentCpk = cpkPlan.CpkName,
                CpkIndex = localIndex,
                TotalCpks = plan.CpkPlans.Count,
                ExtractedFiles = progress.ExtractedFiles,
                TotalFiles = progress.TotalFiles,
                ExtractedBytes = progress.ExtractedBytes,
                TotalBytes = progress.TotalBytes,
                BytesPerSecond = progress.ExtractedBytes / Math.Max(1, stopwatch.Elapsed.TotalSeconds),
                Message = $"[{localIndex}/{plan.CpkPlans.Count}] {cpkPlan.CpkName}"
            });

            try
            {
                await ExtractCpkOptimizedAsync(cpkPlan, manifestUpdates.Writer, options, progress, errors, token);

                // Marquer ce CPK comme complètement extrait
                lock (manifest)
                {
                    manifest.CompletedCpks.Add(cpkPlan.CpkName);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                errors.Add($"{cpkPlan.CpkName}: {ex.Message}");
            }

            // Re-vérification de l'espace EN COURS d'extraction (filet de sécurité si
            // l'estimation pré-vol était fausse). Un seul thread effectue le check par
            // intervalle ; si la réserve est franchie, on annule la CTS liée → la boucle
            // s'arrête proprement (les CPK en vol terminent, les suivants sont sautés).
            if (!options.IgnoreSpaceCheck)
            {
                bool doCheck = false;
                lock (spaceLock)
                {
                    if (!diskAborted && DateTime.UtcNow - lastSpaceCheck >= SpaceRecheckInterval)
                    {
                        lastSpaceCheck = DateTime.UtcNow;
                        doCheck = true;
                    }
                }
                if (doCheck)
                {
                    var (free, total) = GetDiskSpace(options.OutputPath);
                    if (free >= 0 && DiskBudget.ReserveBreached(free, total))
                    {
                        lock (spaceLock) { diskAborted = true; }
                        result.Error =
                            $"Arrêt : espace libre tombé à {FormatGiB(free)} (réserve {FormatGiB(DiskBudget.Reserve(total))}) — extraction stoppée pour ne pas saturer le disque.";
                        options.OnProgress?.Invoke(new DumpProgress { Phase = DumpPhase.Error, Message = result.Error });
                        diskCts.Cancel();
                    }
                }
            }

            // Sauvegarder le manifest périodiquement (toutes les 60 secondes max)
            var now = DateTime.UtcNow;
            if ((now - lastSaveTime).TotalSeconds > 60)
            {
                lastSaveTime = now;
                try
                {
                    await SaveManifestAsync(manifest, options.OutputPath, token);
                }
                catch { /* Ignore save errors during extraction */ }
            }
        });
        }
        catch (OperationCanceledException) when (diskAborted && !ct.IsCancellationRequested)
        {
            // Annulation déclenchée par NOUS (réserve disque franchie), pas par l'appelant :
            // ce n'est pas un échec utilisateur → on sort proprement, result.Error est posé.
        }

        // Fermer le channel et attendre la fin du traitement
        manifestUpdates.Writer.Complete();
        await manifestTask;

        result.ExtractedFiles = progress.ExtractedFiles;
        result.ExtractedBytes = progress.ExtractedBytes;
        result.Errors = errors.ToList();
        result.DiskAborted = diskAborted;
    }

    /// <summary>
    /// Extrait un CPK avec optimisations I/O maximales.
    /// </summary>
    private async Task ExtractCpkOptimizedAsync(
        CpkExtractionPlan cpkPlan,
        ChannelWriter<(string path, string cpkName)> manifestWriter,
        DumpOptions options,
        DumpProgressState progress,
        ConcurrentBag<string> errors,
        CancellationToken ct)
    {
        try
        {
            long cpkSize = 0;
            try
            {
                cpkSize = new FileInfo(cpkPlan.CpkPath).Length;
            }
            catch { /* Ignore */ }

            int filesInCpk = 0;
            var progressHandler = new Progress<(int current, int total, string fileName)>(p =>
            {
                Interlocked.Increment(ref progress.ExtractedFiles);
                filesInCpk = p.total;

                // Estimer les bytes extraits basés sur la progression dans le CPK
                if (p.total > 0)
                {
                    long estimatedBytes = cpkSize * p.current / p.total;
                    Interlocked.Exchange(ref progress.ExtractedBytes,
                        progress.ExtractedBytes + estimatedBytes / Math.Max(1, filesInCpk));
                }

                // Envoyer la mise à jour au channel (non-bloquant)
                string normalizedPath = p.fileName.Replace('\\', '/').ToLowerInvariant();
                manifestWriter.TryWrite((normalizedPath, cpkPlan.CpkName));
            });

            // Si un filtre est actif, n'extraire QUE les fichiers planifiés (filtrés +
            // dédupliqués) de ce CPK — pas tout le pack.
            Func<string, bool>? shouldExtract = null;
            if (!string.IsNullOrWhiteSpace(options.FileFilter))
            {
                var wanted = new HashSet<string>(
                    cpkPlan.Files.Select(f => f.FullPath.Replace('\\', '/')),
                    StringComparer.OrdinalIgnoreCase);
                shouldExtract = path => wanted.Contains(path.Replace('\\', '/'));
            }

            await _game.Cpk.ExtractAllOptimizedAsync(cpkPlan.CpkPath, options.OutputPath, options.MaxParallelism, progressHandler, ct, shouldExtract);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            errors.Add($"{cpkPlan.CpkName}: {ex.Message}");
        }
    }

    /// <summary>
    /// Copie les loose files (fichiers hors CPK).
    /// </summary>
    private async Task CopyLooseFilesAsync(
        DumpOptions options,
        DumpManifest manifest,
        DumpResult result,
        CancellationToken ct)
    {
        options.OnProgress?.Invoke(new DumpProgress
        {
            Phase = DumpPhase.CopyingLoose,
            Message = "Copie des loose files..."
        });

        // Fichiers à copier hors des packs
        var loosePatterns = new[] { "*.cfg.bin", "*.ini" };
        var looseFiles = new List<string>();

        foreach (var pattern in loosePatterns)
        {
            looseFiles.AddRange(Directory.EnumerateFiles(_game.DataPath, pattern, SearchOption.AllDirectories)
                .Where(f => !f.Contains("packs", StringComparison.OrdinalIgnoreCase)));
        }

        foreach (var file in looseFiles)
        {
            ct.ThrowIfCancellationRequested();

            string relativePath = Path.GetRelativePath(_game.DataPath, file);
            string outputPath = Path.Combine(options.OutputPath, relativePath);

            var dir = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            if (!File.Exists(outputPath) || !options.SmartDump)
            {
                await CopyFileAsync(file, outputPath, ct);
                result.LooseFilesCopied++;
            }
        }
    }

    /// <summary>
    /// Copie un fichier de manière asynchrone.
    /// </summary>
    private static async Task CopyFileAsync(string source, string destination, CancellationToken ct)
    {
        const int bufferSize = 81920;
        await using var sourceStream = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var destStream = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await sourceStream.CopyToAsync(destStream, bufferSize, ct);
    }

    /// <summary>
    /// Sauvegarde le manifest de dump de manière thread-safe.
    /// </summary>
    private static async Task SaveManifestAsync(DumpManifest manifest, string outputPath, CancellationToken ct)
    {
        // Copier les données pour éviter les modifications concurrentes pendant la sérialisation
        DumpManifest manifestCopy;
        lock (manifest)
        {
            manifestCopy = new DumpManifest
            {
                GamePath = manifest.GamePath,
                CreatedAt = manifest.CreatedAt,
                LastUpdated = DateTime.UtcNow,
                CompletedCpks = new HashSet<string>(manifest.CompletedCpks, StringComparer.OrdinalIgnoreCase),
                ExtractedFiles = new Dictionary<string, ExtractedFileInfo>(manifest.ExtractedFiles, StringComparer.OrdinalIgnoreCase)
            };
        }

        string manifestPath = Path.Combine(outputPath, ".iecode-manifest.json");
        string json = JsonSerializer.Serialize(manifestCopy, (JsonTypeInfo<DumpManifest>)AppJsonContext.Options.GetTypeInfo(typeof(DumpManifest)));
        await File.WriteAllTextAsync(manifestPath, json, ct);
    }
}

#region Models

/// <summary>
/// Options pour le dump.
/// </summary>
public sealed class DumpOptions
{
    /// <summary>
    /// Chemin de sortie.
    /// </summary>
    public required string OutputPath { get; init; }

    /// <summary>
    /// Chemin personnalisé pour les CPKs (si différent de game/data/packs).
    /// </summary>
    public string? PacksPath { get; init; }

    /// <summary>
    /// Activer le smart dump (skip fichiers existants).
    /// </summary>
    public bool SmartDump { get; init; } = true;

    /// <summary>
    /// Utiliser cpk_list.cfg.bin pour la déduplication.
    /// </summary>
    public bool UseCpkList { get; init; } = true;

    /// <summary>
    /// Inclure les loose files (hors CPK).
    /// </summary>
    public bool IncludeLooseFiles { get; init; } = true;

    /// <summary>
    /// Degré de parallélisme maximum (défaut : <see cref="Runtime.HostProfile.Parallelism"/>,
    /// ajusté à la charge du VPS partagé).
    /// </summary>
    public int MaxParallelism { get; init; } = Runtime.HostProfile.Parallelism;

    /// <summary>
    /// Callback de progression.
    /// </summary>
    public Action<DumpProgress>? OnProgress { get; init; }

    /// <summary>
    /// Filtre de fichiers (glob pattern).
    /// </summary>
    public string? FileFilter { get; init; }

    /// <summary>
    /// Plafond explicite d'octets décompressés à écrire (en plus du garde-fou de partition).
    /// <c>null</c> = pas de plafond utilisateur (seul le budget réel de la partition s'applique).
    /// </summary>
    public long? MaxDiskBytes { get; init; }

    /// <summary>
    /// Désactive TOUT contrôle d'espace (pré-vol ET re-check) : l'utilisateur force le dump
    /// même au risque de saturer le disque. Défaut <c>false</c>.
    /// </summary>
    public bool IgnoreSpaceCheck { get; init; }

    /// <summary>
    /// Nombre de CPK traités en parallèle. Volontairement borné (mono-disque, I/O bound) ;
    /// défaut 4, surchargeable par <c>IECODE_DUMP_CPK_PARALLELISM</c>. La parallélisation
    /// FINE (fichiers d'un CPK, threads d'écriture) reste pilotée par <see cref="MaxParallelism"/>.
    /// </summary>
    public int CpkParallelism { get; init; } = ResolveCpkParallelism();

    /// <summary>Défaut 4 (mono-disque) ; <c>IECODE_DUMP_CPK_PARALLELISM</c> &gt; 0 surcharge.</summary>
    private static int ResolveCpkParallelism()
    {
        var env = Environment.GetEnvironmentVariable("IECODE_DUMP_CPK_PARALLELISM");
        return int.TryParse(env, out var n) && n > 0 ? n : 4;
    }
}

/// <summary>
/// Résultat du dump.
/// </summary>
public sealed class DumpResult
{
    public bool Success { get; set; }
    public bool WasCancelled { get; set; }
    public bool IsResume { get; set; }
    public string? Error { get; set; }
    public string OutputPath { get; set; } = string.Empty;
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
    public TimeSpan Duration { get; set; }
    public int TotalCpks { get; set; }
    public int TotalFiles { get; set; }
    public int ExtractedFiles { get; set; }
    public int SkippedFiles { get; set; }
    public int LooseFilesCopied { get; set; }
    public long ExtractedBytes { get; set; }

    /// <summary>Octets décompressés estimés par le plan (somme des tailles à écrire).</summary>
    public long EstimatedBytes { get; set; }

    /// <summary>Vrai si l'extraction a été stoppée par le garde-fou disque en cours de route.</summary>
    public bool DiskAborted { get; set; }

    public List<string> Errors { get; set; } = [];

    public double MBPerSecond => ExtractedBytes / 1024.0 / 1024.0 / Math.Max(1, Duration.TotalSeconds);
    public double FilesPerSecond => ExtractedFiles / Math.Max(1, Duration.TotalSeconds);
}

/// <summary>
/// Progression du dump.
/// </summary>
public sealed class DumpProgress
{
    public DumpPhase Phase { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? CurrentCpk { get; set; }
    public int CpkIndex { get; set; }
    public int TotalCpks { get; set; }
    public int ExtractedFiles { get; set; }
    public int TotalFiles { get; set; }
    public long ExtractedBytes { get; set; }
    public long TotalBytes { get; set; }
    public double BytesPerSecond { get; set; }

    public double PercentComplete => TotalFiles > 0 ? ExtractedFiles * 100.0 / TotalFiles : 0;
    public double MBPerSecond => BytesPerSecond / 1024.0 / 1024.0;
}

/// <summary>
/// Phase du dump.
/// </summary>
public enum DumpPhase
{
    Loading,
    Planning,
    Extracting,
    CopyingLoose,
    Completed,
    Cancelled,
    Error
}

/// <summary>
/// Manifest de dump pour le smart resume.
/// </summary>
public sealed class DumpManifest
{
    public string GamePath { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime LastUpdated { get; set; }

    /// <summary>
    /// CPKs complètement extraits (clé = nom du CPK).
    /// </summary>
    public HashSet<string> CompletedCpks { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Fichiers individuels extraits.
    /// </summary>
    public Dictionary<string, ExtractedFileInfo> ExtractedFiles { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Info d'un fichier extrait.
/// </summary>
public sealed class ExtractedFileInfo
{
    public long Size { get; set; }
    public string CpkName { get; set; } = string.Empty;
    public DateTime ExtractedAt { get; set; }
}

#endregion

#region Internal Models

internal sealed class ExtractionPlan
{
    public List<CpkExtractionPlan> CpkPlans { get; } = [];
    public int TotalFiles { get; set; }
    public long TotalBytes { get; set; }
    public int SkippedFiles { get; set; }

    /// <summary>
    /// Somme estimée des octets DÉCOMPRESSÉS à écrire (taille réelle sur disque). Source du
    /// garde-fou disque : exacte via cpk_list (FileSize = taille logique), majorée en fallback.
    /// </summary>
    public long EstimatedExtractBytes { get; set; }
}

internal sealed class CpkExtractionPlan
{
    public required string CpkPath { get; init; }
    public required string CpkName { get; init; }
    public long CpkSize { get; set; }
    public List<FileExtractionInfo> Files { get; } = [];
    public string? Error { get; set; }
    public bool AlreadyCompleted { get; set; }
}

internal sealed class FileExtractionInfo
{
    public required string FullPath { get; init; }
    public required string OutputPath { get; init; }
    public long ExtractSize { get; init; }
    public bool IsCompressed { get; init; }
}

internal sealed class DumpProgressState
{
    public int TotalFiles;
    public long TotalBytes;
    public int ExtractedFiles;
    public long ExtractedBytes;
}

#endregion
