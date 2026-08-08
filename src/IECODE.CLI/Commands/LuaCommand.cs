using System.CommandLine;
using IECODE.Core.Formats.Lua;
using IECODE.Core.Scripting.Lua;
using IECODE.Core.Util;
using MoonSharp.Interpreter;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commandes CLI pour l'analyse et l'exécution du bytecode Lua 5.2 (fichiers .lua.bin IEVR).
/// Sous-commandes : info, parse, disasm, run.
/// </summary>
public static class LuaCommand
{
    public static Command Create()
    {
        var command = new Command("lua", "Analyse et exécute le bytecode Lua 5.2 (fichiers .lua.bin IEVR)");

        command.AddCommand(CreateInfoCommand());
        command.AddCommand(CreateParseCommand());
        command.AddCommand(CreateDisasmCommand());
        command.AddCommand(CreateRunCommand());
        command.AddCommand(CreateTypesCommand());

        return command;
    }

    // ── info ──────────────────────────────────────────────────────────────────
    private static Command CreateInfoCommand()
    {
        var cmd  = new Command("info", "Résumé compact d'un fichier .lua.bin (header + arbre des protos)");
        var file = new Argument<string>("file", "Fichier .lua.bin à analyser");
        cmd.AddArgument(file);

        var recursive = new Option<bool>(["--recursive", "-r"], "Analyser tous les .lua.bin d'un répertoire");
        cmd.AddOption(recursive);

        cmd.SetHandler((string f, bool rec) =>
        {
            if (rec && Directory.Exists(f))
            {
                foreach (var path in Directory.EnumerateFiles(f, "*.lua.bin", SearchOption.AllDirectories))
                    PrintInfo(path);
                return;
            }
            PrintInfo(f);
        }, file, recursive);

        return cmd;
    }

    private static void PrintInfo(string path)
    {
        if (!File.Exists(path)) { Console.Error.WriteLine($"Fichier introuvable : {path}"); return; }
        try
        {
            var data  = File.ReadAllBytes(path);
            var chunk = LuaParser.Parse(data);
            Console.WriteLine($"=== {Path.GetFileName(path)} ===");
            Console.Write(LuaDisassembler.Summary(chunk));
        }
        catch (LuaParseException ex)
        {
            Console.Error.WriteLine($"[ERREUR] {Path.GetFileName(path)} : {ex.Message}");
        }
    }

    // ── parse ─────────────────────────────────────────────────────────────────
    private static Command CreateParseCommand()
    {
        var cmd  = new Command("parse", "Parse et affiche la structure JSON simplifiée d'un .lua.bin");
        var file = new Argument<string>("file", "Fichier .lua.bin à parser");
        cmd.AddArgument(file);

        cmd.SetHandler((string f) =>
        {
            if (!File.Exists(f)) { Console.Error.WriteLine($"Fichier introuvable : {f}"); return; }
            try
            {
                var data  = File.ReadAllBytes(f);
                var chunk = LuaParser.Parse(data);
                PrintParsed(chunk);
            }
            catch (LuaParseException ex)
            {
                Console.Error.WriteLine($"[ERREUR] : {ex.Message}");
            }
        }, file);

        return cmd;
    }

