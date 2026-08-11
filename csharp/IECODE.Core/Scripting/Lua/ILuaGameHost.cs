namespace IECODE.Core.Scripting.Lua;

// ── Journal d'appels host ─────────────────────────────────────────────────────

/// <summary>
/// Types de commandes que le Lua peut émettre vers le host C.
/// </summary>
public enum LuaCommandKind
{
    MenuCommand,
    Command,
    ActionCommand,
    CameraCommand,
    SpTacticsCommand,
}

/// <summary>
/// Enregistrement d'un appel host (pour la trace et les assertions de test).
/// </summary>
/// <param name="Kind">Type de la commande.</param>
/// <param name="CmdId">Identifiant numérique (hash CRC32 en général).</param>
/// <param name="CmdName">Nom résolu depuis le dico hash (ou hex si inconnu).</param>
/// <param name="LayerId">Second argument pour MenuCommand (= layerId), 0 sinon.</param>
/// <param name="LayerName">Nom résolu du layerId, ou hex si inconnu.</param>
/// <param name="Args">Arguments additionnels (variadiques).</param>
public sealed record LuaCallRecord(
    LuaCommandKind Kind,
    uint            CmdId,
    string          CmdName,
    uint            LayerId,
    string          LayerName,
    object[]        Args
)
{
    /// <inheritdoc/>
    public override string ToString()
    {
        string prefix = Kind switch
        {
            LuaCommandKind.MenuCommand      => "menuCmd",
            LuaCommandKind.Command          => "cmd",
            LuaCommandKind.ActionCommand    => "actionCmd",
            LuaCommandKind.CameraCommand    => "cameraCmd",
            LuaCommandKind.SpTacticsCommand => "spTacticsCmd",
            _                               => "cmd",
        };

        if (Kind == LuaCommandKind.MenuCommand)
        {
            string argStr = Args.Length > 0
                ? " " + string.Join(" ", Args.Select(FormatArg))
                : "";
            return $"{prefix}({CmdName}, layer={LayerName}{argStr})";
        }
        else
        {
            string argStr = Args.Length > 0
                ? " " + string.Join(" ", Args.Select(FormatArg))
                : "";
            return $"{prefix}({CmdName}{argStr})";
        }
    }

    private static string FormatArg(object a) => a switch
    {
        bool b   => b ? "true" : "false",
        double d => ((uint)(long)d).ToString(),   // hashes arrivent comme double en Lua
        _        => a?.ToString() ?? "nil",
    };
}

// ── Interface host ────────────────────────────────────────────────────────────

/// <summary>
/// Pont entre les scripts Lua du jeu IEVR et le host C# (équivalent iecode de nie.exe).
///
/// Le host est injecté dans l'environnement MoonSharp avant l'exécution d'un script.
/// Les callbacks (<c>OnSetupLayer</c>, <c>OnOpenLayer</c>, etc.) sont DÉFINIS par le
/// script et APPELÉS par le host via <see cref="LuaRuntime"/>.
///
/// Contrat :
/// <list type="bullet">
///   <item><c>Include</c> – résout et fournit la source Lua d'un script d'include.</item>
///   <item><c>MenuCommand</c>/<c>Command</c>/… – dispatche les appels <c>funcLua*</c>.</item>
///   <item><c>NameSettingBegin/AddNames/NameSettingEnd</c> – configurent les noms d'objets.</item>
///   <item><c>IsCloseEndListLayer</c>/… – reverse-bridge (état du moteur → Lua).</item>
/// </list>
/// </summary>
public interface ILuaGameHost
{
    // ── Include ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Charge la source Lua d'un script d'include (ex. <c>"LUA_MENU_DEF"</c>).
    /// Retourne <c>null</c> si inconnu (le stub injecte un chunk vide dans ce cas).
    /// </summary>
    string? Include(string name);

    // ── funcLua* ─────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>funcLuaMenuCommand(cmdId, layerId, ...args)</c>
    /// </summary>
    object? MenuCommand(uint cmdId, uint layerId, object?[] args);

    /// <summary>
    /// <c>funcLuaCommand(cmdId, ...args)</c>
    /// </summary>
    object? Command(uint cmdId, object?[] args);

    /// <summary>
    /// <c>funcLuaActionCommand(...)</c>
    /// </summary>
    object? ActionCommand(object?[] args);

    /// <summary>
    /// <c>funcLuaCameraCommand(...)</c>
    /// </summary>
    object? CameraCommand(object?[] args);

    /// <summary>
    /// <c>funcLuaSpTacticsCommand(...)</c>
    /// </summary>
    object? SpTacticsCommand(object?[] args);

    // ── NameSetting ───────────────────────────────────────────────────────────

    /// <summary>
    /// <c>NameSettingBegin(layerId, arg)</c>
    /// </summary>
    void NameSettingBegin(uint layerId, object? arg);

    /// <summary>
    /// <c>AddNames(baseName, format, count, start)</c>
    /// </summary>
    void AddNames(string baseName, string format, int count, int start);

    /// <summary>
    /// <c>NameSettingEnd()</c>
    /// </summary>
    void NameSettingEnd();

    // ── Reverse-bridge (moteur → Lua) ─────────────────────────────────────────

    /// <summary>
    /// <c>IsCloseEndListLayer() → bool</c>
    /// </summary>
    bool IsCloseEndListLayer();

    /// <summary>
    /// <c>SetGuideStatusToLua(…)</c>
    /// </summary>
    void SetGuideStatusToLua(object?[] args);

    // ── Coroutine helpers (définis dans LUA_MENU_DEF ou includes) ────────────

    /// <summary>
    /// <c>waitTrue(predFn)</c> / <c>waitFalse(predFn)</c> — helpers coroutine injected by host.
    /// Le stub ne fait rien (le script n'est pas en mode step-résumé).
    /// </summary>
    void WaitPredicate(bool expected, object? predFn);

    // ── Journal des appels ────────────────────────────────────────────────────

    /// <summary>Journal de tous les appels host reçus (lecture seule).</summary>
    IReadOnlyList<LuaCallRecord> CallLog { get; }
}
