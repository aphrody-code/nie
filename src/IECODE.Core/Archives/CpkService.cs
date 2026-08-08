using System.Threading.Channels;
using IECODE.Core.Formats.Criware.CriFs;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Structs;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Utilities;
using IECODE.Core.Formats.Criware.CriFs.Encryption;

namespace IECODE.Core.Archives;

/// <summary>
/// Service d'extraction et de manipulation des archives CPK.
/// Wrapper autour de IECODE.Core.Formats.Criware.CriFs optimisé pour IEVR.
/// </summary>
public sealed class CpkService
{
    private readonly IEVRGame _game;

    // ── Garde-fou mémoire (RAM-max sans OOM) ──────────────────────────────────
    // Chaque fichier est décompressé EN ENTIER dans un tableau poolé avant écriture.
    // Certains fichiers IEVR pèsent plusieurs Go décompressés (movie/audio) ; avec
    // plusieurs consumers × plusieurs CPK en parallèle, on pourrait dépasser la RAM.
    // On borne donc le TOTAL d'octets en vol (process-wide) par un sémaphore à crédits :
    // 1 crédit = 1 Mio. Un fichier acquiert ⌈ExtractSize/Mio⌉ crédits avant extraction et
    // les rend après écriture. Défaut 12 Gio (< 16 Gio voulus, marge vs 23 Gio dispo) ;
    // surchargeable par IECODE_DUMP_MEM_BUDGET (en Mio).
    private const int MemPermitBytes = 1024 * 1024; // 1 Mio par crédit
    private static readonly int MemBudgetPermits = ResolveMemBudgetPermits();
    private static readonly SemaphoreSlim MemBudget = new(MemBudgetPermits, MemBudgetPermits);

    private static int ResolveMemBudgetPermits()
    {
        var env = Environment.GetEnvironmentVariable("IECODE_DUMP_MEM_BUDGET");
        long mib = long.TryParse(env, out var m) && m > 0 ? m : 12L * 1024; // 12 Gio
        // Borne dure : jamais au-dessus de ~16 Gio même si l'override est délirant.
        mib = Math.Min(mib, 16L * 1024);
        return (int)Math.Clamp(mib, 64, int.MaxValue);
    }

    /// <summary>Crédits mémoire requis pour un fichier de <paramref name="extractBytes"/> octets,
    /// plafonnés au budget total (un fichier géant peut tourner seul, sans interblocage).</summary>
    private static int MemPermitsFor(long extractBytes)
    {
        long permits = (extractBytes + MemPermitBytes - 1) / MemPermitBytes;
        return (int)Math.Clamp(permits < 1 ? 1 : permits, 1, MemBudgetPermits);
    }

    public CpkService(IEVRGame game)
    {
        _game = game;
    }

    /// <summary>
    /// Liste tous les fichiers CPK dans le dossier packs/.
    /// </summary>
    public IEnumerable<string> GetAllCpkFiles()
    {
        if (!Directory.Exists(_game.PacksPath))
        {
            yield break;
        }

        foreach (var file in Directory.EnumerateFiles(_game.PacksPath, "*.cpk", SearchOption.AllDirectories))
        {
            yield return file;
        }
    }

    /// <summary>
    /// Ouvre un CPK et retourne la liste des fichiers qu'il contient.
    /// </summary>
    /// <param name="cpkPath">Chemin vers le fichier CPK</param>
    /// <param name="decrypt">Décrypter automatiquement si nécessaire</param>
    public CpkFileInfo[] GetFilesInCpk(string cpkPath, bool decrypt = true)
    {
        using var stream = OpenCpkStream(cpkPath, decrypt);
        using var reader = CriFsLib.Instance.CreateCpkReader(stream, ownsStream: true);

        return reader.GetFiles()
            .Select(f => new CpkFileInfo
            {
                FileName = f.FileName,
                Directory = f.Directory ?? string.Empty,
                FullPath = string.IsNullOrEmpty(f.Directory)
                    ? f.FileName
                    : $"{f.Directory}/{f.FileName}",
                FileSize = (long)f.FileSize,
                ExtractSize = (long)f.ExtractSize,
                IsCompressed = f.FileSize != f.ExtractSize
            })
            .ToArray();
    }

