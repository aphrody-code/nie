using System.Diagnostics;
using System.Text;
using IECODE.Core.Formats.Lua;
using IECODE.Core.Util;
using MoonSharp.Interpreter;

namespace IECODE.Core.Scripting.Lua;

/// <summary>
/// Runtime Lua IEVR.
///
/// Pipeline :
/// <code>
///   .lua.bin  →  unluac (Java)  →  source Lua  →  MoonSharp + host injecté
///                    ↑ fallback : LuaDisassembler si unluac absent
/// </code>
///
/// Utilisation typique :
/// <code>
///   var host    = new DefaultLuaHost(dict, trace: true);
///   var runtime = new LuaRuntime(host, unluacJar: "re/lua/unluac.jar");
///   runtime.LoadFile("script/menu/qrcode_menu.lua.bin");
///   runtime.CallOnSetupLayer(layerId: 292844459u);
///   runtime.CallOnOpenLayer(layerId: 292844459u);
///   foreach (var call in host.CallLog) Console.WriteLine(call);
/// </code>
/// </summary>
public sealed class LuaRuntime
{
    private readonly ILuaGameHost _host;
    private readonly string?      _unluacJar;
    private          Script?      _script;
    private          string?      _lastSource;

    // ── Callbacks optionnels définis par le script ────────────────────────────
    private DynValue _onSetupLayer    = DynValue.Nil;
    private DynValue _onOpenLayer     = DynValue.Nil;
    private DynValue _onCloseLayer    = DynValue.Nil;
    private DynValue _onCloseEndLayer = DynValue.Nil;
    private DynValue _onChangeLayerGroup = DynValue.Nil;

    /// <summary>Source Lua décompilée du dernier script chargé (debug).</summary>
    public string? LastDecompiledSource => _lastSource;

    // ── Constructeur ─────────────────────────────────────────────────────────

    /// <summary>
    /// Crée un runtime.
    /// </summary>
    /// <param name="host">
    ///   Host à injecter dans l'environnement Lua.
    ///   Utiliser <see cref="DefaultLuaHost"/> pour un stub traçant.
    /// </param>
    /// <param name="unluacJar">
    ///   Chemin vers <c>unluac.jar</c>.  Si null, cherche
    ///   <c>re/lua/unluac.jar</c> dans les répertoires parents.
    /// </param>
    public LuaRuntime(ILuaGameHost host, string? unluacJar = null)
    {
        _host      = host;
        _unluacJar = unluacJar ?? FindUnluacJar();
    }

    // ── Chargement ────────────────────────────────────────────────────────────

    /// <summary>
    /// Charge et décompile un fichier <c>.lua.bin</c>, puis l'exécute dans MoonSharp.
    /// </summary>
    /// <param name="path">Chemin physique vers le <c>.lua.bin</c>.</param>
    /// <exception cref="LuaRuntimeException">Si le chargement ou l'exécution échoue.</exception>
    public void LoadFile(string path)
    {
        if (!File.Exists(path))
            throw new LuaRuntimeException($"Fichier introuvable : {path}");

        byte[] data = File.ReadAllBytes(path);
        LoadBytes(data, Path.GetFileName(path));
    }

    /// <summary>
    /// Charge et décompile le bytecode Lua 5.2 fourni en mémoire.
    /// </summary>
    public void LoadBytes(byte[] data, string sourceName = "<memory>")
    {
        if (!LuaParser.IsLua52(data))
            throw new LuaRuntimeException($"Pas un bytecode Lua 5.2 valide : {sourceName}");

        string source = Decompile(data, sourceName);
        _lastSource = source;
        Execute(source, sourceName);
    }

    /// <summary>
    /// Charge et exécute une source Lua DÉJÀ décompilée (chemin rapide : évite unluac/Java).
    /// Utilisé quand une décompilation est en cache (ex. <c>re/lua/decompiled/</c>).
    /// </summary>
    public void LoadSource(string source, string sourceName = "<source>")
    {
        _lastSource = source;
        Execute(source, sourceName);
    }

    // ── Callbacks host → script ───────────────────────────────────────────────

    /// <summary>
    /// Appelle <c>OnSetupLayer(layerId, arg)</c> si défini dans le script.
    /// </summary>
    public DynValue? CallOnSetupLayer(uint layerId, object? arg = null)
        => TryCallCallback(_onSetupLayer, layerId, arg);

    /// <summary>
    /// Appelle <c>OnOpenLayer(layerId, arg)</c> si défini.
    /// </summary>
    public DynValue? CallOnOpenLayer(uint layerId, object? arg = null)
        => TryCallCallback(_onOpenLayer, layerId, arg);