    private static void PrintParsed(LuaChunk chunk)
    {
        var h = chunk.Header;
        Console.WriteLine($"Header : version=0x{h.Version:X2} format={h.Format} endian={( h.IsLittleEndian ? "LE" : "BE" )} int={h.IntSize} size_t={h.SizeTSize} instr={h.InstructionSize} num={h.NumberSize} float={h.IsFloat}");
        Console.WriteLine();
        static void Walk(LuaProto p, int depth)
        {
            string pad = new(' ', depth * 2);
            Console.WriteLine($"{pad}Proto [{p.Source ?? "(main)"}] lines {p.LineDefined}–{p.LastLineDefined}");
            Console.WriteLine($"{pad}  params={p.NumParams} vararg={p.IsVararg} stack={p.MaxStackSize}");
            Console.WriteLine($"{pad}  code={p.Code.Count} consts={p.Constants.Count} upvals={p.Upvalues.Count} protos={p.Protos.Count}");

            if (p.Constants.Count > 0)
            {
                Console.WriteLine($"{pad}  Constants:");
                for (int i = 0; i < p.Constants.Count; i++)
                    Console.WriteLine($"{pad}    [{i}] {p.Constants[i]}");
            }
            if (p.Upvalues.Count > 0)
            {
                Console.WriteLine($"{pad}  Upvalues:");
                for (int i = 0; i < p.Upvalues.Count; i++)
                {
                    var uv = p.Upvalues[i];
                    Console.WriteLine($"{pad}    [{i}] {uv.Name ?? "(unnamed)"} instack={uv.InStack} idx={uv.Idx}");
                }
            }

            foreach (var child in p.Protos)
                Walk(child, depth + 1);
        }
        Walk(chunk.Main, 0);
    }

