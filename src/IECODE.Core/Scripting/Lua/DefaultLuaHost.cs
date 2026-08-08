using IECODE.Core.Util;

namespace IECODE.Core.Scripting.Lua;

/// <summary>
/// Implémentation stub de <see cref="ILuaGameHost"/>.
///
/// Comportement :
/// <list type="bullet">
///   <item>Logue chaque appel host avec les noms résolus (via <see cref="Level5HashDictionary"/>).</item>
///   <item>Renvoie des valeurs neutres (0 / false / nil) → le script ne crashe pas.</item>
///   <item>INCLUDE retourne une source Lua vide si le fichier n'est pas trouvé.</item>
/// </list>
///
/// Usage : injecter dans <see cref="LuaRuntime"/> pour tracer ce qu'un script fait
/// sans implémenter la vraie sémantique du moteur.  Remplacer par une implémentation
/// complète une fois le reverse Ghidra terminé.
/// </summary>
public class DefaultLuaHost : ILuaGameHost
{
    private readonly Level5HashDictionary? _dict;
    private readonly bool _trace;
    private readonly List<LuaCallRecord> _log = [];

    /// <summary>
    /// Crée un host stub.
    /// </summary>
    /// <param name="dictionary">
    ///   Dictionnaire hash→nom optionnel.  Si null, les IDs apparaissent en hex.
    /// </param>
    /// <param name="trace">Si true, chaque appel est écrit sur Console.Error.</param>
    public DefaultLuaHost(Level5HashDictionary? dictionary = null, bool trace = false)
    {
        _dict  = dictionary;
        _trace = trace;
    }

    /// <inheritdoc/>
    public IReadOnlyList<LuaCallRecord> CallLog => _log;

    // ── Include ──────────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public string? Include(string name)
    {
        Log($"[INCLUDE] {name}");
        return null;   // LuaRuntime injecte un chunk vide si null
    }

    // ── funcLua* ─────────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public virtual object? MenuCommand(uint cmdId, uint layerId, object?[] args)
    {
        var rec = Record(LuaCommandKind.MenuCommand, cmdId, layerId, args);
        Log(rec.ToString());
        return (double)0;   // MoonSharp attend un object ou DynValue
    }

    /// <inheritdoc/>
    public object? Command(uint cmdId, object?[] args)
    {
        var rec = Record(LuaCommandKind.Command, cmdId, 0, args);
        Log(rec.ToString());
        // Le vrai retour de funcLuaCommand est PAR-COMMANDE (chaque handler C de nie.exe) — aucune
        // valeur de stub unique n'est universelle : `if not funcLuaCommand()` veut falsy (false),
        // mais d'autres scripts l'utilisent en arithmétique (besoin numérique, où false throw en Lua).
        // Divergence connue et irréductible sans reverser chaque handler : ce host (C#) renvoie
        // `false` car ses scripts réels de test (savedata) en dépendent ; le host TS renvoie `0` pour
        // les siens. GameLuaHost peut surcharger la sémantique par commande quand elle est reversée.
        return false;
    }

    /// <inheritdoc/>
    public object? ActionCommand(object?[] args)
    {
        Log($"[actionCmd] {ArgsStr(args)}");
        return (double)0;
    }

    /// <inheritdoc/>
    public object? CameraCommand(object?[] args)
    {
        Log($"[cameraCmd] {ArgsStr(args)}");
        return (double)0;
    }

    /// <inheritdoc/>
    public object? SpTacticsCommand(object?[] args)
    {
        Log($"[spTacticsCmd] {ArgsStr(args)}");
        return (double)0;
    }

    // ── NameSetting ──────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public virtual void NameSettingBegin(uint layerId, object? arg)
        => Log($"[NameSettingBegin] layer={Resolve(layerId)}");

    /// <inheritdoc/>
    public virtual void AddNames(string baseName, string format, int count, int start)
        => Log($"[AddNames] base={baseName} fmt={format} count={count} start={start}");

    /// <inheritdoc/>
    public virtual void NameSettingEnd()
        => Log("[NameSettingEnd]");

    // ── Reverse-bridge ───────────────────────────────────────────────────────

    /// <inheritdoc/>
    public bool IsCloseEndListLayer()
    {
        Log("[IsCloseEndListLayer] → false");
        return false;
    }

    /// <inheritdoc/>
    public void SetGuideStatusToLua(object?[] args)
        => Log($"[SetGuideStatusToLua] {ArgsStr(args)}");

    /// <inheritdoc/>
    public void WaitPredicate(bool expected, object? predFn)
        => Log($"[wait{(expected ? "True" : "False")}] (stub, no-op)");

    // ── Helpers internes ─────────────────────────────────────────────────────

    private LuaCallRecord Record(LuaCommandKind kind, uint cmdId, uint layerId, object?[] args)
    {
        var rec = new LuaCallRecord(
            kind,
            cmdId,
            Resolve(cmdId),
            layerId,
            layerId != 0 ? Resolve(layerId) : "0",
            args.Select(a => a ?? (object)"nil").ToArray()
        );
        _log.Add(rec);
        return rec;
    }

    /// <summary>Résout un hash CRC32 en nom lisible (préimage réel), ou hex si inconnu.</summary>
    protected string Resolve(uint hash)
        => _dict?.ResolveOrHex(hash) ?? $"UNKNOWN_{hash:X8}";

    /// <summary>Résout un hash, ou null si non présent dans le dico (pas de fallback hex).</summary>
    protected string? ResolveOrNull(uint hash)
        => _dict?.Resolve(hash);

    private static string ArgsStr(object?[] args)
        => string.Join(", ", args.Select(a => a?.ToString() ?? "nil"));

    private void Log(string msg)
    {
        if (_trace) Console.Error.WriteLine($"[LuaHost] {msg}");
    }
}
