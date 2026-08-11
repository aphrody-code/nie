namespace IECODE.Core.Cdn;

/// <summary>Compte-rendu d'un export batch du sous-arbre menu.</summary>
public readonly record struct MenuExportReport(
    int Containers, int PngWritten, int Failed, long BytesWritten, string OutputRoot);

/// <summary>
/// Matérialise tout (ou un sous-ensemble) du sous-arbre <c>dx11/menu/**</c> en PNG sur disque, dans
/// la MÊME arborescence que celle servie par nginx en prod (<c>cdn.rosegriffon.fr/dx11/menu/&lt;path&gt;</c>) :
/// <c>&lt;out&gt;/dx11/menu/200_icon/10_icon_chr/face/c01000010_l_c01000010_1_l00.png</c>, etc.
///
/// Ainsi un nginx (alias <c>dx11/menu/</c> → ce dossier) peut servir le résultat SANS modification.
/// On n'écrit JAMAIS sous la prod : la cible est un dossier neuf fourni par l'appelant.
///
/// Stratégie : on énumère les conteneurs G4TX (<see cref="MenuAssetResolver.EnumerateMenuContainers"/>),
/// puis pour chacun on décode TOUTES ses (sous-)textures (1 ouverture CPK par conteneur) et on écrit
/// un PNG par texture. Parallélisé par conteneur ; le pool de readers CPK sérialise par CPK.
/// </summary>
public sealed class MenuBatchExporter
{
    private readonly MenuPngService _png;
    private readonly CdnFileService _cdn;

    public MenuBatchExporter(CdnFileService cdn)
    {
        _cdn = cdn;
        _png = new MenuPngService(cdn);
    }

    /// <summary>
    /// Exporte le sous-arbre menu vers <paramref name="outputRoot"/>. <paramref name="filter"/>
    /// (sous-chaîne, optionnelle) limite aux conteneurs dont le chemin logique la contient
    /// (ex. <c>"face"</c>, <c>"telop_waza/fr"</c>). <paramref name="overwrite"/> false saute les PNG
    /// déjà présents (reprise idempotente).
    /// </summary>
    public async Task<MenuExportReport> ExportAsync(
        string outputRoot,
        string? filter = null,
        bool overwrite = false,
        int? maxDegreeOfParallelism = null,
        IProgress<MenuExportProgress>? progress = null,
        CancellationToken ct = default)
    {
        Directory.CreateDirectory(outputRoot);
        var fullRoot = Path.GetFullPath(outputRoot);

        var containers = MenuAssetResolver.EnumerateMenuContainers(_cdn)
            .Where(l => filter is null || l.Path.Contains(filter, StringComparison.OrdinalIgnoreCase))
            .ToArray();

        int written = 0, failed = 0, done = 0;
        long bytes = 0;

        var opts = new ParallelOptions
        {
            MaxDegreeOfParallelism = maxDegreeOfParallelism is > 0 and { } m
                ? m
                : Math.Min(Environment.ProcessorCount, 16),
            CancellationToken = ct,
        };

        await Parallel.ForEachAsync(containers, opts, async (loc, token) =>
        {
            try
            {
                var pngs = await _png.RenderAllAsync(loc.Path, token).ConfigureAwait(false);
                foreach (var p in pngs)
                {
                    // Chemin disque = out/ + chemin azalee (déjà sans 'data/', forme dx11/menu/…).
                    var rel = p.AzaleePath.Replace('/', Path.DirectorySeparatorChar);
                    var dest = Path.GetFullPath(Path.Combine(fullRoot, rel));
                    if (!dest.StartsWith(fullRoot, StringComparison.Ordinal))
                        continue; // garde anti-traversal

                    if (!overwrite && File.Exists(dest))
                        continue;

                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    await File.WriteAllBytesAsync(dest, p.Bytes, token).ConfigureAwait(false);
                    Interlocked.Increment(ref written);
                    Interlocked.Add(ref bytes, p.Bytes.LongLength);
                }
            }
            catch (OperationCanceledException) { throw; }
            catch
            {
                Interlocked.Increment(ref failed);
            }
            finally
            {
                int d = Interlocked.Increment(ref done);
                progress?.Report(new MenuExportProgress(d, containers.Length, Volatile.Read(ref written)));
            }
        }).ConfigureAwait(false);

        return new MenuExportReport(containers.Length, written, failed, bytes, fullRoot);
    }
}

/// <summary>Avancement de l'export (conteneurs traités / total, PNG écrits jusqu'ici).</summary>
public readonly record struct MenuExportProgress(int Done, int Total, int PngWritten);
