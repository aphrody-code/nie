using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using IECODE.Core.Formats.Lua;
using IECODE.Core.Util;

namespace IECODE.Core.Scripting.Lua;

// ── Modèle de manifeste (sortie JSON + base du .d.ts) ────────────────────────

/// <summary>Un objet (widget) touché par un script, avec le type d'effet appliqué.</summary>
public sealed record ScriptObjectManifest(uint Id, string? Name, string Kind);

/// <summary>Un layer manipulé par un script, et ses objets.</summary>
public sealed record ScriptLayerManifest(uint Id, string? Name, IReadOnlyList<ScriptObjectManifest> Objects);

/// <summary>Résolution d'un cmdId <c>funcLuaMenuCommand</c> vers sa fonction C reversée.</summary>
public sealed record CommandResolution(uint CmdId, string? CFunction, bool Resolved);

/// <summary>
/// Vérification que le script est ENTIÈREMENT décodé/déchiffré/parsé et que ses LIENS
/// (vers une fonction C <c>funcLua*</c> et vers un cfg.bin/objbin) sont résolus.
/// </summary>
/// <param name="Decompiled">Le <c>.lua.bin</c> a été décompilé sans erreur.</param>
/// <param name="Encrypted">Le bytecode était chiffré (faux pour du Lua 5.2 standard <c>\x1bLua</c>).</param>
/// <param name="Parsed">Le bytecode a été parsé intégralement (protos + instructions).</param>
/// <param name="ProtoCount">Nombre de fonctions (protos) parsées.</param>
/// <param name="InstructionCount">Nombre total d'instructions.</param>
/// <param name="Commands">cmdIds distincts émis → fonction C (résolu ou non).</param>
/// <param name="UnresolvedCommands">Combien de cmdIds n'ont PAS de fonction C connue.</param>
/// <param name="HashesTotal">Total layerId+objectId rencontrés.</param>
/// <param name="HashesResolved">Combien résolvent vers un nom cfg.bin/objbin (dico de hash).</param>
/// <param name="CfgRefs">Références cfg.bin/_setting/_config littérales trouvées dans la source.</param>
/// <param name="FullyResolved">Décodé + parsé + toutes commandes liées à une fonction C.</param>
public sealed record ScriptResolution(
    bool Decompiled,
    bool Encrypted,
    bool Parsed,
    int ProtoCount,
    int InstructionCount,
    IReadOnlyList<CommandResolution> Commands,
    int UnresolvedCommands,
    int HashesTotal,
    int HashesResolved,
    IReadOnlyList<string> CfgRefs,
    bool FullyResolved);

/// <summary>
/// Manifeste typé d'UN script Lua : son interface vis-à-vis du host (callbacks, layerIds, objets
/// émis) + sa <see cref="ScriptResolution"/> (décodage/parse/liens). C'est le seul « type » qui a du
/// sens pour du Lua (langage dynamique) — l'empreinte du script sur l'état du jeu, obtenue par
/// analyse statique + exécution via <see cref="GameLuaHost"/>.
/// </summary>
public sealed record ScriptManifest(
    string Script,
    string SourceFile,
    IReadOnlyList<string> Callbacks,
    IReadOnlyList<uint> LayerIds,
    IReadOnlyList<ScriptLayerManifest> Layers,
    ScriptResolution Resolution);

/// <summary>
/// Génère un <see cref="ScriptManifest"/> (+ son <c>.d.ts</c>) par script Lua de menu :
/// <list type="number">
///   <item>charge et décompile le <c>.lua.bin</c> (<see cref="LuaRuntime"/>),</item>
///   <item>détecte les callbacks définis et extrait les <c>layerId</c> par analyse statique de la
///         source (motif <c>== &lt;hash&gt;</c>),</item>
///   <item>rejoue chaque layer via <see cref="GameLuaHost"/> pour capturer les objets/sprites/textes
///         réellement émis.</item>
/// </list>
/// </summary>
public sealed class LuaTypesGenerator
{
    private readonly Level5HashDictionary? _dict;
    private readonly FuncLuaCommands _cmds;
    private readonly string? _unluacJar;
    // Index du cache décompilé : nom de script (strippé, sans version) → chemin .lua.
    private readonly Dictionary<string, string> _decompiledByName;

