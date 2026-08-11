using System.CommandLine;
using IECODE.Core;
using IECODE.Core.Cdn;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande cdn - sert n'importe quel fichier du jeu À LA DEMANDE depuis les CPK, sans dump.
/// Résout via cpk_list (index O(1)) puis extrait le seul fichier voulu d'un reader chaud.
/// </summary>
public static class CdnCommand
{
    public static Command Create()
    {
        var command = new Command("cdn", "Sert/résout des fichiers du jeu à la demande depuis les CPK (sans dump)");

        var gameOption = new Option<string?>(
            aliases: ["--game", "-g"],
            description: "Chemin du jeu (défaut : installation détectée)");

        // ── get : extraire un fichier ───────────────────────────────────────────
        var getCommand = new Command("get", "Extrait un fichier par son chemin logique (ex: data/common/...)");
        var pathArg = new Argument<string>("path", "Chemin logique du fichier (data/...) ou chemin azalee menu si --format png");
        getCommand.AddArgument(pathArg);
        getCommand.AddOption(gameOption);
        var outOption = new Option<string?>(["--output", "-o"], "Écrire le contenu vers ce fichier (sinon : métadonnées seules)");
        getCommand.AddOption(outOption);
        var formatOption = new Option<string?>(["--format", "-f"], "Format de sortie : 'raw' (défaut, octets natifs) ou 'png' (icône menu azalee, G4TX→PNG lossless)");
        getCommand.AddOption(formatOption);
        getCommand.SetHandler(GetAsync, pathArg, gameOption, outOption, formatOption);
        command.AddCommand(getCommand);

        // ── export : matérialiser le sous-arbre menu azalee en PNG ──────────────
        var exportCommand = new Command("export", "Exporte le sous-arbre dx11/menu/** en PNG lossless (arborescence nginx azalee)");
        var exportOutArg = new Argument<string>("output", "Dossier de sortie (neuf ; jamais sous la prod)");
        exportCommand.AddArgument(exportOutArg);
        exportCommand.AddOption(gameOption);
        var filterOption = new Option<string?>(["--filter"], () => null, "Sous-chaîne de chemin conteneur (ex: face, telop_waza/fr)");
        exportCommand.AddOption(filterOption);
        var overwriteOption = new Option<bool>(["--overwrite"], () => false, "Réécrire les PNG déjà présents (sinon reprise idempotente)");
        exportCommand.AddOption(overwriteOption);
        exportCommand.SetHandler(ExportAsync, exportOutArg, gameOption, filterOption, overwriteOption);
        command.AddCommand(exportCommand);

        // ── export-glb : matérialiser les modèles G4MG en GLB (arborescence nginx) ──
        var exportGlbCommand = new Command("export-glb", "Convertit chaque G4MG ayant un .g4md compagnon en GLB (idempotent)");
        var exportGlbOutArg = new Argument<string>("output", "Dossier de sortie des .glb (neuf ; jamais sous la prod)");
        exportGlbCommand.AddArgument(exportGlbOutArg);
        exportGlbCommand.AddOption(gameOption);
        var glbFilterOption = new Option<string?>(["--filter"], () => null, "Sous-chaîne de chemin g4mg (ex: _uniform, _face)");
        exportGlbCommand.AddOption(glbFilterOption);
        var glbLimitOption = new Option<int>(["--limit", "-n"], () => 0, "Nb max de modèles à exporter (0 = tous)");
        exportGlbCommand.AddOption(glbLimitOption);
        var glbOverwriteOption = new Option<bool>(["--overwrite"], () => false, "Réécrire les GLB déjà présents (sinon reprise idempotente)");
        exportGlbCommand.AddOption(glbOverwriteOption);
        var glbTexturesOption = new Option<bool>(["--textures", "-t"], () => false,
            "Embarquer la base-color réelle depuis le .g4tx compagnon (downscale + WebP)");
        exportGlbCommand.AddOption(glbTexturesOption);
        var glbMaxTexOption = new Option<int>(["--max-tex"], () => Core.Converters.TexturedModelExport.DefaultMaxTextureSize,
            "Côté max de la texture embarquée en px (0 = pas de downscale)");
        exportGlbCommand.AddOption(glbMaxTexOption);
        exportGlbCommand.SetHandler(ExportGlbAsync, exportGlbOutArg, gameOption, glbFilterOption, glbLimitOption, glbOverwriteOption, glbTexturesOption, glbMaxTexOption);
        command.AddCommand(exportGlbCommand);

        // ── ls : lister/compter les fichiers servables ──────────────────────────
        var lsCommand = new Command("ls", "Liste les fichiers servables (manifest), filtrable par sous-chaîne");
        var filterArg = new Argument<string?>("filter", () => null, "Sous-chaîne de chemin (optionnelle)");
        lsCommand.AddArgument(filterArg);
        lsCommand.AddOption(gameOption);
        var limitOption = new Option<int>(["--limit", "-n"], () => 50, "Nb max de lignes affichées");
        lsCommand.AddOption(limitOption);
        lsCommand.SetHandler(Ls, filterArg, gameOption, limitOption);
        command.AddCommand(lsCommand);

        return command;
    }