    /// <summary>
    /// Extrait un fichier spécifique d'un CPK.
    /// </summary>
    /// <param name="cpkPath">Chemin vers le CPK</param>
    /// <param name="filePath">Chemin du fichier dans le CPK</param>
    /// <param name="outputPath">Chemin de sortie</param>
    /// <param name="ct">Token d'annulation</param>
    public async Task ExtractFileAsync(string cpkPath, string filePath, string outputPath, CancellationToken ct = default)
    {
        using var stream = OpenCpkStream(cpkPath, true);
        using var reader = CriFsLib.Instance.CreateCpkReader(stream, ownsStream: true);

        var files = reader.GetFiles();
        var targetFile = files.FirstOrDefault(f =>
        {
            string fullPath = string.IsNullOrEmpty(f.Directory) ? f.FileName : $"{f.Directory}/{f.FileName}";
            return fullPath.Equals(filePath, StringComparison.OrdinalIgnoreCase);
        });

        if (targetFile.FileName == null)
        {
            throw new FileNotFoundException($"File not found in CPK: {filePath}");
        }

        var dir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        using var extracted = reader.ExtractFile(targetFile);
        // Écriture zéro-copie depuis le tableau poolé (pas de .ToArray()).
        await File.WriteAllBytesAsync(outputPath, extracted.RawArray.AsMemory(0, extracted.Count), ct);
    }

    /// <summary>
    /// Extrait tous les fichiers d'un CPK vers un dossier.
    /// </summary>
    /// <param name="cpkPath">Chemin vers le CPK</param>
    /// <param name="outputDirectory">Dossier de sortie</param>
    /// <param name="progress">Callback de progression (fichiers extraits, total)</param>
    /// <param name="ct">Token d'annulation</param>
    public async Task ExtractAllAsync(
        string cpkPath,
        string outputDirectory,
        IProgress<(int current, int total, string fileName)>? progress = null,
        CancellationToken ct = default)
    {
        await ExtractAllOptimizedAsync(cpkPath, outputDirectory, Runtime.HostProfile.Parallelism, progress, ct);
    }

    /// <summary>
    /// Extrait tous les fichiers d'un CPK avec pattern streaming Microsoft (Channel + Parallel.ForEachAsync).
    /// Architecture inspirée de ZipFile.ExtractToDirectory avec protection path traversal.
    /// </summary>
    public async Task ExtractAllOptimizedAsync(
        string cpkPath,
        string outputDirectory,
        int maxParallelism,
        IProgress<(int current, int total, string fileName)>? progress = null,
        CancellationToken ct = default,
        Func<string, bool>? shouldExtract = null)
    {
        // Normaliser le chemin de sortie (protection path traversal)
        outputDirectory = Path.GetFullPath(outputDirectory);
        if (!outputDirectory.EndsWith(Path.DirectorySeparatorChar))
            outputDirectory += Path.DirectorySeparatorChar;

        using var stream = OpenCpkStream(cpkPath, true);
        using var reader = CriFsLib.Instance.CreateCpkReader(stream, ownsStream: true);

        // Filtre optionnel par chemin interne : n'extrait que les fichiers voulus
        // (sélection inagle/azalee + dédup) au lieu de tout le pack.
        static string FullPathOf(CpkFile f) =>
            string.IsNullOrEmpty(f.Directory) ? f.FileName : $"{f.Directory}/{f.FileName}";
        var files = (shouldExtract is null
            ? reader.GetFiles()
            : reader.GetFiles().Where(f => shouldExtract(FullPathOf(f))))
            .ToArray();
        int total = files.Length;
        int current = 0;

        // Pré-créer tous les répertoires en une passe
        var directories = files
            .Select(f => string.IsNullOrEmpty(f.Directory) ? null : Path.Combine(outputDirectory, f.Directory.Replace('/', Path.DirectorySeparatorChar)))
            .Where(d => d != null)
            .Distinct()
            .ToArray();

        foreach (var dir in directories)
        {
            Directory.CreateDirectory(dir!);
        }

        // Channel bounded pour backpressure (pattern Microsoft Docs)
        var channel = Channel.CreateBounded<(CpkFile file, string fullPath, string outputPath)>(
            new BoundedChannelOptions(maxParallelism * 2)
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleWriter = true,
                SingleReader = false
            });

        // Producer: Extraire les fichiers et alimenter le channel
        var producerTask = Task.Run(async () =>
        {
            try
            {
                foreach (var file in files)
                {
                    ct.ThrowIfCancellationRequested();

                    string fullPath = string.IsNullOrEmpty(file.Directory)
                        ? file.FileName
                        : $"{file.Directory}/{file.FileName}";

                    string relativePath = fullPath.Replace('/', Path.DirectorySeparatorChar);
                    string outputPath = Path.GetFullPath(Path.Combine(outputDirectory, relativePath));

                    // Protection path traversal (pattern Microsoft ZipFile)
                    if (!outputPath.StartsWith(outputDirectory, StringComparison.Ordinal))
                    {
                        throw new InvalidOperationException($"Path traversal detected: {fullPath}");
                    }

                    await channel.Writer.WriteAsync((file, fullPath, outputPath), ct);
                }
            }
            finally
            {
                channel.Writer.Complete();
            }
        }, ct);

