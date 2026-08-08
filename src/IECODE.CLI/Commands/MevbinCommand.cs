using System.CommandLine;
using System.Diagnostics.CodeAnalysis;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande <c>mevbin</c> — parse les fichiers Motion Event Binary (.mevbin)
/// des personnages (<c>data/common/chr/cXXXXXX/cXXXXXX_pNNN.mevbin</c>).
///
/// Le format est un cfg.bin T2B ; le décodage binaire est délégué à
/// <see cref="CfgBinDocument"/> et la sémantique COUNT/MOT/EVENT à
/// <see cref="MevbinDocument"/>.
/// </summary>
public static class MevbinCommand
{
    public static Command Create()
    {
        var command = new Command("mevbin", "Parse les fichiers Motion Event Binary (.mevbin)");

        command.AddCommand(CreateInfo());
        command.AddCommand(CreateDecode());
        command.AddCommand(CreateBatch());

        return command;
    }

    // ── mevbin info ───────────────────────────────────────────────────────────

    private static Command CreateInfo()
    {
        var cmd = new Command("info", "Affiche un résumé d'un .mevbin");
        var fileArg = new Argument<string>("file", "Chemin du fichier .mevbin");
        cmd.AddArgument(fileArg);
        cmd.SetHandler((string file) => Info(file), fileArg);
        return cmd;
    }

    [RequiresUnreferencedCode("MevbinDocument.DecodeFile repose sur CfgBin.")]
    private static void Info(string file)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"Erreur : fichier introuvable : {file}");
            Environment.ExitCode = 1;
            return;
        }

        try
        {
            var doc = MevbinDocument.DecodeFile(file);
            Console.WriteLine($"Fichier      : {Path.GetFileName(file)}");
            Console.WriteLine($"Motions      : {doc.MotionCount} (en-tête) / {doc.Motions.Count} (extraites)");
            Console.WriteLine($"Événements   : {doc.EventCount} (en-tête) / {doc.ParsedEventCount} (extraits)");
            Console.WriteLine();
            int shown = 0;
            foreach (var m in doc.Motions)
            {
                Console.WriteLine($"  MOT 0x{m.Hash:X8} — {m.Events.Count} événement(s)");
                if (++shown >= 12)
                {
                    Console.WriteLine($"  ... et {doc.Motions.Count - shown} motion(s) de plus");
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Erreur : {ex.Message}");
            Environment.ExitCode = 1;
        }
    }

    // ── mevbin decode ─────────────────────────────────────────────────────────

    private static Command CreateDecode()
    {
        var cmd = new Command("decode", "Décode un .mevbin en JSON {motions:[{hash,events:[{time,type,param}]}]}");
        var fileArg = new Argument<string>("file", "Chemin du fichier .mevbin");
        var outputOpt = new Option<string?>(aliases: ["--output", "-o"], description: "Fichier JSON de sortie");
        cmd.AddArgument(fileArg);
        cmd.AddOption(outputOpt);
        cmd.SetHandler((string file, string? output) => Decode(file, output), fileArg, outputOpt);
        return cmd;
    }

    [RequiresUnreferencedCode("MevbinDocument.DecodeFile repose sur CfgBin.")]
    private static void Decode(string file, string? output)
    {
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"Erreur : fichier introuvable : {file}");
            Environment.ExitCode = 1;
            return;
        }

        try
        {
            var doc = MevbinDocument.DecodeFile(file);
            string json = doc.ToJson(indented: true);

            if (!string.IsNullOrEmpty(output))
            {
                File.WriteAllText(output, json, new System.Text.UTF8Encoding(false));
                Console.WriteLine($"Exporté vers : {output}");
            }
            else
            {
                Console.WriteLine(json);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Erreur : {ex.Message}");
            Environment.ExitCode = 1;
        }
    }

    // ── mevbin batch ──────────────────────────────────────────────────────────

    private static Command CreateBatch()
    {
        var cmd = new Command("batch", "Parse tous les .mevbin d'un répertoire et compte motions/événements");
        var dirArg = new Argument<string>("directory", "Répertoire à scanner");
        var recursiveOpt = new Option<bool>(aliases: ["--recursive", "-r"], description: "Récursif") { };
        recursiveOpt.SetDefaultValue(true);
        var jsonOpt = new Option<string?>(aliases: ["--json-dir", "-j"], description: "Répertoire où écrire un .json par fichier");
        cmd.AddArgument(dirArg);
        cmd.AddOption(recursiveOpt);
        cmd.AddOption(jsonOpt);
        cmd.SetHandler((string dir, bool recursive, string? jsonDir) => Batch(dir, recursive, jsonDir),
            dirArg, recursiveOpt, jsonOpt);
        return cmd;
    }

    [RequiresUnreferencedCode("MevbinDocument.DecodeFile repose sur CfgBin.")]
    private static void Batch(string dir, bool recursive, string? jsonDir)
    {
        if (!Directory.Exists(dir))
        {
            Console.Error.WriteLine($"Erreur : répertoire introuvable : {dir}");
            Environment.ExitCode = 1;
            return;
        }

        var opt = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        var files = Directory.EnumerateFiles(dir, "*.mevbin", opt).OrderBy(f => f).ToList();

        if (files.Count == 0)
        {
            Console.WriteLine("Aucun fichier .mevbin trouvé.");
            return;
        }

        if (!string.IsNullOrEmpty(jsonDir))
            Directory.CreateDirectory(jsonDir);

        int ok = 0, fail = 0;
        long totalMotions = 0, totalEvents = 0;
        var errors = new List<string>();

        foreach (var file in files)
        {
            try
            {
                var doc = MevbinDocument.DecodeFile(file);
                ok++;
                totalMotions += doc.Motions.Count;
                totalEvents += doc.ParsedEventCount;

                if (!string.IsNullOrEmpty(jsonDir))
                {
                    string outPath = Path.Combine(jsonDir, Path.GetFileName(file) + ".json");
                    File.WriteAllText(outPath, doc.ToJson(indented: false), new System.Text.UTF8Encoding(false));
                }
            }
            catch (Exception ex)
            {
                fail++;
                errors.Add($"{Path.GetFileName(file)} : {ex.Message}");
            }
        }

        Console.WriteLine($"Fichiers .mevbin    : {files.Count}");
        Console.WriteLine($"  Parsés OK         : {ok}");
        Console.WriteLine($"  Échecs            : {fail}");
        Console.WriteLine($"  Motions totales   : {totalMotions:N0}");
        Console.WriteLine($"  Événements totaux : {totalEvents:N0}");

        if (errors.Count > 0)
        {
            Console.WriteLine();
            Console.WriteLine("Erreurs :");
            foreach (var e in errors.Take(20))
                Console.WriteLine($"  - {e}");
            if (errors.Count > 20)
                Console.WriteLine($"  ... et {errors.Count - 20} de plus");
            Environment.ExitCode = 1;
        }
    }
}