    private static async Task GetAsync(string path, string? gamePath, string? output, string? format)
    {
        using var game = new IEVRGame(gamePath);
        if (!game.IsValid)
        {
            Console.Error.WriteLine($"Erreur : jeu introuvable à {game.GamePath}");
            Environment.ExitCode = 1;
            return;
        }

        using var cdn = CdnFileService.FromGame(game);

        // ── format png : icône menu azalee (G4TX → PNG lossless) ────────────────
        if (string.Equals(format, "png", StringComparison.OrdinalIgnoreCase))
        {
            var pngSvc = new MenuPngService(cdn);
            MenuPng? rendered;
            try
            {
                rendered = await pngSvc.RenderAsync(path);
            }
            catch (KeyNotFoundException ex)
            {
                Console.Error.WriteLine($"Conteneur trouvé mais texture absente : {ex.Message}");
                Environment.ExitCode = 1;
                return;
            }
            if (rendered is not { } png)
            {
                Console.Error.WriteLine($"404 — conteneur menu introuvable pour : {path}");
                Environment.ExitCode = 1;
                return;
            }

            Console.WriteLine($"  Azalee     : {png.AzaleePath}");
            Console.WriteLine($"  Dimensions : {png.Width}×{png.Height} (PNG lossless, mip-0)");
            Console.WriteLine($"  Taille PNG : {png.Bytes.LongLength:N0} octets");
            Console.WriteLine($"  ETag       : {png.ETag}");
            if (!string.IsNullOrEmpty(output))
            {
                await File.WriteAllBytesAsync(output, png.Bytes);
                Console.WriteLine($"  → écrit    : {Path.GetFullPath(output)}");
            }
            return;
        }

        var file = await cdn.ReadAsync(path);
        if (file is not { } f)
        {
            Console.Error.WriteLine($"404 — introuvable dans cpk_list : {path}");
            Environment.ExitCode = 1;
            return;
        }

        Console.WriteLine($"  Chemin     : {f.Path}");
        Console.WriteLine($"  Taille     : {f.Size:N0} octets");
        Console.WriteLine($"  Media-type : {f.MediaType}");
        Console.WriteLine($"  ETag       : {f.ETag}");

        if (!string.IsNullOrEmpty(output))
        {
            await File.WriteAllBytesAsync(output, f.Bytes);
            Console.WriteLine($"  → écrit    : {Path.GetFullPath(output)}");
        }
    }

    private static async Task ExportAsync(string output, string? gamePath, string? filter, bool overwrite)
    {
        using var game = new IEVRGame(gamePath);
        if (!game.IsValid)
        {
            Console.Error.WriteLine($"Erreur : jeu introuvable à {game.GamePath}");
            Environment.ExitCode = 1;
            return;
        }

        using var cdn = CdnFileService.FromGame(game);
        var exporter = new MenuBatchExporter(cdn);

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var progress = new Progress<MenuExportProgress>(p =>
        {
            if (p.Done % 250 == 0 || p.Done == p.Total)
                Console.Error.Write($"\r  {p.Done:N0}/{p.Total:N0} conteneurs — {p.PngWritten:N0} PNG…   ");
        });

        var report = await exporter.ExportAsync(output, filter, overwrite, progress: progress);
        sw.Stop();
        Console.Error.WriteLine();
        Console.WriteLine($"  Conteneurs : {report.Containers:N0}" + (string.IsNullOrEmpty(filter) ? "" : $" (filtre « {filter} »)"));
        Console.WriteLine($"  PNG écrits : {report.PngWritten:N0}");
        Console.WriteLine($"  Échecs     : {report.Failed:N0}");
        Console.WriteLine($"  Octets     : {report.BytesWritten:N0}");
        Console.WriteLine($"  Sortie     : {report.OutputRoot}");
        Console.WriteLine($"  Durée      : {sw.Elapsed.TotalSeconds:N1}s");
        if (report.Failed > 0) Environment.ExitCode = 2;
    }

