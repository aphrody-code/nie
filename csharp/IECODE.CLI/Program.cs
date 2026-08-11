using System.CommandLine;
using System.Diagnostics.CodeAnalysis;
using IECODE.CLI.Commands;

namespace IECODE.CLI;

/// <summary>
/// Point d'entrée CLI pour IECODE.
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var rootCommand = new RootCommand("IECODE - Inazuma Eleven Victory Road Reverse Engineering Toolkit")
        {
            Name = "iecode"
        };

        // Global options
        var gamePathOption = new Option<string?>(
            aliases: ["--game", "-g"],
            description: "Path to IEVR game directory (default: Steam install path)")
        {
            IsRequired = false
        };
        rootCommand.AddGlobalOption(gamePathOption);

        var verboseOption = new Option<bool>(
            aliases: ["--verbose", "-v"],
            description: "Enable verbose output");
        rootCommand.AddGlobalOption(verboseOption);

        // Add commands
        rootCommand.AddCommand(CreateInfoCommand(gamePathOption, verboseOption));
        rootCommand.AddCommand(CreateDownloadCommand(verboseOption));
        rootCommand.AddCommand(CreateSteamBuildCommand());
        rootCommand.AddCommand(CreateSyncCommand(verboseOption));
        rootCommand.AddCommand(CreateDumpCommand(gamePathOption, verboseOption));
        rootCommand.AddCommand(CreateExtractCommand(gamePathOption, verboseOption));
        rootCommand.AddCommand(CreatePackCommand(gamePathOption, verboseOption));
        rootCommand.AddCommand(CreateConfigCommand(gamePathOption, verboseOption));
        rootCommand.AddCommand(CreateCfgShorthandCommand());
        rootCommand.AddCommand(CreateCryptoCommand(verboseOption));
        rootCommand.AddCommand(CreateAnalyzeCommand(gamePathOption, verboseOption));
        rootCommand.AddCommand(CreatePipelineCommand(gamePathOption, verboseOption));
        rootCommand.AddCommand(BenchmarkCommand.Create());
        rootCommand.AddCommand(CdnCommand.Create());
        rootCommand.AddCommand(MemCommand.Create());
        rootCommand.AddCommand(G4txCommand.Create());
        rootCommand.AddCommand(G4pkCommand.Create());
        rootCommand.AddCommand(G4mdCommand.Create());
        rootCommand.AddCommand(G4mgCommand.Create());
        rootCommand.AddCommand(UtfCommand.Create());
        rootCommand.AddCommand(AudioCommand.Create());
        rootCommand.AddCommand(UsmCommand.Create());
        rootCommand.AddCommand(SceneCommand.Create());
        rootCommand.AddCommand(SearchCommand.Create());
        rootCommand.AddCommand(DumpGameDataCommand.Create());
        rootCommand.AddCommand(GenerateGameDataClassesCommand.Create());
        rootCommand.AddCommand(ConvertCommand.Create());
        rootCommand.AddCommand(FormatCommand.Create());
        rootCommand.AddCommand(ExportKnowledgeCommand.Create());
        rootCommand.AddCommand(G4raCommand.Create());
        rootCommand.AddCommand(P3lipCommand.Create());
        rootCommand.AddCommand(AgiCommand.Create());
        rootCommand.AddCommand(LuaCommand.Create());
        rootCommand.AddCommand(MenuCommand.Create());
        rootCommand.AddCommand(MevbinCommand.Create());
        rootCommand.AddCommand(ShaderCommand.Create());
        rootCommand.AddCommand(CreatePassiveSkillCommand(gamePathOption, verboseOption));

        // Temporary test command
        var testG4skCommand = new Command("test-g4sk", "Test G4SK parser");
        var fileArg = new Argument<string>("file", "Path to G4SK file");
        testG4skCommand.AddArgument(fileArg);
        testG4skCommand.SetHandler((string file) => TestG4sk.Run(file), fileArg);
        rootCommand.AddCommand(testG4skCommand);

        return await rootCommand.InvokeAsync(args);
    }

    private static Command CreateInfoCommand(Option<string?> gamePathOption, Option<bool> verboseOption)
    {
        var command = new Command("info", "Display game information");

        var jsonOption = new Option<bool>("--json", "Output as JSON");
        command.AddOption(jsonOption);

        command.SetHandler(async (string? gamePath, bool verbose, bool json) =>
        {
            await InfoCommand.ExecuteAsync(gamePath, verbose, json);
        }, gamePathOption, verboseOption, jsonOption);

        return command;
    }

    private static Command CreateDownloadCommand(Option<bool> verboseOption)
    {
        var command = new Command("download", "Télécharge une app Steam nativement (depots → disque, sans steamcmd)");

        var appIdArg = new Argument<uint>("appid", "Steam App ID (ex. 2799860 pour IEVR)");
        command.AddArgument(appIdArg);

        var outputOption = new Option<string?>(["--output", "-o"], "Répertoire d'installation cible (requis sauf --list)");
        command.AddOption(outputOption);

        var userOption = new Option<string?>(["--user", "-u"], "Compte Steam possédant l'app (défaut: STEAM_USER, sinon anonyme)");
        command.AddOption(userOption);
        var passwordOption = new Option<string?>(["--password", "-p"], "Mot de passe (défaut: STEAM_PASSWORD ; inutile si refresh token caché)");
        command.AddOption(passwordOption);
        var guardOption = new Option<string?>("--guard", "Code Steam Guard 2FA (défaut: STEAM_GUARD_CODE ; sinon saisie interactive)");
        command.AddOption(guardOption);
        var branchOption = new Option<string>("--branch", () => "public", "Branche à télécharger");
        command.AddOption(branchOption);
        var osOption = new Option<string>("--os", () => "windows", "OS ciblé (windows/macos/linux)");
        command.AddOption(osOption);
        var allPlatformsOption = new Option<bool>("--all-platforms", "Télécharge tous les depots (pas de filtre OS/arch/langue)");
        command.AddOption(allPlatformsOption);
        var depotOption = new Option<uint[]>("--depot", "Restreint à ces depot ID (répétable)") { AllowMultipleArgumentsPerToken = true };
        command.AddOption(depotOption);
        var threadsOption = new Option<int>(["--threads", "-t"], () => IECODE.Core.Runtime.HostProfile.Parallelism, "Chunks téléchargés en parallèle (défaut ajusté à la charge du VPS)");
        command.AddOption(threadsOption);
        var tokenStoreOption = new Option<string?>("--token-store", "Fichier JSON de cache des jetons (re-login sans 2FA)");
        command.AddOption(tokenStoreOption);
        var listOption = new Option<bool>("--list", "Inspecte les depots/manifests/tailles sans télécharger");
        command.AddOption(listOption);

        command.SetHandler(async context =>
        {
            var p = context.ParseResult;
            await DownloadCommand.ExecuteAsync(
                p.GetValueForArgument(appIdArg),
                p.GetValueForOption(outputOption) ?? ".",
                p.GetValueForOption(userOption) ?? Environment.GetEnvironmentVariable("STEAM_USER"),
                p.GetValueForOption(passwordOption) ?? Environment.GetEnvironmentVariable("STEAM_PASSWORD"),
                p.GetValueForOption(guardOption),
                p.GetValueForOption(branchOption)!,
                p.GetValueForOption(osOption)!,
                p.GetValueForOption(allPlatformsOption),
                p.GetValueForOption(depotOption) ?? [],
                p.GetValueForOption(threadsOption),
                p.GetValueForOption(tokenStoreOption),
                p.GetValueForOption(listOption),
                p.GetValueForOption(verboseOption));
        });

        return command;
    }

    private static Command CreateSteamBuildCommand()
    {
        var command = new Command("steam-build", "Affiche le buildid Steam courant d'une app (détection de mise à jour, login + app info seulement)");
        var appIdArg = new Argument<uint>("appid", "Steam App ID");
        command.AddArgument(appIdArg);
        var userOption = new Option<string?>(["--user", "-u"], "Compte Steam (défaut: STEAM_USER)");
        command.AddOption(userOption);
        var passwordOption = new Option<string?>(["--password", "-p"], "Mot de passe (défaut: STEAM_PASSWORD)");
        command.AddOption(passwordOption);
        var guardOption = new Option<string?>("--guard", "Code Steam Guard (défaut: STEAM_GUARD_CODE)");
        command.AddOption(guardOption);
        var branchOption = new Option<string>("--branch", () => "public", "Branche");
        command.AddOption(branchOption);
        var tokenStoreOption = new Option<string?>("--token-store", "Cache des jetons");
        command.AddOption(tokenStoreOption);
        var jsonOption = new Option<bool>("--json", "Sortie JSON");
        command.AddOption(jsonOption);

        command.SetHandler(async context =>
        {
            var p = context.ParseResult;
            await DownloadCommand.PrintBuildIdAsync(
                p.GetValueForArgument(appIdArg),
                p.GetValueForOption(userOption) ?? Environment.GetEnvironmentVariable("STEAM_USER"),
                p.GetValueForOption(passwordOption) ?? Environment.GetEnvironmentVariable("STEAM_PASSWORD"),
                p.GetValueForOption(guardOption),
                p.GetValueForOption(branchOption)!,
                p.GetValueForOption(tokenStoreOption),
                p.GetValueForOption(jsonOption));
        });
        return command;
    }

    private static Command CreateSyncCommand(Option<bool> verboseOption)
    {
        var command = new Command("sync", "Pipeline natif complet : download Steam + dump CPK sélectif (remplace steamcmd)");

        var appOption = new Option<uint>("--app", () => 2799860, "Steam App ID (défaut: IEVR)");
        command.AddOption(appOption);
        var installOption = new Option<string?>("--install", "Répertoire d'install du download (défaut: <output>/.steam)");
        command.AddOption(installOption);
        var outputOption = new Option<string>(["--output", "-o"], "Répertoire de sortie du dump") { IsRequired = true };
        command.AddOption(outputOption);
        var presetOption = new Option<string?>(["--preset", "-P"], () => "inagle-azalee", $"Preset de dump ({IECODE.Core.Dump.DumpPresets.Names})");
        command.AddOption(presetOption);
        var userOption = new Option<string?>(["--user", "-u"], "Compte Steam (défaut: STEAM_USER)");
        command.AddOption(userOption);
        var passwordOption = new Option<string?>(["--password", "-p"], "Mot de passe (défaut: STEAM_PASSWORD)");
        command.AddOption(passwordOption);
        var guardOption = new Option<string?>("--guard", "Code Steam Guard 2FA (défaut: STEAM_GUARD_CODE)");
        command.AddOption(guardOption);
        var branchOption = new Option<string>("--branch", () => "public", "Branche à télécharger");
        command.AddOption(branchOption);
        var osOption = new Option<string>("--os", () => "windows", "OS ciblé");
        command.AddOption(osOption);
        var threadsOption = new Option<int>(["--threads", "-t"], () => IECODE.Core.Runtime.HostProfile.Parallelism, "Parallélisme (défaut ajusté à la charge du VPS)");
        command.AddOption(threadsOption);
        var tokenStoreOption = new Option<string?>("--token-store", "Fichier JSON de cache des jetons");
        command.AddOption(tokenStoreOption);
        var skipDownloadOption = new Option<bool>("--skip-download", "Ne télécharge pas ; dump l'install existante");
        command.AddOption(skipDownloadOption);

        command.SetHandler(async context =>
        {
            var p = context.ParseResult;
            var output = p.GetValueForOption(outputOption)!;
            var install = p.GetValueForOption(installOption) ?? Path.Combine(output, ".steam");
            await SyncCommand.ExecuteAsync(
                p.GetValueForOption(appOption),
                install,
                output,
                p.GetValueForOption(presetOption),
                p.GetValueForOption(userOption) ?? Environment.GetEnvironmentVariable("STEAM_USER"),
                p.GetValueForOption(passwordOption) ?? Environment.GetEnvironmentVariable("STEAM_PASSWORD"),
                p.GetValueForOption(guardOption),
                p.GetValueForOption(branchOption)!,
                p.GetValueForOption(osOption)!,
                p.GetValueForOption(threadsOption),
                p.GetValueForOption(tokenStoreOption),
                p.GetValueForOption(skipDownloadOption),
                p.GetValueForOption(verboseOption));
        });

        return command;
    }

    private static Command CreateDumpCommand(Option<string?> gamePathOption, Option<bool> verboseOption)
    {
        var command = new Command("dump", "Dump game files (tous les CPK, ou sélection via --include/--preset ; parallélisé, reprise smart)");

        var outputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory")
        {
            IsRequired = true
        };
        command.AddOption(outputOption);

        var smartOption = new Option<bool>(
            aliases: ["--smart", "-s"],
            getDefaultValue: () => true,
            description: "Smart dump (skip existing files, resume interrupted dumps)");
        command.AddOption(smartOption);

        var threadsOption = new Option<int>(
            aliases: ["--threads", "-t"],
            getDefaultValue: () => Environment.ProcessorCount,
            description: "Number of parallel threads");
        command.AddOption(threadsOption);

        var noLooseOption = new Option<bool>(
            "--no-loose",
            description: "Don't copy loose files (cfg.bin, ini, etc.)");
        command.AddOption(noLooseOption);

        var includeOption = new Option<string?>(
            aliases: ["--include", "-i"],
            description: "Glob(s) de chemins internes à dumper, séparés par des virgules (ex: \"common/**,menu/**\"). Seuls les CPK contenant un match sont extraits.");
        command.AddOption(includeOption);

        var presetOption = new Option<string?>(
            aliases: ["--preset", "-p"],
            description: $"Preset de sélection ({IECODE.Core.Dump.DumpPresets.Names}). Ignoré si --include est fourni.");
        command.AddOption(presetOption);

        var maxDiskOption = new Option<string?>(
            "--max-disk",
            description: "Plafond d'écriture décompressée (ex: 30G, 500M). En plus du garde-fou de partition. Défaut: budget réel de la partition.");
        command.AddOption(maxDiskOption);

        var noSpaceCheckOption = new Option<bool>(
            "--no-space-check",
            description: "Désactive le contrôle d'espace disque (force le dump au risque de saturer le disque).");
        command.AddOption(noSpaceCheckOption);

        command.SetHandler(async (context) =>
        {
            var gamePath = context.ParseResult.GetValueForOption(gamePathOption);
            var verbose = context.ParseResult.GetValueForOption(verboseOption);
            var output = context.ParseResult.GetValueForOption(outputOption)!;
            var smart = context.ParseResult.GetValueForOption(smartOption);
            var threads = context.ParseResult.GetValueForOption(threadsOption);
            var noLoose = context.ParseResult.GetValueForOption(noLooseOption);
            var include = context.ParseResult.GetValueForOption(includeOption);
            var preset = context.ParseResult.GetValueForOption(presetOption);
            var maxDisk = context.ParseResult.GetValueForOption(maxDiskOption);
            var noSpaceCheck = context.ParseResult.GetValueForOption(noSpaceCheckOption);

            // --include (globs bruts) prioritaire ; sinon résolution du preset nommé.
            var fileFilter = !string.IsNullOrWhiteSpace(include)
                ? include
                : IECODE.Core.Dump.DumpPresets.Resolve(preset);

            await DumpCommand.ExecuteAsync(
                gamePath, output, smart, verbose, threads, !noLoose, fileFilter,
                DumpCommand.ParseSize(maxDisk), noSpaceCheck);
        });

        return command;
    }

    private static Command CreateExtractCommand(Option<string?> gamePathOption, Option<bool> verboseOption)
    {
        var command = new Command("extract", "Extract files from a CPK archive");

        var cpkArgument = new Argument<string>("cpk", "Path to CPK file");
        command.AddArgument(cpkArgument);

        var outputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory")
        {
            IsRequired = true
        };
        command.AddOption(outputOption);

        var filterOption = new Option<string?>("--filter", "File filter pattern (e.g., *.g4tx)");
        command.AddOption(filterOption);

        var listOption = new Option<bool>("--list", "List files only, don't extract");
        command.AddOption(listOption);

        command.SetHandler(async (string? gamePath, bool verbose, string cpk, string output, string? filter, bool list) =>
        {
            await ExtractCommand.ExecuteAsync(gamePath, cpk, output, filter, list, verbose);
        }, gamePathOption, verboseOption, cpkArgument, outputOption, filterOption, listOption);

        return command;
    }

    private static Command CreatePackCommand(Option<string?> gamePathOption, Option<bool> verboseOption)
    {
        var command = new Command("pack", "Pack a mod folder for IEVR");

        var inputArgument = new Argument<string>("input", "Mod folder to pack");
        command.AddArgument(inputArgument);

        var outputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory")
        {
            IsRequired = true
        };
        command.AddOption(outputOption);

        var cpkListOption = new Option<string?>("--cpklist", "Path to cpk_list.cfg.bin (default: from game)");
        command.AddOption(cpkListOption);

        var platformOption = new Option<string>("--platform", () => "PC", "Target platform (PC or SWITCH)");
        command.AddOption(platformOption);

        command.SetHandler(async (string? gamePath, bool verbose, string input, string output, string? cpkList, string platform) =>
        {
            await PackCommand.ExecuteAsync(gamePath, input, output, cpkList, platform, verbose);
        }, gamePathOption, verboseOption, inputArgument, outputOption, cpkListOption, platformOption);

        return command;
    }

    private static Command CreateConfigCommand(Option<string?> gamePathOption, Option<bool> verboseOption)
    {
        var command = new Command("config", "Read/write cfg.bin configuration files");

        // Subcommand: read
        var readCommand = new Command("read", "Read a cfg.bin file and export to JSON");
        var readFileArg = new Argument<string>("file", "Path to cfg.bin file");
        readCommand.AddArgument(readFileArg);
        var readOutputOption = new Option<string?>(["--output", "-o"], "Output JSON file");
        readCommand.AddOption(readOutputOption);

        readCommand.SetHandler(async (string? gamePath, bool verbose, string file, string? output) =>
        {
            await ConfigCommand.ReadAsync(gamePath, file, output, verbose);
        }, gamePathOption, verboseOption, readFileArg, readOutputOption);

        command.AddCommand(readCommand);

        // Subcommand: info
        var infoCommand = new Command("info", "Show cfg.bin file information");
        var infoFileArg = new Argument<string>("file", "Path to cfg.bin file");
        infoCommand.AddArgument(infoFileArg);

        infoCommand.SetHandler(async (string? gamePath, bool verbose, string file) =>
        {
            await ConfigCommand.InfoAsync(gamePath, file, verbose);
        }, gamePathOption, verboseOption, infoFileArg);

        command.AddCommand(infoCommand);

        // Subcommand: cpklist
        var cpkListCommand = new Command("cpklist", "Read cpk_list.cfg.bin from game");
        var cpkListOutputOption = new Option<string?>(["--output", "-o"], "Output JSON file");
        cpkListCommand.AddOption(cpkListOutputOption);

        cpkListCommand.SetHandler(async (string? gamePath, bool verbose, string? output) =>
        {
            await ConfigCommand.ReadCpkListAsync(gamePath, output, verbose);
        }, gamePathOption, verboseOption, cpkListOutputOption);

        command.AddCommand(cpkListCommand);

        // Subcommand: list
        var listCommand = new Command("list", "List all cfg.bin files in game");

        listCommand.SetHandler(async (string? gamePath, bool verbose) =>
        {
            await ConfigCommand.ListAsync(gamePath, verbose);
        }, gamePathOption, verboseOption);

        command.AddCommand(listCommand);

        // Subcommand: search
        var searchCommand = new Command("search", "Search entries in a cfg.bin file");
        var searchFileArg = new Argument<string>("file", "Path to cfg.bin file");
        searchCommand.AddArgument(searchFileArg);
        var patternArg = new Argument<string>("pattern", "Search pattern");
        searchCommand.AddArgument(patternArg);

        searchCommand.SetHandler(async (string? gamePath, bool verbose, string file, string pattern) =>
        {
            await ConfigCommand.SearchAsync(gamePath, file, pattern, verbose);
        }, gamePathOption, verboseOption, searchFileArg, patternArg);

        command.AddCommand(searchCommand);

        // Subcommand: decrypt
        var decryptCommand = new Command("decrypt", "Decrypt a cfg.bin file");
        var decryptFileArg = new Argument<string>("file", "Path to encrypted cfg.bin file");
        decryptCommand.AddArgument(decryptFileArg);
        var decryptOutputOption = new Option<string?>(["--output", "-o"], "Output file (default: <file>.dec)");
        decryptCommand.AddOption(decryptOutputOption);

        decryptCommand.SetHandler(async (bool verbose, string file, string? output) =>
        {
            await ConfigCommand.DecryptAsync(file, output, verbose);
        }, verboseOption, decryptFileArg, decryptOutputOption);

        command.AddCommand(decryptCommand);

        // Subcommand: encrypt
        var encryptCommand = new Command("encrypt", "Encrypt a cfg.bin file");
        var encryptFileArg = new Argument<string>("file", "Path to cfg.bin file");
        encryptCommand.AddArgument(encryptFileArg);
        var keyNameOption = new Option<string?>(["--key", "-k"], "Key name for encryption (default: filename)");
        encryptCommand.AddOption(keyNameOption);
        var encryptOutputOption = new Option<string?>(["--output", "-o"], "Output file (default: <file>.enc)");
        encryptCommand.AddOption(encryptOutputOption);

        encryptCommand.SetHandler(async (bool verbose, string file, string? keyName, string? output) =>
        {
            await ConfigCommand.EncryptAsync(file, keyName, output, verbose);
        }, verboseOption, encryptFileArg, keyNameOption, encryptOutputOption);

        command.AddCommand(encryptCommand);

        // Subcommand: convert (batch conversion)
        var convertCommand = new Command("convert", "Convert cfg.bin files to JSON (recursive, smallest first)");
        var convertPathArg = new Argument<string>("path", "Path to cfg.bin file or directory");
        convertCommand.AddArgument(convertPathArg);
        var convertRecursiveOption = new Option<bool>(["--recursive", "-r"], "Process directories recursively");
        convertCommand.AddOption(convertRecursiveOption);

        convertCommand.SetHandler(async (string? gamePath, bool verbose, string path, bool recursive) =>
        {
            await ConfigCommand.ConvertAsync(gamePath, path, recursive, verbose);
        }, gamePathOption, verboseOption, convertPathArg, convertRecursiveOption);

        command.AddCommand(convertCommand);

        // Subcommand: loose (mark a file as loose in cpk_list)
        var looseCommand = new Command("loose", "Mark a file as loose in cpk_list.cfg.bin (enables loading from data/ directory)");
        var loosePathArg = new Argument<string>("path", "Relative file path (e.g., common/gamedata/vsroute/chronicle_vs_route_config_2.00.16.cfg.bin)");
        looseCommand.AddArgument(loosePathArg);
        var looseSizeOption = new Option<long>("--size", () => 0, "File size in bytes (0 = keep existing)");
        looseCommand.AddOption(looseSizeOption);

        looseCommand.SetHandler(async (string? gamePath, bool verbose, string path, long size) =>
        {
            await ConfigCommand.SetLooseAsync(gamePath, path, size, verbose);
        }, gamePathOption, verboseOption, loosePathArg, looseSizeOption);

        command.AddCommand(looseCommand);

        // Subcommand: restore-loose (restore cpk_list from backup)
        var restoreLooseCommand = new Command("restore-loose", "Restore cpk_list.cfg.bin from .loose_bak backup");

        restoreLooseCommand.SetHandler(async (string? gamePath, bool verbose) =>
        {
            await ConfigCommand.RestoreLooseAsync(gamePath, verbose);
        }, gamePathOption, verboseOption);

        command.AddCommand(restoreLooseCommand);

        // Subcommand: decode — décodeur générique (T2B + RDBN), sans schéma
        var decodeCommand = new Command("decode", "Décode un cfg.bin (T2B ou RDBN) en arbre typé générique (JSON)");
        var decodeFileArg = new Argument<string>("file", "Chemin vers le fichier cfg.bin");
        decodeCommand.AddArgument(decodeFileArg);
        var decodeOutputOption = new Option<string?>(["--output", "-o"], "Fichier JSON de sortie");
        decodeCommand.AddOption(decodeOutputOption);
        var decodeJsonOption = new Option<bool>("--json", "Affiche directement le JSON sur stdout (même sans --output)");
        decodeCommand.AddOption(decodeJsonOption);

        decodeCommand.SetHandler(async (bool verbose, string file, string? output, bool json) =>
        {
            await ConfigCommand.DecodeGenericAsync(file, output, json, verbose);
        }, verboseOption, decodeFileArg, decodeOutputOption, decodeJsonOption);

        command.AddCommand(decodeCommand);

        // Subcommand: types — génère manifestes typés (.d.ts + .json) par cfg.bin
        var typesCommand = new Command("types",
            "Génère un manifeste typé (.d.ts + .json) par cfg.bin (T2B ou RDBN) + index + verify.json");
        var typesInputArg = new Argument<string>("input", "Fichier cfg.bin ou dossier de configs");
        typesCommand.AddArgument(typesInputArg);
        var typesOutOption = new Option<string>(["--out", "-o"], () => "./cfg-types", "Dossier de sortie");
        typesCommand.AddOption(typesOutOption);

        typesCommand.SetHandler((string inp, string outDir) =>
        {
            if (!File.Exists(inp) && !Directory.Exists(inp))
            {
                Console.Error.WriteLine($"[ERREUR] Introuvable : {inp}");
                Environment.ExitCode = 1;
                return;
            }

            Console.Error.WriteLine($"# génération vers {Path.GetFullPath(outDir)}");

            [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode(
                "Uses CfgBinTypesGenerator which calls CfgBinDocument.Decode.")]
            static IECODE.Core.Formats.Level5.CfgBinTypesGenerator.GenerateSummary Run(
                string input, string output, Action<string> progress)
            {
                var gen = new IECODE.Core.Formats.Level5.CfgBinTypesGenerator();
                return gen.GenerateAll(input, output, progress);
            }

            var summary = Run(inp, outDir, msg => Console.Error.WriteLine("  " + msg));

            Console.WriteLine();
            Console.WriteLine("── Vérification ─────────────────────────────────");
            Console.WriteLine($"  Fichiers       : {summary.Total}");
            Console.WriteLine($"  Décodés        : {summary.Decoded}/{summary.Total}");
            Console.WriteLine($"  Parsés OK      : {summary.ParsedOk}/{summary.Total}");
            Console.WriteLine($"  Échecs         : {summary.Failed}");
            if (summary.Failures.Count > 0)
            {
                Console.WriteLine($"  Fichiers en échec ({summary.Failures.Count}) :");
                foreach (var f in summary.Failures.Take(20))
                    Console.WriteLine($"    - {f}");
                if (summary.Failures.Count > 20)
                    Console.WriteLine($"    … +{summary.Failures.Count - 20}");
            }

            if (summary.Failed > 0)
                Environment.ExitCode = 1;
        }, typesInputArg, typesOutOption);

        command.AddCommand(typesCommand);

        return command;
    }

    /// <summary>
    /// Alias court <c>cfg</c> → expose uniquement <c>cfg types</c> pour raccourcir la commande
    /// documentée dans la mission (<c>iecode cfg types</c> au lieu de <c>iecode config types</c>).
    /// </summary>
    private static Command CreateCfgShorthandCommand()
    {
        var command = new Command("cfg", "Alias court pour les commandes cfg.bin (sous-ensemble de `config`)");

        var typesCommand = new Command("types",
            "Génère un manifeste typé (.d.ts + .json) par cfg.bin (T2B ou RDBN) + index + verify.json");
        var typesInputArg = new Argument<string>("input", "Fichier cfg.bin ou dossier de configs");
        typesCommand.AddArgument(typesInputArg);
        var typesOutOption = new Option<string>(["--out", "-o"], () => "./cfg-types", "Dossier de sortie");
        typesCommand.AddOption(typesOutOption);

        typesCommand.SetHandler((string inp, string outDir) =>
        {
            if (!File.Exists(inp) && !Directory.Exists(inp))
            {
                Console.Error.WriteLine($"[ERREUR] Introuvable : {inp}");
                Environment.ExitCode = 1;
                return;
            }

            Console.Error.WriteLine($"# génération vers {Path.GetFullPath(outDir)}");

            [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode(
                "Uses CfgBinTypesGenerator which calls CfgBinDocument.Decode.")]
            static IECODE.Core.Formats.Level5.CfgBinTypesGenerator.GenerateSummary RunGen(
                string input, string output, Action<string> progress)
            {
                var gen = new IECODE.Core.Formats.Level5.CfgBinTypesGenerator();
                return gen.GenerateAll(input, output, progress);
            }

            var summary = RunGen(inp, outDir, msg => Console.Error.WriteLine("  " + msg));

            Console.WriteLine();
            Console.WriteLine("── Vérification ─────────────────────────────────");
            Console.WriteLine($"  Fichiers       : {summary.Total}");
            Console.WriteLine($"  Décodés        : {summary.Decoded}/{summary.Total}");
            Console.WriteLine($"  Parsés OK      : {summary.ParsedOk}/{summary.Total}");
            Console.WriteLine($"  Échecs         : {summary.Failed}");
            if (summary.Failures.Count > 0)
            {
                Console.WriteLine($"  Fichiers en échec ({summary.Failures.Count}) :");
                foreach (var f in summary.Failures.Take(20))
                    Console.WriteLine($"    - {f}");
                if (summary.Failures.Count > 20)
                    Console.WriteLine($"    … +{summary.Failures.Count - 20}");
            }

            if (summary.Failed > 0)
                Environment.ExitCode = 1;
        }, typesInputArg, typesOutOption);

        command.AddCommand(typesCommand);
        return command;
    }

    private static Command CreateCryptoCommand(Option<bool> verboseOption)
    {
        var command = new Command("crypto", "Encrypt/decrypt Criware files");

        // Subcommand: decrypt
        var decryptCommand = new Command("decrypt", "Decrypt a Criware file");
        var decryptFileArg = new Argument<string>("file", "File to decrypt");
        decryptCommand.AddArgument(decryptFileArg);
        var decryptOutputOption = new Option<string>(["--output", "-o"], "Output file") { IsRequired = true };
        decryptCommand.AddOption(decryptOutputOption);

        decryptCommand.SetHandler(async (bool verbose, string file, string output) =>
        {
            await CryptoCommand.DecryptAsync(file, output, verbose);
        }, verboseOption, decryptFileArg, decryptOutputOption);

        command.AddCommand(decryptCommand);

        // Subcommand: encrypt
        var encryptCommand = new Command("encrypt", "Encrypt a Criware file");
        var encryptFileArg = new Argument<string>("file", "File to encrypt");
        encryptCommand.AddArgument(encryptFileArg);
        var encryptOutputOption = new Option<string>(["--output", "-o"], "Output file") { IsRequired = true };
        encryptCommand.AddOption(encryptOutputOption);
        var keyOption = new Option<string>("--key", "Encryption key (hex, e.g., 0x1717E18E)") { IsRequired = true };
        encryptCommand.AddOption(keyOption);

        encryptCommand.SetHandler(async (bool verbose, string file, string output, string key) =>
        {
            await CryptoCommand.EncryptAsync(file, output, key, verbose);
        }, verboseOption, encryptFileArg, encryptOutputOption, keyOption);

        command.AddCommand(encryptCommand);

        return command;
    }


    private static Command CreateAnalyzeCommand(Option<string?> gamePathOption, Option<bool> verboseOption)
    {
        var command = new Command("analyze", "Analyze game structure and generate report");

        var outputOption = new Option<string?>(["--output", "-o"], "Output JSON report file");
        command.AddOption(outputOption);

        var deepOption = new Option<bool>("--deep", "Deep analysis (includes file hashes, strings)");
        command.AddOption(deepOption);

        command.SetHandler(async (string? gamePath, bool verbose, string? output, bool deep) =>
        {
            await AnalyzeCommand.ExecuteAsync(gamePath, output, deep, verbose);
        }, gamePathOption, verboseOption, outputOption, deepOption);

        return command;
    }

    [UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode",
        Justification = "CFG.BIN types are preserved in IECODE.Core")]
    private static Command CreatePassiveSkillCommand(Option<string?> gamePathOption, Option<bool> verboseOption)
    {
        var command = new Command("passive", "Analyze passive skill data from CFG.BIN files");

        // Subcommand: analyze
        var analyzeCommand = new Command("analyze", "Parse passive skill configs and export data");

        var skillConfigOption = new Option<string?>(
            "--skill-config",
            "Path to passive_skill_config.cfg.bin");
        analyzeCommand.AddOption(skillConfigOption);

        var outputOption = new Option<string?>(
            ["--output", "-o"],
            "Export results to JSON file");
        analyzeCommand.AddOption(outputOption);

        var rarityOption = new Option<int?>(
            "--rarity",
            "Filter by rarity value (champ [4] de PASSIVE_SKILL_INFO)");
        analyzeCommand.AddOption(rarityOption);

        analyzeCommand.SetHandler(async (string? gamePath, bool verbose, string? skillConfig, string? output, int? rarity) =>
        {
            await PassiveSkillCommand.AnalyzeAsync(gamePath, skillConfig, output, rarity, verbose);
        }, gamePathOption, verboseOption, skillConfigOption, outputOption, rarityOption);

        command.AddCommand(analyzeCommand);

        // Subcommand: help
        var helpCommand = new Command("help", "Show help for passive skill commands");
        helpCommand.SetHandler(() =>
        {
            PassiveSkillCommand.ShowHelp();
        });
        command.AddCommand(helpCommand);

        return command;
    }


    private static Command CreatePipelineCommand(Option<string?> gamePathOption, Option<bool> verboseOption)
    {
        var command = new Command("pipeline", "High-performance data extraction, conversion, and cleanup pipeline");

        var outputOption = new Option<string?>(
            aliases: ["--output", "-o"],
            description: "Output directory (default: data/extracted)");
        command.AddOption(outputOption);

        var packsOption = new Option<string?>(
            aliases: ["--packs", "-p"],
            description: "Custom packs directory (default: game/data/packs)");
        command.AddOption(packsOption);

        var convertOption = new Option<bool>(
            aliases: ["--convert", "-c"],
            getDefaultValue: () => true,
            description: "Convert binary formats to readable (G4TX→PNG, cfg.bin→JSON, etc.)");
        command.AddOption(convertOption);

        var deleteAfterExtractOption = new Option<bool>(
            "--delete-cpk",
            description: "Delete CPK after full extraction (FREES DISK SPACE)");
        command.AddOption(deleteAfterExtractOption);

        var deleteAfterConvertOption = new Option<bool>(
            "--delete-binary",
            description: "Delete original binary after conversion (KEEP ONLY READABLE FILES)");
        command.AddOption(deleteAfterConvertOption);

        var parallelCpksOption = new Option<int>(
            "--parallel-cpks",
            getDefaultValue: () => 0,
            description: "Number of CPKs to extract in parallel (default: CPU/2)");
        command.AddOption(parallelCpksOption);

        var parallelConversionsOption = new Option<int>(
            "--parallel-conversions",
            getDefaultValue: () => 0,
            description: "Number of files to convert in parallel (default: CPU*2)");
        command.AddOption(parallelConversionsOption);

        var noResumeOption = new Option<bool>(
            "--no-resume",
            description: "Don't resume from previous run (start fresh)");
        command.AddOption(noResumeOption);

        var patternOption = new Option<string>(
            "--pattern",
            getDefaultValue: () => "*.cpk",
            description: "CPK file pattern to process");
        command.AddOption(patternOption);

        var noRecursiveOption = new Option<bool>(
            "--no-recursive",
            description: "Don't search subdirectories for CPKs");
        command.AddOption(noRecursiveOption);

        // Use SetHandler with context to handle many options
        command.SetHandler(async context =>
        {
            var gamePath = context.ParseResult.GetValueForOption(gamePathOption);
            var verbose = context.ParseResult.GetValueForOption(verboseOption);
            var output = context.ParseResult.GetValueForOption(outputOption);
            var packs = context.ParseResult.GetValueForOption(packsOption);
            var convert = context.ParseResult.GetValueForOption(convertOption);
            var deleteAfterExtract = context.ParseResult.GetValueForOption(deleteAfterExtractOption);
            var deleteAfterConvert = context.ParseResult.GetValueForOption(deleteAfterConvertOption);
            var parallelCpks = context.ParseResult.GetValueForOption(parallelCpksOption);
            var parallelConversions = context.ParseResult.GetValueForOption(parallelConversionsOption);
            var noResume = context.ParseResult.GetValueForOption(noResumeOption);
            var pattern = context.ParseResult.GetValueForOption(patternOption) ?? "*.cpk";
            var noRecursive = context.ParseResult.GetValueForOption(noRecursiveOption);

            await PipelineCommand.ExecuteAsync(
                gamePath,
                output,
                packs,
                convert,
                deleteAfterExtract,
                deleteAfterConvert,
                parallelCpks,
                parallelConversions,
                resume: !noResume,
                recursive: !noRecursive,
                pattern,
                verbose);
        });

        return command;
    }
}