    /// <summary>
    /// Appelle <c>OnCloseLayer(layerId, arg)</c> si défini.
    /// </summary>
    public DynValue? CallOnCloseLayer(uint layerId, object? arg = null)
        => TryCallCallback(_onCloseLayer, layerId, arg);

    /// <summary>
    /// Appelle <c>OnCloseEndLayer(layerId, arg)</c> si défini.
    /// </summary>
    public DynValue? CallOnCloseEndLayer(uint layerId, object? arg = null)
        => TryCallCallback(_onCloseEndLayer, layerId, arg);

    /// <summary>
    /// Appelle <c>OnChangeLayerGroup(groupId)</c> si défini.
    /// </summary>
    public DynValue? CallOnChangeLayerGroup(uint groupId)
        => TryCallCallback(_onChangeLayerGroup, groupId);

    /// <summary>
    /// Appelle la fonction <c>Step()</c> si définie (coroutine driver).
    /// </summary>
    public void Step()
    {
        if (_script is null) return;
        var stepFn = _script.Globals.Get("Step");
        if (stepFn.Type == DataType.Function)
            _script.Call(stepFn);
    }

    // ── Accès aux callbacks comme propriétés ─────────────────────────────────

    /// <summary>True si le script a défini OnSetupLayer.</summary>
    public bool HasOnSetupLayer     => _onSetupLayer.Type    == DataType.Function;
    /// <summary>True si le script a défini OnOpenLayer.</summary>
    public bool HasOnOpenLayer      => _onOpenLayer.Type     == DataType.Function;
    /// <summary>True si le script a défini OnCloseLayer.</summary>
    public bool HasOnCloseLayer     => _onCloseLayer.Type    == DataType.Function;
    /// <summary>True si le script a défini OnCloseEndLayer.</summary>
    public bool HasOnCloseEndLayer  => _onCloseEndLayer.Type == DataType.Function;
    /// <summary>True si le script a défini OnChangeLayerGroup.</summary>
    public bool HasOnChangeLayerGroup => _onChangeLayerGroup.Type == DataType.Function;

    // ── Décompilation ─────────────────────────────────────────────────────────

    private string Decompile(byte[] data, string sourceName)
    {
        if (_unluacJar is not null && File.Exists(_unluacJar))
        {
            try { return DecompileWithUnluac(data); }
            catch (Exception ex)
            {
                throw new LuaRuntimeException(
                    $"unluac a échoué sur {sourceName} : {ex.Message}", ex);
            }
        }

        // Fallback : pas d'unluac → on ne peut pas exécuter le bytecode brut dans MoonSharp
        // (MoonSharp ne supporte pas le bytecode Lua 5.2).
        throw new LuaRuntimeException(
            $"unluac.jar introuvable — impossible de décompiler {sourceName}. " +
            $"Fournissez le chemin via le constructeur ou placez unluac.jar dans re/lua/.");
    }

    private string DecompileWithUnluac(byte[] data)
    {
        // Écrit dans un fichier temporaire car unluac n'accepte que des chemins.
        string tmp = Path.GetTempFileName();
        try
        {
            File.WriteAllBytes(tmp, data);

            using var proc = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName               = "java",
                    Arguments              = $"-jar \"{_unluacJar}\" \"{tmp}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError  = true,
                    UseShellExecute        = false,
                    CreateNoWindow         = true,
                }
            };

            proc.Start();
            string stdout = proc.StandardOutput.ReadToEnd();
            string stderr = proc.StandardError.ReadToEnd();
            proc.WaitForExit();

            if (proc.ExitCode != 0)
                throw new LuaRuntimeException(
                    $"unluac exit {proc.ExitCode}: {stderr.Trim()}");