    // ── run ───────────────────────────────────────────────────────────────────
    private static Command CreateRunCommand()
    {
        var cmd  = new Command("run", "Exécute un .lua.bin dans le runtime MoonSharp + DefaultLuaHost et affiche la trace des commandes");
        var file = new Argument<string>("file", "Chemin vers le .lua.bin (ou chemin logique script/lua/…)");
        cmd.AddArgument(file);

        var gameOpt  = new Option<string?>(["--game", "-g"], "Répertoire data IEVR (pour INCLUDE + dico hash)");
        var traceOpt = new Option<bool>(["--trace", "-t"], "Affiche chaque appel host en temps réel");
        var unluacOpt = new Option<string?>("--unluac", "Chemin vers unluac.jar (défaut : auto-détecté)");

        var layerOpt  = new Option<uint?>("--layer", "layerId à passer à OnSetupLayer/OnOpenLayer");
        var groupOpt  = new Option<uint?>("--group", "groupId à passer à OnChangeLayerGroup");
        var stateOpt  = new Option<bool>("--state", "Affiche l'état de menu reconstruit (JSON) — GameLuaHost fidèle");

        cmd.AddOption(gameOpt);
        cmd.AddOption(traceOpt);
        cmd.AddOption(unluacOpt);
        cmd.AddOption(layerOpt);
        cmd.AddOption(groupOpt);
        cmd.AddOption(stateOpt);

        cmd.SetHandler((context) =>
        {
            string  f      = context.ParseResult.GetValueForArgument(file);
            string? game   = context.ParseResult.GetValueForOption(gameOpt);
            bool    trace  = context.ParseResult.GetValueForOption(traceOpt);
            string? unluac = context.ParseResult.GetValueForOption(unluacOpt);
            uint?   layer  = context.ParseResult.GetValueForOption(layerOpt);
            uint?   group  = context.ParseResult.GetValueForOption(groupOpt);
            bool    state  = context.ParseResult.GetValueForOption(stateOpt);

            // ── Résolution du chemin ──────────────────────────────────────
            string path = f;
            if (!File.Exists(path) && game is not null)
            {
                // chemin logique → tente game/script/lua/<name>.lua.bin
                string candidate = Path.Combine(game, f.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(candidate)) path = candidate;
            }
            if (!File.Exists(path))
            {
                Console.Error.WriteLine($"[ERREUR] Fichier introuvable : {path}");
                return;
            }

            // ── Dico hash (optionnel) ─────────────────────────────────────
            Level5HashDictionary? dict = null;
            if (game is not null)
            {
                string dictPath = Path.Combine(game, "..", "re", "menu", "hash-dictionary.json");
                if (!File.Exists(dictPath))
                    dictPath = Path.GetFullPath(Path.Combine(
                        AppContext.BaseDirectory,
                        "..", "..", "..", "..", "..", "re", "menu", "hash-dictionary.json"));
                if (File.Exists(dictPath))
                    dict = Level5HashDictionary.Load(dictPath);
            }
            else
            {
                // Cherche le dico depuis le binaire
                string dictPath = Path.GetFullPath(Path.Combine(
                    AppContext.BaseDirectory,
                    "..", "..", "..", "..", "..", "re", "menu", "hash-dictionary.json"));
                if (File.Exists(dictPath))
                    dict = Level5HashDictionary.Load(dictPath);
            }

            var host    = new GameLuaHost(dict, FuncLuaCommands.LoadDefault(), trace);
            var runtime = new LuaRuntime(host, unluacJar: unluac);

            try
            {
                runtime.LoadFile(path);
            }
            catch (LuaRuntimeException ex)
            {
                Console.Error.WriteLine($"[ERREUR] Chargement : {ex.Message}");
                return;
            }

            Console.WriteLine($"Script chargé : {Path.GetFileName(path)}");
            Console.WriteLine($"  OnSetupLayer     : {(runtime.HasOnSetupLayer     ? "oui" : "non")}");
            Console.WriteLine($"  OnOpenLayer      : {(runtime.HasOnOpenLayer      ? "oui" : "non")}");
            Console.WriteLine($"  OnCloseLayer     : {(runtime.HasOnCloseLayer     ? "oui" : "non")}");
            Console.WriteLine($"  OnCloseEndLayer  : {(runtime.HasOnCloseEndLayer  ? "oui" : "non")}");
            Console.WriteLine($"  OnChangeLayerGroup: {(runtime.HasOnChangeLayerGroup ? "oui" : "non")}");
            Console.WriteLine();

            // ── Appel des callbacks ───────────────────────────────────────
            uint layerId = layer ?? 0u;
            uint groupId = group ?? 0u;

            if (runtime.HasOnSetupLayer)
            {
                Console.WriteLine($"→ OnSetupLayer({layerId})");
                try { runtime.CallOnSetupLayer(layerId); }
                catch (LuaRuntimeException ex) { Console.Error.WriteLine($"  [ERREUR] {ex.Message}"); }
            }

            if (runtime.HasOnOpenLayer)
            {
                Console.WriteLine($"→ OnOpenLayer({layerId})");
                try { runtime.CallOnOpenLayer(layerId); }
                catch (LuaRuntimeException ex) { Console.Error.WriteLine($"  [ERREUR] {ex.Message}"); }
            }

            if (runtime.HasOnChangeLayerGroup && groupId != 0)
            {
                Console.WriteLine($"→ OnChangeLayerGroup({groupId})");
                try { runtime.CallOnChangeLayerGroup(groupId); }
                catch (LuaRuntimeException ex) { Console.Error.WriteLine($"  [ERREUR] {ex.Message}"); }
            }

            // ── Rapport de trace ──────────────────────────────────────────
            Console.WriteLine();
            Console.WriteLine($"── Trace ({host.CallLog.Count} appels host) ──────────────────────");
            if (host.CallLog.Count == 0)
            {
                Console.WriteLine("  (aucun appel host)");
            }
            else
            {
                foreach (var call in host.CallLog)
                    Console.WriteLine($"  {call}");
            }

            // ── État de menu reconstruit (GameLuaHost) ────────────────────
            if (state)
            {
                int objCount = host.State.Layers.Values.Sum(l => l.Objects.Count);
                Console.WriteLine();
                Console.WriteLine($"── État menu : {host.State.Layers.Count} layer(s), {objCount} objet(s) ──");
                Console.WriteLine(host.State.ToJson());
            }

        });

        return cmd;
    }