    // layerId = littéral comparé à un paramètre : `== 292844459`. Hashes ≥ 5 chiffres.
    private static readonly Regex LayerIdRegex = new(@"==\s*(\d{5,})", RegexOptions.Compiled);

    public LuaTypesGenerator(Level5HashDictionary? dict, FuncLuaCommands cmds, string? unluacJar = null)
    {
        _dict = dict;
        _cmds = cmds;
        _unluacJar = unluacJar;
        _decompiledByName = IndexDecompiledCache();
    }

    /// <summary>
    /// Indexe le cache de sources décompilées (<c>re/lua/decompiled/.../*.lua</c>) par nom de script
    /// strippé (sans version) — les noms de fichiers cache GARDENT la version, on la retire des deux
    /// côtés pour maximiser les correspondances (chemin rapide sans Java/unluac).
    /// </summary>
    private static Dictionary<string, string> IndexDecompiledCache()
    {
        var index = new Dictionary<string, string>(StringComparer.Ordinal);
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            string cacheDir = Path.Combine(dir.FullName, "re", "lua", "decompiled",
                "common", "script", "lua", "menu");
            if (Directory.Exists(cacheDir))
            {
                foreach (var file in Directory.EnumerateFiles(cacheDir, "*.lua"))
                {
                    // Retire .lua puis strippe la version (les fichiers cache la gardent).
                    string key = StripScriptName(Path.GetFileNameWithoutExtension(file));
                    index.TryAdd(key, file);
                }
                break;
            }
            dir = dir.Parent;
        }
        return index;
    }

    private string? TryCachedSource(string script)
        => _decompiledByName.TryGetValue(script, out var p) ? File.ReadAllText(p) : null;

    /// <summary>Génère le manifeste d'un seul fichier <c>.lua.bin</c>.</summary>
    public ScriptManifest Generate(string luaBinPath)
    {
        string script = StripScriptName(Path.GetFileName(luaBinPath));
        byte[] raw = File.ReadAllBytes(luaBinPath);

        // ── Décodage / déchiffrement / parse (vérification d'intégrité) ──────────
        // .lua.bin = bytecode Lua 5.2 standard (magic \x1bLua). Non chiffré (le chiffrement
        // CRI vise les cfg.bin, pas les scripts). On le confirme via le magic.
        bool encrypted = !(raw.Length >= 4 && raw[0] == 0x1B && raw[1] == 0x4C && raw[2] == 0x75 && raw[3] == 0x61);

        bool parsed = false;
        int protoCount = 0, instrCount = 0;
        try
        {
            var chunk = LuaParser.Parse(raw);
            (protoCount, instrCount) = CountProtos(chunk.Main);
            parsed = true;
        }
        catch (LuaParseException) { /* parsed reste false */ }

        var host = new GameLuaHost(_dict, _cmds);
        var runtime = new LuaRuntime(host, _unluacJar);
        // Chemin rapide : source décompilée en cache → évite unluac/Java (gros gain perf + RAM).
        // Sinon, décompilation à la volée via unluac.
        string? cached = TryCachedSource(script);
        if (cached is not null)
            runtime.LoadSource(cached, Path.GetFileName(luaBinPath));
        else
            runtime.LoadFile(luaBinPath);   // décompile + exécute (unluac)
        bool decompiled = !string.IsNullOrEmpty(runtime.LastDecompiledSource);

        // Callbacks définis (interface host du script).
        var callbacks = new List<string>();
        if (runtime.HasOnSetupLayer) callbacks.Add("OnSetupLayer");
        if (runtime.HasOnOpenLayer) callbacks.Add("OnOpenLayer");
        if (runtime.HasOnCloseLayer) callbacks.Add("OnCloseLayer");
        if (runtime.HasOnCloseEndLayer) callbacks.Add("OnCloseEndLayer");
        if (runtime.HasOnChangeLayerGroup) callbacks.Add("OnChangeLayerGroup");

        // layerIds extraits de la source décompilée.
        var layerIds = ExtractLayerIds(runtime.LastDecompiledSource);

        // Rejoue chaque layer pour peupler l'état (objets/sprites/textes).
        foreach (uint lid in layerIds)
        {
            try { runtime.CallOnSetupLayer(lid); } catch (LuaRuntimeException) { }
            try { runtime.CallOnOpenLayer(lid); } catch (LuaRuntimeException) { }
        }

        var layers = host.State.Layers.Values
            .Select(l => new ScriptLayerManifest(
                l.Id, l.Name,
                l.Objects.Values
                    .Select(o => new ScriptObjectManifest(o.Id, o.Name, ObjectKind(o)))
                    .ToList()))
            .ToList();

        var resolution = BuildResolution(
            decompiled, encrypted, parsed, protoCount, instrCount,
            host, layers, runtime.LastDecompiledSource);

        return new ScriptManifest(script, Path.GetFileName(luaBinPath), callbacks, layerIds, layers, resolution);
    }

    // ── Construction du bloc de résolution (liens C / cfg.bin) ────────────────

    private ScriptResolution BuildResolution(
        bool decompiled, bool encrypted, bool parsed, int protoCount, int instrCount,
        GameLuaHost host, IReadOnlyList<ScriptLayerManifest> layers, string? source)
    {
        // Lien → fonction C : chaque cmdId distinct des funcLuaMenuCommand émis.
        var cmds = host.CallLog
            .Where(c => c.Kind == LuaCommandKind.MenuCommand)
            .Select(c => c.CmdId)
            .Distinct()
            .Select(id =>
            {
                string? cfn = _cmds.MenuCommandName(id);
                return new CommandResolution(id, cfn, cfn is not null);
            })
            .ToList();
        int unresolvedCmds = cmds.Count(c => !c.Resolved);

        // Lien → cfg.bin/objbin : un layerId/objectId résout-il vers un nom (dico dérivé des
        // key tables cfg.bin/objbin) ? Si oui, le lien script ↔ données existe.
        int hashesTotal = layers.Count + layers.Sum(l => l.Objects.Count);
        int hashesResolved = layers.Count(l => l.Name is not null)
                             + layers.Sum(l => l.Objects.Count(o => o.Name is not null));

        var cfgRefs = ExtractCfgRefs(source);

        bool fullyResolved = decompiled && parsed && !encrypted && unresolvedCmds == 0;

        return new ScriptResolution(
            decompiled, encrypted, parsed, protoCount, instrCount,
            cmds, unresolvedCmds, hashesTotal, hashesResolved, cfgRefs, fullyResolved);
    }

    private static readonly Regex CfgRefRegex = new(
        @"[""']([A-Za-z0-9_/]+(?:_setting|_config|\.cfg\.bin|\.cfg|\.bin))[""']", RegexOptions.Compiled);

    private static IReadOnlyList<string> ExtractCfgRefs(string? source)
    {
        if (string.IsNullOrEmpty(source)) return [];
        var set = new List<string>();
        foreach (Match m in CfgRefRegex.Matches(source))
        {
            string r = m.Groups[1].Value;
            if (!set.Contains(r)) set.Add(r);
        }
        return set;
    }

    private static (int protos, int instrs) CountProtos(LuaProto p)
    {
        int protos = 1, instrs = p.Code.Count;
        foreach (var child in p.Protos)
        {
            var (cp, ci) = CountProtos(child);
            protos += cp;
            instrs += ci;
        }
        return (protos, instrs);
    }

    /// <summary>Bilan agrégé d'une génération (vérification décodage + résolution des liens).</summary>
    public sealed record GenerateSummary(
        int Total, int Decompiled, int Parsed, int Encrypted, int FullyResolved,
        int CommandsTotal, int CommandsUnresolved, IReadOnlyList<string> NotFullyResolved);

    /// <summary>Génère manifestes + <c>.d.ts</c> pour tous les <c>.lua.bin</c> d'un dossier (ou un fichier).</summary>
    /// <returns>Bilan de vérification (décodage/parse/liens).</returns>
    public GenerateSummary GenerateAll(string input, string outDir, Action<string>? onProgress = null)
    {
        Directory.CreateDirectory(outDir);

        IEnumerable<string> files = Directory.Exists(input)
            ? Directory.EnumerateFiles(input, "*.lua.bin", SearchOption.AllDirectories).OrderBy(p => p)
            : [input];

        var index = new List<object>();
        int total = 0, decompiled = 0, parsed = 0, encrypted = 0, fullyResolved = 0;
        int cmdTotal = 0, cmdUnresolved = 0;
        var notFull = new List<string>();

        foreach (var file in files)
        {
            ScriptManifest manifest;
            try { manifest = Generate(file); }
            catch (Exception ex)
            {
                // Un script défaillant (décompilation invalide, exception VM…) ne doit jamais
                // avorter tout le run — on le saute et on continue.
                onProgress?.Invoke($"[skip] {Path.GetFileName(file)} : {ex.Message}");
                continue;
            }

            File.WriteAllText(Path.Combine(outDir, $"{manifest.Script}.json"), ToJson(manifest));
            File.WriteAllText(Path.Combine(outDir, $"{manifest.Script}.d.ts"), ToDts(manifest));

            var r = manifest.Resolution;
            total++;
            if (r.Decompiled) decompiled++;
            if (r.Parsed) parsed++;
            if (r.Encrypted) encrypted++;
            if (r.FullyResolved) fullyResolved++; else notFull.Add(manifest.Script);
            cmdTotal += r.Commands.Count;
            cmdUnresolved += r.UnresolvedCommands;

            index.Add(new
            {
                script = manifest.Script,
                callbacks = manifest.Callbacks,
                layerIds = manifest.LayerIds,
                layers = manifest.Layers.Count,
                objects = manifest.Layers.Sum(l => l.Objects.Count),
                decompiled = r.Decompiled,
                parsed = r.Parsed,
                encrypted = r.Encrypted,
                fullyResolved = r.FullyResolved,
                commandsUnresolved = r.UnresolvedCommands,
                cfgRefs = r.CfgRefs,
            });
            onProgress?.Invoke($"[{(r.FullyResolved ? "ok " : "!! ")}] {manifest.Script} : " +
                               $"{manifest.LayerIds.Count} layer(s), {manifest.Layers.Sum(l => l.Objects.Count)} obj, " +
                               $"cmds {r.Commands.Count - r.UnresolvedCommands}/{r.Commands.Count} liés C");

            // Robustesse mémoire : libère les Script MoonSharp accumulés et écrit un snapshot
            // périodique de l'index/verify (le bilan survit même si le process est tué en fin de run).
            if (total % 16 == 0)
            {
                WriteIndexAndVerify(outDir, index, MakeSummary());
                GC.Collect();
                GC.WaitForPendingFinalizers();
            }
        }

        var summary = MakeSummary();
        WriteIndexAndVerify(outDir, index, summary);
        return summary;

        GenerateSummary MakeSummary() => new(
            total, decompiled, parsed, encrypted, fullyResolved, cmdTotal, cmdUnresolved, notFull);
    }

    private static void WriteIndexAndVerify(string outDir, IReadOnlyList<object> index, GenerateSummary summary)
    {
        File.WriteAllText(Path.Combine(outDir, "index.json"), JsonSerializer.Serialize(index, JsonOpts));
        File.WriteAllText(Path.Combine(outDir, "index.d.ts"), ToIndexDts(index));
        File.WriteAllText(Path.Combine(outDir, "verify.json"), JsonSerializer.Serialize(summary, JsonOpts));
    }

    // ── Extraction layerId ───────────────────────────────────────────────────

    private static IReadOnlyList<uint> ExtractLayerIds(string? source)
    {
        if (string.IsNullOrEmpty(source)) return [];
        var set = new List<uint>();
        foreach (Match m in LayerIdRegex.Matches(source))
        {
            if (ulong.TryParse(m.Groups[1].Value, out ulong v) && v is > 0xFFFF and <= uint.MaxValue)
            {
                uint id = (uint)v;
                if (!set.Contains(id)) set.Add(id);
            }
        }
        return set;
    }

    private static string ObjectKind(MenuObjectState o)
    {
        if (o.SpriteTextureHash is not null) return "sprite";
        if (o.Text is not null) return "text";
        if (o.Number is not null) return "number";
        if (o.Progress is not null) return "progress";
        return "object";
    }

    // ── Émission .d.ts ───────────────────────────────────────────────────────

    private static string ToDts(ScriptManifest m)
    {
        var sb = new StringBuilder();
        sb.AppendLine("// AUTO-GÉNÉRÉ par `iecode lua types` — NE PAS ÉDITER.");
        sb.AppendLine($"// Script : {m.Script}  (source : {m.SourceFile})");
        sb.AppendLine("// Empreinte host du script Lua : callbacks, layerIds, objets émis.");
        sb.AppendLine();

        string cbs = string.Join(", ", m.Callbacks.Select(c => $"\"{c}\""));
        sb.AppendLine($"export declare const callbacks: readonly [{cbs}];");

        string lids = string.Join(", ", m.LayerIds);
        sb.AppendLine($"export declare const layerIds: readonly [{lids}];");
        sb.AppendLine();

        string iface = Pascal(m.Script) + "Layers";
        sb.AppendLine($"export interface {iface} {{");
        foreach (var layer in m.Layers)
        {
            string lname = TsKey(layer.Name ?? $"layer_{layer.Id:x8}");
            sb.AppendLine($"  /** layerId {layer.Id} (0x{layer.Id:X8}) */");
            sb.AppendLine($"  {lname}: {{");
            sb.AppendLine("    objects: {");
            foreach (var o in layer.Objects)
            {
                string oname = TsKey(o.Name ?? $"obj_{o.Id:x8}");
                sb.AppendLine($"      {oname}: {{ kind: \"{o.Kind}\" }};");
            }
            sb.AppendLine("    };");
            sb.AppendLine("  };");
        }
        sb.AppendLine("}");
        return sb.ToString();
    }

    private static string ToIndexDts(IReadOnlyList<object> index)
    {
        // index est une liste d'objets anonymes ; on relit via JSON pour rester simple.
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(index, JsonOpts));
        var names = doc.RootElement.EnumerateArray()
            .Select(e => e.GetProperty("script").GetString()!)
            .ToList();

        var sb = new StringBuilder();
        sb.AppendLine("// AUTO-GÉNÉRÉ par `iecode lua types` — NE PAS ÉDITER.");
        sb.AppendLine("// Union typée de tous les scripts de menu IEVR analysés.");
        sb.AppendLine();
        sb.AppendLine("export type IevrMenuScript =");
        if (names.Count == 0) sb.AppendLine("  never;");
        else
            for (int i = 0; i < names.Count; i++)
                sb.AppendLine($"  {(i == 0 ? "|" : "|")} \"{names[i]}\"{(i == names.Count - 1 ? ";" : "")}");
        return sb.ToString();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static string StripScriptName(string fileName)
    {
        string n = fileName;
        if (n.EndsWith(".lua.bin", StringComparison.OrdinalIgnoreCase)) n = n[..^8];
        // Retire le préfixe de chemin aplati et le suffixe de version éventuel.
        int idx = n.IndexOf("script_lua_menu_", StringComparison.OrdinalIgnoreCase);
        if (idx >= 0) n = n[(idx + "script_lua_menu_".Length)..];
        return Regex.Replace(n, @"_\d+\.\d+\.\d+(\.\d+)?$", "");
    }

    private static string Pascal(string s)
    {
        var parts = s.Split(['_', '-', '.'], StringSplitOptions.RemoveEmptyEntries);
        return string.Concat(parts.Select(p => char.ToUpperInvariant(p[0]) + p[1..]));
    }

    /// <summary>Clé d'objet TS : identifiant nu si valide, sinon entre guillemets.</summary>
    private static string TsKey(string name)
        => Regex.IsMatch(name, @"^[A-Za-z_$][A-Za-z0-9_$]*$") ? name : $"\"{name}\"";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>Sérialise un manifeste en JSON (camelCase).</summary>
    public static string ToJson(ScriptManifest m) => JsonSerializer.Serialize(m, JsonOpts);
}