        // Lock pour sérialiser les lectures du stream CPK (non thread-safe)
        var readerLock = new object();

        // Consumers: Extraire + écrire en parallèle (pattern Parallel.ForEachAsync)
        await Parallel.ForEachAsync(
            channel.Reader.ReadAllAsync(ct),
            new ParallelOptions
            {
                MaxDegreeOfParallelism = maxParallelism,
                CancellationToken = ct
            },
            async (item, token) =>
            {
                // Garde-fou mémoire : réserver les crédits correspondant à la taille
                // décompressée AVANT d'allouer le tableau (bloque si le budget est saturé →
                // RAM exploitée à fond sans jamais dépasser le plafond ni OOM).
                int permits = MemPermitsFor(item.file.ExtractSize);
                for (int i = 0; i < permits; i++)
                {
                    await MemBudget.WaitAsync(token);
                }
                try
                {
                    // Extraction depuis CPK : la lecture du stream (non thread-safe) est
                    // sérialisée ; la décompression remplit un tableau poolé (ArrayRental).
                    ArrayRental extracted;
                    lock (readerLock)
                    {
                        extracted = reader.ExtractFile(item.file);
                    }

                    // Écriture ZÉRO-COPIE : on écrit directement le tableau poolé sur disque
                    // via RandomAccess (API recommandée pour les I/O parallèles, sans objet
                    // FileStream ni allocation .ToArray()), puis on rend le buffer au pool.
                    try
                    {
                        using var handle = File.OpenHandle(
                            item.outputPath, FileMode.Create, FileAccess.Write, FileShare.None,
                            FileOptions.Asynchronous);
                        await RandomAccess.WriteAsync(handle, extracted.RawArray.AsMemory(0, extracted.Count), 0, token);
                    }
                    finally
                    {
                        extracted.Dispose();
                    }

                    // Progress reporting thread-safe
                    int done = Interlocked.Increment(ref current);
                    progress?.Report((done, total, item.fullPath));
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Log mais continue (ne pas bloquer l'extraction globale)
                    Console.Error.WriteLine($"Error extracting {item.fullPath}: {ex.Message}");
                }
                finally
                {
                    MemBudget.Release(permits);
                }
            });

        await producerTask;
    }

    /// <summary>
    /// Ouvre un stream CPK avec décryptage automatique via IECODE.Core.Formats.Criware.CriFs.
    /// Le stream renvoyé est SEEKABLE et déchiffre positionnellement (DecryptBlock est
    /// offset-aware via la position courante) → adapté à l'extraction mono-fichier aléatoire
    /// du CDN, pas seulement au dump séquentiel. <c>internal</c> pour réutilisation par le pool CDN.
    /// </summary>
    internal static Stream OpenCpkStream(string cpkPath, bool decrypt)
    {
        if (!decrypt)
        {
            return new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                bufferSize: Runtime.HostProfile.IoBufferBytes, FileOptions.SequentialScan);
        }

        // Détection chiffrement : lire les 4 octets de magic via RandomAccess (sans
        // ouvrir de FileStream ni lire 2 Ko inutiles). CPK clair = magic "CPK ".
        Span<byte> magic = stackalloc byte[4];
        using (var handle = File.OpenHandle(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (RandomAccess.Read(handle, magic, 0) < 4)
            {
                throw new InvalidDataException($"CPK trop court : {cpkPath}");
            }
        }

        if (magic[0] == (byte)'C' && magic[1] == (byte)'P' && magic[2] == (byte)'K' && magic[3] == (byte)' ')
        {
            // Non chiffré → FileStream brut séquentiel.
            return new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read,
                bufferSize: Runtime.HostProfile.IoBufferBytes, FileOptions.SequentialScan);
        }

        // Chiffré → stream de déchiffrement CriFs (déchiffre tout le contenu).
        return CpkDecryptionStream.FromFile(cpkPath);
    }
}

/// <summary>
/// Informations sur un fichier dans un CPK.
/// </summary>
public readonly struct CpkFileInfo
{
    public required string FileName { get; init; }
    public required string Directory { get; init; }
    public required string FullPath { get; init; }
    public required long FileSize { get; init; }
    public required long ExtractSize { get; init; }
    public required bool IsCompressed { get; init; }
}