    // ── types ───────────────────────────────────────────────────────────────────
    private static Command CreateTypesCommand()
    {
        var cmd = new Command("types",
            "Génère un manifeste typé (.d.ts + .json) par script Lua + vérifie décodage/parse et résolution des liens (fonction C / cfg.bin)");
        var input = new Argument<string>("input", "Fichier .lua.bin ou dossier de scripts");
        cmd.AddArgument(input);

        var outOpt    = new Option<string>(["--out", "-o"], () => "./lua-types", "Dossier de sortie");
        var gameOpt   = new Option<string?>(["--game", "-g"], "Répertoire data IEVR (pour le dico de hash)");
        var unluacOpt = new Option<string?>("--unluac", "Chemin vers unluac.jar (défaut : auto-détecté)");
        cmd.AddOption(outOpt);
        cmd.AddOption(gameOpt);
        cmd.AddOption(unluacOpt);

        cmd.SetHandler((string inp, string outDir, string? game, string? unluac) =>
        {
            if (!File.Exists(inp) && !Directory.Exists(inp))
            {
                Console.Error.WriteLine($"[ERREUR] Introuvable : {inp}");
                Environment.ExitCode = 1;
                return;
            }

            var dict = FindHashDict(game);
            var cmds = FuncLuaCommands.LoadDefault();
            var gen  = new LuaTypesGenerator(dict, cmds, unluac);

            Console.Error.WriteLine($"# génération vers {Path.GetFullPath(outDir)}");
            var summary = gen.GenerateAll(inp, outDir, msg => Console.Error.WriteLine("  " + msg));

            Console.WriteLine();
            Console.WriteLine("── Vérification ─────────────────────────────────");
            Console.WriteLine($"  Scripts            : {summary.Total}");
            Console.WriteLine($"  Décompilés         : {summary.Decompiled}/{summary.Total}");
            Console.WriteLine($"  Parsés (bytecode)  : {summary.Parsed}/{summary.Total}");
            Console.WriteLine($"  Chiffrés           : {summary.Encrypted}");
            Console.WriteLine($"  Commandes liées C  : {summary.CommandsTotal - summary.CommandsUnresolved}/{summary.CommandsTotal}");
            Console.WriteLine($"  Entièrement résolus: {summary.FullyResolved}/{summary.Total}");
            if (summary.NotFullyResolved.Count > 0)
            {
                Console.WriteLine($"  Non entièrement résolus ({summary.NotFullyResolved.Count}) :");
                foreach (var s in summary.NotFullyResolved.Take(20))
                    Console.WriteLine($"    - {s}");
                if (summary.NotFullyResolved.Count > 20)
                    Console.WriteLine($"    … +{summary.NotFullyResolved.Count - 20}");
            }
        }, input, outOpt, gameOpt, unluacOpt);

        return cmd;
    }

    /// <summary>Localise et charge <c>re/menu/hash-dictionary.json</c> (depuis --game ou le binaire).</summary>
    private static Level5HashDictionary? FindHashDict(string? game)
    {
        var candidates = new List<string>();
        if (game is not null)
            candidates.Add(Path.Combine(game, "..", "re", "menu", "hash-dictionary.json"));
        candidates.Add(Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory, "..", "..", "..", "..", "..", "re", "menu", "hash-dictionary.json")));

        foreach (var c in candidates)
            if (File.Exists(c)) return Level5HashDictionary.Load(c);
        return null;
    }

    // ── disasm ────────────────────────────────────────────────────────────────
    private static Command CreateDisasmCommand()
    {
        var cmd  = new Command("disasm", "Désassemble un .lua.bin (listing type luac -l)");
        var file = new Argument<string>("file", "Fichier .lua.bin à désassembler");
        cmd.AddArgument(file);

        var output = new Option<string?>(["--output", "-o"], "Fichier de sortie (défaut : stdout)");
        cmd.AddOption(output);

        cmd.SetHandler((string f, string? outPath) =>
        {
            if (!File.Exists(f)) { Console.Error.WriteLine($"Fichier introuvable : {f}"); return; }
            try
            {
                var data   = File.ReadAllBytes(f);
                var chunk  = LuaParser.Parse(data);
                string asm = LuaDisassembler.Disassemble(chunk);

                if (outPath is not null)
                    File.WriteAllText(outPath, asm);
                else
                    Console.Write(asm);
            }
            catch (LuaParseException ex)
            {
                Console.Error.WriteLine($"[ERREUR] : {ex.Message}");
            }
        }, file, output);

        return cmd;
    }
}
