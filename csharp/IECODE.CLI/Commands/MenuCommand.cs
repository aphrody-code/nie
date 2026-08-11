using System.CommandLine;
using IECODE.Core;
using IECODE.Core.Cdn;
using IECODE.Core.Util;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande <c>menu</c> — exporte un écran de menu du jeu en <c>menu-layout.json</c> (+ PNG des
/// sprites) pour le reproduire pixel-perfect dans azalee (<c>@rose-griffon/menu-render</c>).
/// Combine l'arbre OBJB, les transforms G4PKM, les sprites lossless et le texte localisé.
/// </summary>
public static class MenuCommand
{
    public static Command Create()
    {
        var command = new Command("menu", "Exporte les écrans de menu (layout JSON + sprites PNG) pour azalee");

        var gameOption = new Option<string?>(["--game", "-g"], "Chemin du jeu (défaut : install détectée)");

        var exportCommand = new Command("export", "Exporte un écran (ex: 50_title, 100_mainmenu) en menu-layout.json");
        var screenArg = new Argument<string>("screen", "Id d'écran = dossier dx11/menu (ex: 50_title, 108_option, 100_mainmenu)");
        exportCommand.AddArgument(screenArg);
        exportCommand.AddOption(gameOption);
        var localeOption = new Option<string>(["--locale", "-l"], () => "fr", "Locale (en/fr/de/it/es/pt/ja/zh_hans/zh_hant)");
        exportCommand.AddOption(localeOption);
        var outOption = new Option<string>(["--out", "-o"], () => "./menu-export", "Dossier de sortie (layout.json + assets/)");
        exportCommand.AddOption(outOption);
        exportCommand.SetHandler(ExportAsync, screenArg, gameOption, localeOption, outOption);
        command.AddCommand(exportCommand);

        return command;
    }

    private static async Task ExportAsync(string screen, string? gamePath, string locale, string outDir)
    {
        using var game = new IEVRGame(gamePath);
        if (!game.IsValid)
        {
            Console.Error.WriteLine($"Erreur : jeu introuvable à {game.GamePath}");
            Environment.ExitCode = 1;
            return;
        }

        Directory.CreateDirectory(outDir);
        var assetsDir = Path.Combine(outDir, "assets");

        using var cdn = CdnFileService.FromGame(game);
        var exporter = new MenuLayoutExporter(cdn);

        // Dico de hash (C) : résout caméra/motion/texte. Le transform G4PKM (B) est lu dans l'exporteur.
        var dictPath = Path.Combine(Directory.GetCurrentDirectory(), "re", "menu", "hash-dictionary.json");
        if (File.Exists(dictPath))
        {
            var dict = Level5HashDictionary.Load(dictPath);
            exporter.HashResolver = dict.Resolve;
            Console.Error.WriteLine($"# dico de hash chargé ({dictPath})");
        }

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var layout = await exporter.ExportScreenAsync(screen, locale, assetsDir);
        sw.Stop();

        var jsonPath = Path.Combine(outDir, $"{screen}.json");
        await File.WriteAllTextAsync(jsonPath, MenuLayoutExporter.ToJson(layout));

        int withSprite = layout.Objects.Count(o => o.Sprite is not null);
        int withText = layout.Objects.Count(o => o.Text is not null);
        Console.WriteLine($"  Écran      : {screen} (locale {locale})");
        Console.WriteLine($"  Objets     : {layout.Objects.Count:N0}  (sprites {withSprite}, textes {withText})");
        Console.WriteLine($"  Layout     : {Path.GetFullPath(jsonPath)}");
        Console.WriteLine($"  Assets PNG : {Path.GetFullPath(assetsDir)}");
        Console.WriteLine($"  Durée      : {sw.Elapsed.TotalSeconds:N1}s");
        if (layout.Objects.Count == 0)
            Console.Error.WriteLine("  ⚠ Aucun objet — l'id d'écran correspond-il à un dossier dx11/menu/<screen>/ ?");
    }
}