    /// <summary>
    /// Exporte les modèles G4MG (géométrie Level-5) en GLB. Pour chaque .g4mg du manifeste
    /// ayant un .g4md compagnon de MÊME chemin (basename), extrait la paire des CPK, fait
    /// g4mg→GLB et écrit &lt;out-dir&gt;/&lt;basename&gt;.glb à plat. Idempotent : saute les GLB déjà
    /// présents (sauf --overwrite). Le basename plat est celui du .g4mg (ex: u001105.glb),
    /// ce qui correspond au charaParamId/internal code attendu par le viewer azalee.
    /// </summary>
    private static async Task ExportGlbAsync(string output, string? gamePath, string? filter, int limit, bool overwrite,
        bool textures, int maxTex)
    {
        using var game = new IEVRGame(gamePath);
        if (!game.IsValid)
        {
            Console.Error.WriteLine($"Erreur : jeu introuvable à {game.GamePath}");
            Environment.ExitCode = 1;
            return;
        }

        using var cdn = CdnFileService.FromGame(game);

        // Index des .g4md par chemin-sans-extension (companion = même basename que le .g4mg).
        var g4mdByBase = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var g4mgPaths = new List<string>();
        foreach (var loc in cdn.All)
        {
            if (loc.Path.EndsWith(".g4md", StringComparison.OrdinalIgnoreCase))
                g4mdByBase.Add(loc.Path[..^5]);
            else if (loc.Path.EndsWith(".g4mg", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrEmpty(filter) || loc.Path.Contains(filter, StringComparison.OrdinalIgnoreCase))
                    g4mgPaths.Add(loc.Path);
            }
        }

        // Ne garder que les g4mg ayant un g4md compagnon, ordre stable.
        g4mgPaths.Sort(StringComparer.Ordinal);
        var candidates = g4mgPaths.Where(p => g4mdByBase.Contains(p[..^5])).ToList();

        Directory.CreateDirectory(output);

        var sw = System.Diagnostics.Stopwatch.StartNew();
        int written = 0, skipped = 0, empty = 0, failed = 0, processed = 0;
        long bytesWritten = 0;
        int target = limit > 0 ? Math.Min(limit, candidates.Count) : candidates.Count;

        Console.Error.WriteLine($"  {candidates.Count:N0} G4MG avec compagnon .g4md" +
            (string.IsNullOrEmpty(filter) ? "" : $" (filtre « {filter} »)") +
            (textures ? $" ; base-color ON (max {maxTex}px)" : "") +
            $" ; cible : {target:N0}");

        foreach (var g4mgPath in candidates)
        {
            if (limit > 0 && processed >= limit) break;
            processed++;

            var basename = Path.GetFileNameWithoutExtension(g4mgPath);
            var glbPath = Path.Combine(output, basename + ".glb");

            if (!overwrite && File.Exists(glbPath))
            {
                skipped++;
                continue;
            }

            try
            {
                var g4mgFile = await cdn.ReadAsync(g4mgPath).ConfigureAwait(false);
                var g4mdFile = await cdn.ReadAsync(g4mgPath[..^5] + ".g4md").ConfigureAwait(false);
                if (g4mgFile is not { } mg || g4mdFile is not { } md)
                {
                    failed++;
                    Console.Error.WriteLine($"\n  ✗ {g4mgPath} : extraction CPK échouée");
                    continue;
                }

                var g4md = new G4mdParser();
                g4md.Parse(md.Bytes);

                byte[]? glb;
                if (textures)
                {
                    // Le .g4tx base-color vit sous data/dx11/… (modèle sous data/common/…), même basename.
                    string g4txLogical = ResolveG4txLogicalPath(g4mgPath);
                    glb = Core.Converters.TexturedModelExport.BuildTexturedGlb(
                        mg.Bytes, g4md,
                        g4txProvider: () =>
                        {
                            // Extraction paresseuse du g4tx depuis les CPK (uniquement si UV présents).
                            var g4txFile = cdn.ReadAsync(g4txLogical).GetAwaiter().GetResult();
                            if (g4txFile is not { } tx)
                                return null;
                            return Core.Formats.Level5.G4txParser.ParseTextures(tx.Bytes);
                        },
                        out _, out _,
                        maxTextureSize: maxTex);
                }
                else
                {
                    glb = G4mgCommand.BuildGlb(mg.Bytes, g4md, out _);
                }

                if (glb is null)
                {
                    empty++;
                    continue;
                }

                await File.WriteAllBytesAsync(glbPath, glb).ConfigureAwait(false);
                written++;
                bytesWritten += glb.LongLength;
            }
            catch (Exception ex)
            {
                failed++;
                Console.Error.WriteLine($"\n  ✗ {g4mgPath} : {ex.Message}");
            }

            if (processed % 25 == 0 || processed == target)
                Console.Error.Write($"\r  {processed:N0}/{target:N0} — {written:N0} GLB, {skipped:N0} sautés, {empty:N0} vides, {failed:N0} échecs…   ");
        }
        sw.Stop();

        Console.Error.WriteLine();
        Console.WriteLine($"  Candidats  : {candidates.Count:N0}" + (string.IsNullOrEmpty(filter) ? "" : $" (filtre « {filter} »)"));
        Console.WriteLine($"  Traités    : {processed:N0}");
        Console.WriteLine($"  GLB écrits : {written:N0}");
        Console.WriteLine($"  Sautés     : {skipped:N0} (déjà présents)");
        Console.WriteLine($"  Vides      : {empty:N0} (aucune géométrie)");
        Console.WriteLine($"  Échecs     : {failed:N0}");
        Console.WriteLine($"  Octets     : {bytesWritten:N0}");
        Console.WriteLine($"  Sortie     : {Path.GetFullPath(output)}");
        Console.WriteLine($"  Durée      : {sw.Elapsed.TotalSeconds:N1}s");
        if (failed > 0) Environment.ExitCode = 2;
    }

