using System.CommandLine;
using IECODE.Core.Formats.Level5;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande "scene" — formats de scène/map Level-5 IEVR :
///   .objbin (placement d'objets de scène)  → cfg.bin T2B (réutilise CfgBin)
///   .col    (géométrie de collision)        → PXCL  (PxclParser)
///   .g4nv   (navigation mesh)               → NAVM  (NavmParser)
///
/// Découverte RE : le magic réel de .col est "PXCL" et celui de .g4nv est "NAVM" ;
/// .objbin n'a pas de magic propre — c'est un cfg.bin (footer 01 74 32 62).
/// </summary>
public static class SceneCommand
{
    public static Command Create()
    {
        var command = new Command("scene", "Formats de scène IEVR (.objbin/.col/.g4nv)");

        // ----- info -----
        var infoCommand = new Command("info", "Affiche les informations d'un fichier de scène");
        var infoFileArg = new Argument<string>("file", ".objbin / .col / .g4nv");
        infoCommand.AddArgument(infoFileArg);
        infoCommand.SetHandler(ShowInfo, infoFileArg);
        command.AddCommand(infoCommand);

        // ----- batch -----
        var batchCommand = new Command("batch", "Analyse en lot un répertoire de fichiers de scène");
        var batchDirArg = new Argument<string>("directory", "Répertoire à analyser");
        var recursiveOption = new Option<bool>(["--recursive", "-r"], "Recherche récursive");
        var extOption = new Option<string>(["--ext", "-e"], () => "all",
            "Extension à analyser : objbin | col | g4nv | all");
        batchCommand.AddArgument(batchDirArg);
        batchCommand.AddOption(recursiveOption);
        batchCommand.AddOption(extOption);
        batchCommand.SetHandler(BatchAnalyze, batchDirArg, recursiveOption, extOption);
        command.AddCommand(batchCommand);

        return command;
    }

    private static void ShowInfo(string file)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"Fichier introuvable : {file}");
            return;
        }

        try
        {
            var data = File.ReadAllBytes(file);
            var ext = Path.GetExtension(file).ToLowerInvariant();

            Console.WriteLine($"\nFichier : {Path.GetFileName(file)}");
            Console.WriteLine($"Taille  : {data.Length:N0} octets\n");

            if (PxclParser.IsPxcl(data) || ext == ".col")
            {
                Console.Write(PxclParser.Parse(data).GetSummary());
            }
            else if (NavmParser.IsNavm(data) || ext == ".g4nv")
            {
                Console.Write(NavmParser.Parse(data).GetSummary());
            }
            else if (ext == ".objbin" || CfgBin.HasValidFooter(data))
            {
                var cfg = new CfgBin();
                cfg.Open(data);
                Console.WriteLine("OBJBIN (cfg.bin T2B) scene object placement");
                Console.WriteLine($"  Root entries : {cfg.Entries.Count}");
                Console.WriteLine($"  Strings      : {cfg.Strings.Count}");
                Console.WriteLine($"  Total nodes  : {CountEntries(cfg.Entries)}");
            }
            else
            {
                Console.Error.WriteLine("Format de scène non reconnu (ni PXCL, ni NAVM, ni cfg.bin).");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Erreur : {ex.Message}");
        }
    }

    private static int CountEntries(IEnumerable<Entry> entries)
    {
        int n = 0;
        foreach (var e in entries)
        {
            n++;
            n += CountEntries(e.Children);
        }
        return n;
    }

    private static void BatchAnalyze(string directory, bool recursive, string ext)
    {
        if (!Directory.Exists(directory))
        {
            Console.Error.WriteLine($"Répertoire introuvable : {directory}");
            return;
        }

        var searchOption = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        var exts = ext.ToLowerInvariant() switch
        {
            "objbin" => new[] { "*.objbin" },
            "col" => new[] { "*.col" },
            "g4nv" => new[] { "*.g4nv" },
            _ => new[] { "*.objbin", "*.col", "*.g4nv" },
        };

        int objbin = 0, col = 0, g4nv = 0, errors = 0;
        foreach (var pattern in exts)
        {
            foreach (var f in Directory.EnumerateFiles(directory, pattern, searchOption))
            {
                try
                {
                    var data = File.ReadAllBytes(f);
                    var e = Path.GetExtension(f).ToLowerInvariant();
                    if (PxclParser.IsPxcl(data) || e == ".col") { PxclParser.Parse(data); col++; }
                    else if (NavmParser.IsNavm(data) || e == ".g4nv") { NavmParser.Parse(data); g4nv++; }
                    else if (e == ".objbin" || CfgBin.HasValidFooter(data))
                    {
                        var cfg = new CfgBin();
                        cfg.Open(data);
                        objbin++;
                    }
                }
                catch
                {
                    errors++;
                }
            }
        }

        Console.WriteLine($"\nRésultat batch ({directory}) :");
        Console.WriteLine($"  .objbin (cfg.bin) parsés : {objbin}");
        Console.WriteLine($"  .col    (PXCL)    parsés : {col}");
        Console.WriteLine($"  .g4nv   (NAVM)    parsés : {g4nv}");
        Console.WriteLine($"  Total parsés             : {objbin + col + g4nv}");
        if (errors > 0) Console.WriteLine($"  Erreurs                  : {errors}");
    }
}