            return stdout;
        }
        finally
        {
            try { File.Delete(tmp); } catch { /* ignore */ }
        }
    }

    // ── Exécution MoonSharp ───────────────────────────────────────────────────

    private void Execute(string source, string sourceName)
    {
        var script = new Script(CoreModules.Preset_HardSandbox | CoreModules.Coroutine | CoreModules.String);
        InjectGlobals(script);

        try
        {
            script.DoString(source, codeFriendlyName: sourceName);
        }
        catch (ScriptRuntimeException ex)
        {
            throw new LuaRuntimeException(
                $"Erreur Lua à l'exécution de {sourceName} : {ex.DecoratedMessage}", ex);
        }
        catch (SyntaxErrorException ex)
        {
            throw new LuaRuntimeException(
                $"Erreur de syntaxe Lua dans {sourceName} : {ex.DecoratedMessage}", ex);
        }

        // Récupère les callbacks définis par le script
        _script              = script;
        _onSetupLayer        = script.Globals.Get("OnSetupLayer");
        _onOpenLayer         = script.Globals.Get("OnOpenLayer");
        _onCloseLayer        = script.Globals.Get("OnCloseLayer");
        _onCloseEndLayer     = script.Globals.Get("OnCloseEndLayer");
        _onChangeLayerGroup  = script.Globals.Get("OnChangeLayerGroup");
    }

    private void InjectGlobals(Script script)
    {
        // ── Helper : injecte un DynValue callback variadique ─────────────
        // MoonSharp ne peut pas convertir automatiquement des args variadiques vers
        // object[] — on utilise DynValue.NewCallback avec CallbackArguments directement.
        static DynValue CB(string name, Func<CallbackArguments, DynValue> fn)
            => DynValue.NewCallback((ctx, args) => fn(args), name);

        // ── funcLuaMenuCommand(cmdId, layerId, ...args) ───────────────────
        script.Globals["funcLuaMenuCommand"] = CB("funcLuaMenuCommand", args =>
        {
            uint cmdId   = DynToUInt32(args.RawGet(0, false));
            uint layerId = DynToUInt32(args.RawGet(1, false));
            var  rest    = CollectRestArgs(args, 2);
            var  result  = _host.MenuCommand(cmdId, layerId, rest);
            return ToReturn(script, result);
        });

        // ── funcLuaCommand(cmdId, ...args) ────────────────────────────────
        script.Globals["funcLuaCommand"] = CB("funcLuaCommand", args =>
        {
            uint cmdId = DynToUInt32(args.RawGet(0, false));
            var  rest  = CollectRestArgs(args, 1);
            var  result = _host.Command(cmdId, rest);
            return ToReturn(script, result);
        });

        // ── funcLuaActionCommand(...) ─────────────────────────────────────
        script.Globals["funcLuaActionCommand"] = CB("funcLuaActionCommand", args =>
        {
            var result = _host.ActionCommand(CollectRestArgs(args, 0));
            return ToReturn(script, result);
        });

        // ── funcLuaCameraCommand(...) ─────────────────────────────────────
        script.Globals["funcLuaCameraCommand"] = CB("funcLuaCameraCommand", args =>
        {
            var result = _host.CameraCommand(CollectRestArgs(args, 0));
            return ToReturn(script, result);
        });

        // ── funcLuaSpTacticsCommand(...) ──────────────────────────────────
        script.Globals["funcLuaSpTacticsCommand"] = CB("funcLuaSpTacticsCommand", args =>
        {
            var result = _host.SpTacticsCommand(CollectRestArgs(args, 0));
            return ToReturn(script, result);
        });

        // ── INCLUDE(name) ─────────────────────────────────────────────────
        script.Globals["INCLUDE"] = CB("INCLUDE", args =>
        {
            string name = args.RawGet(0, false)?.String ?? "";
            string? includeSrc = _host.Include(name);
            if (!string.IsNullOrEmpty(includeSrc))
            {
                try { script.DoString(includeSrc, codeFriendlyName: $"@{name}"); }
                catch { /* on logue et on continue */ }
            }
            return DynValue.Nil;
        });

        // ── NameSetting ───────────────────────────────────────────────────
        script.Globals["NameSettingBegin"] = CB("NameSettingBegin", args =>
        {
            uint layerId = DynToUInt32(args.RawGet(0, false));
            object? arg  = DynToObject(args.RawGet(1, false));
            _host.NameSettingBegin(layerId, arg);
            return DynValue.Nil;
        });

        script.Globals["AddNames"] = CB("AddNames", args =>
        {
            string baseName = args.RawGet(0, false)?.String ?? "";
            string fmt      = args.RawGet(1, false)?.String ?? "";
            int    count    = (int)(args.RawGet(2, false)?.Number ?? 0);
            int    start    = (int)(args.RawGet(3, false)?.Number ?? 0);
            _host.AddNames(baseName, fmt, count, start);
            return DynValue.Nil;
        });

        script.Globals["NameSettingEnd"] = CB("NameSettingEnd", _ =>
        {
            _host.NameSettingEnd();
            return DynValue.Nil;
        });

        // ── Reverse-bridge ────────────────────────────────────────────────
        script.Globals["IsCloseEndListLayer"] = CB("IsCloseEndListLayer", _ =>
            DynValue.NewBoolean(_host.IsCloseEndListLayer()));

        script.Globals["SetGuideStatusToLua"] = CB("SetGuideStatusToLua", args =>
        {
            _host.SetGuideStatusToLua(CollectRestArgs(args, 0));
            return DynValue.Nil;
        });

        // ── Coroutine helpers (stubs) ─────────────────────────────────────
        // waitTrue/waitFalse : acceptent une fonction Lua et ne font rien (stub).
        script.Globals["waitTrue"]  = CB("waitTrue",  args =>
        {
            _host.WaitPredicate(true,  DynToObject(args.RawGet(0, false)));
            return DynValue.Nil;
        });
        script.Globals["waitFalse"] = CB("waitFalse", args =>
        {
            _host.WaitPredicate(false, DynToObject(args.RawGet(0, false)));
            return DynValue.Nil;
        });

        // Stubs supplémentaires observés dans les scripts décompilés
        static DynValue Nop(CallbackArguments _) => DynValue.Nil;
        script.Globals["UpdateDetailWindowAttachBase"] = CB("UpdateDetailWindowAttachBase", Nop);
        script.Globals["SaveAndShowWaitWindow"]        = CB("SaveAndShowWaitWindow",        Nop);
        script.Globals["UploadSaveData"]               = CB("UploadSaveData",               Nop);
        script.Globals["OnCloseEndLayerCommon"]        = CB("OnCloseEndLayerCommon",        Nop);
        script.Globals["OnChangeLayerGroupCommon"]     = CB("OnChangeLayerGroupCommon",     Nop);
    }

    // ── Helpers de conversion DynValue ───────────────────────────────────────

    private static object?[] CollectRestArgs(CallbackArguments args, int startIndex)
    {
        int count = args.Count - startIndex;
        if (count <= 0) return Array.Empty<object?>();
        var result = new object?[count];
        for (int i = 0; i < count; i++)
        {
            var dv = args.RawGet(startIndex + i, false);
            result[i] = DynToObject(dv);
        }
        return result;
    }

    private static object? DynToObject(DynValue? dv)
    {
        if (dv is null || dv.IsNil()) return null;
        return dv.Type switch
        {
            DataType.Number  => dv.Number,
            DataType.Boolean => dv.Boolean,
            DataType.String  => dv.String,
            _                => null,
        };
    }

    private static DynValue ToReturn(Script script, object? result)
    {
        if (result is null) return DynValue.NewNumber(0);
        if (result is double d) return DynValue.NewNumber(d);
        if (result is bool b)   return DynValue.NewBoolean(b);
        if (result is int i)    return DynValue.NewNumber(i);
        return DynValue.NewNumber(0);
    }

    private static uint DynToUInt32(DynValue? dv)
    {
        if (dv is null || dv.IsNil()) return 0u;
        if (dv.Type == DataType.Number) return (uint)(long)dv.Number;
        return 0u;
    }

    private DynValue? TryCallCallback(DynValue fn, params object?[] args)
    {
        if (_script is null || fn.Type != DataType.Function)
            return null;

        try
        {
            // Convertit uint en double pour Lua
            var dynArgs = args.Select(a => a is uint u
                ? DynValue.NewNumber(u)
                : a is null
                    ? DynValue.Nil
                    : DynValue.FromObject(_script, a)).ToArray();

            return _script.Call(fn, dynArgs);
        }
        catch (ScriptRuntimeException ex)
        {
            throw new LuaRuntimeException(
                $"Erreur dans callback : {ex.DecoratedMessage}", ex);
        }
    }

    // ── Utilitaires statiques ─────────────────────────────────────────────────

    /// <summary>
    /// Convertit une valeur MoonSharp (DynValue/double/long) en uint.
    /// Les hashes Lua arrivent comme <c>double</c> (type number de Lua).
    /// </summary>
    public static uint ToUInt32(object? val) => val switch
    {
        null        => 0u,
        DynValue dv => dv.Type == DataType.Number ? (uint)(long)dv.Number : 0u,
        double  d   => (uint)(long)d,
        long    l   => (uint)l,
        int     i   => (uint)i,
        uint    u   => u,
        _           => 0u,
    };

    // ── Recherche de unluac.jar ──────────────────────────────────────────────

    private static string? FindUnluacJar()
    {
        // Cherche re/lua/unluac.jar depuis le répertoire courant vers la racine
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            string candidate = Path.Combine(dir.FullName, "re", "lua", "unluac.jar");
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return null;
    }
}

/// <summary>Exception levée par <see cref="LuaRuntime"/> en cas d'erreur d'exécution Lua.</summary>
public sealed class LuaRuntimeException(string message, Exception? inner = null)
    : Exception(message, inner);