    /// <summary>
    /// Chemin LOGIQUE (cpk_list) du .g4tx base-color compagnon d'un .g4mg. Convention IEVR
    /// vérifiée : modèle sous data/common/chr/… , texture sous data/dx11/chr/… , même basename
    /// (ex. data/common/chr/_uniform/u11130090/u11130090.g4mg →
    /// data/dx11/chr/_uniform/u11130090/u11130090.g4tx).
    /// </summary>
    private static string ResolveG4txLogicalPath(string g4mgLogicalPath)
    {
        string norm = g4mgLogicalPath.Replace('\\', '/');
        int idx = norm.IndexOf("/common/", StringComparison.OrdinalIgnoreCase);
        string p = idx >= 0
            ? norm[..idx] + "/dx11/" + norm[(idx + "/common/".Length)..]
            : norm;
        // .g4mg → .g4tx
        if (p.EndsWith(".g4mg", StringComparison.OrdinalIgnoreCase))
            p = p[..^5] + ".g4tx";
        return p;
    }

    private static void Ls(string? filter, string? gamePath, int limit)
    {
        using var game = new IEVRGame(gamePath);
        if (!game.IsValid)
        {
            Console.Error.WriteLine($"Erreur : jeu introuvable à {game.GamePath}");
            Environment.ExitCode = 1;
            return;
        }

        using var cdn = CdnFileService.FromGame(game);
        var all = cdn.All;
        if (!string.IsNullOrEmpty(filter))
            all = all.Where(l => l.Path.Contains(filter, StringComparison.OrdinalIgnoreCase));

        int shown = 0, total = 0;
        long bytes = 0;
        foreach (var loc in all)
        {
            total++;
            bytes += loc.Size;
            if (shown < limit)
            {
                Console.WriteLine($"  {loc.Size,12:N0}  {loc.CpkName,-20}  {loc.Path}");
                shown++;
            }
        }

        Console.WriteLine();
        Console.WriteLine($"  {total:N0} fichier(s) servable(s), {bytes:N0} octets (build {(string.IsNullOrEmpty(cdn.BuildId) ? "?" : cdn.BuildId)})");
        if (total > shown)
            Console.WriteLine($"  … {total - shown:N0} non affichés (--limit {limit})");
    }
}
