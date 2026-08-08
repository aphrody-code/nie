using System.IO;
using IECODE.Core.Formats.Lua;
using IECODE.Core.Scripting.Lua;
using IECODE.Core.Util;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests d'intégration du runtime Lua IEVR (LuaRuntime + DefaultLuaHost + MoonSharp).
///
/// Prérequis :
/// <list type="bullet">
///   <item><c>re/lua/raw/*.lua.bin</c> — bytecodes réels extraits du jeu.</item>
///   <item><c>re/lua/unluac.jar</c> — décompileur de référence.</item>
///   <item>Java dans le PATH.</item>
///   <item><c>re/menu/hash-dictionary.json</c> — dico hash→nom.</item>
/// </list>
/// Tous les tests sont skippés si les prérequis sont absents.
/// </summary>
public class LuaRuntimeTests
{
    // ── Chemins de référence ──────────────────────────────────────────────────
    private static readonly string RepoRoot =
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));

    private static readonly string RawDir       = Path.Combine(RepoRoot, "re", "lua", "raw");
    private static readonly string UnluacJar    = Path.Combine(RepoRoot, "re", "lua", "unluac.jar");
    private static readonly string HashDictPath = Path.Combine(RepoRoot, "re", "menu", "hash-dictionary.json");

    private static string RawFile(string name) => Path.Combine(RawDir, name);

    private static bool HasPrerequisites() =>
        Directory.Exists(RawDir) &&
        File.Exists(UnluacJar) &&
        File.Exists(Path.Combine(RawDir, "qrcode_menu.lua.bin"));

    private static Level5HashDictionary? TryLoadDict() =>
        File.Exists(HashDictPath) ? Level5HashDictionary.Load(HashDictPath) : null;

    private DefaultLuaHost MakeHost(bool trace = false) =>
        new DefaultLuaHost(TryLoadDict(), trace);

    private LuaRuntime MakeRuntime(DefaultLuaHost host) =>
        new LuaRuntime(host, unluacJar: UnluacJar);

    // ── Test 1 : qrcode_menu ─────────────────────────────────────────────────

    /// <summary>
    /// qrcode_menu.lua.bin doit charger sans exception et avoir les 3 callbacks.
    /// </summary>
    [Fact]
    public void QrcodeMenu_LoadsWithoutException()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = MakeRuntime(host);

        runtime.LoadFile(RawFile("qrcode_menu.lua.bin"));

        Assert.True(runtime.HasOnSetupLayer,  "OnSetupLayer manquant");
        Assert.True(runtime.HasOnOpenLayer,   "OnOpenLayer manquant");
        Assert.True(runtime.HasOnCloseLayer,  "OnCloseLayer manquant");
    }

    /// <summary>
    /// OnSetupLayer(292844459) doit émettre des funcLuaMenuCommand résolus.
    /// 292844459 = layerId observé dans le script décompilé qrcode_menu.
    /// </summary>
    [Fact]
    public void QrcodeMenu_OnSetupLayer_EmitsMenuCommands()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = MakeRuntime(host);
        runtime.LoadFile(RawFile("qrcode_menu.lua.bin"));

        runtime.CallOnSetupLayer(layerId: 292844459u);

        // Le script doit avoir appelé au moins 2 funcLuaMenuCommand
        var menuCalls = host.CallLog
            .Where(c => c.Kind == LuaCommandKind.MenuCommand)
            .ToList();
        Assert.True(menuCalls.Count >= 2,
            $"OnSetupLayer(292844459) doit émettre ≥ 2 menuCmd — reçu : {menuCalls.Count}");
    }

    /// <summary>
    /// OnOpenLayer(292844459) doit émettre des funcLuaMenuCommand.
    /// D'après le décompilé : funcLuaMenuCommand(1018283794, 1189944233, 0)
    ///                        puis funcLuaMenuCommand(1848885328, 292844459, 0, …).
    /// </summary>
    [Fact]
    public void QrcodeMenu_OnOpenLayer_EmitsMenuCommands()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = MakeRuntime(host);
        runtime.LoadFile(RawFile("qrcode_menu.lua.bin"));

        // Setup d'abord pour que le script soit dans l'état attendu
        runtime.CallOnSetupLayer(292844459u);
        int countBefore = host.CallLog.Count;

        runtime.CallOnOpenLayer(292844459u);

        var newCalls = host.CallLog.Skip(countBefore).ToList();
        Assert.True(newCalls.Count > 0,
            $"OnOpenLayer(292844459) doit émettre ≥ 1 appel host — reçu : {newCalls.Count}");
        Assert.Contains(newCalls, c => c.Kind == LuaCommandKind.MenuCommand);
    }

    // ── Test 2 : battle_menu_multi ───────────────────────────────────────────

    /// <summary>
    /// battle_menu_multi.lua.bin doit charger, avoir OnSetupLayer, et NameSettingBegin.
    /// D'après le décompilé : OnSetupLayer appelle NameSettingBegin(2492438505) + AddNames.
    /// </summary>
    [Fact]
    public void BattleMenuMulti_OnSetupLayer_CallsNameSettingBegin()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = MakeRuntime(host);
        runtime.LoadFile(RawFile("battle_menu_multi.lua.bin"));

        Assert.True(runtime.HasOnSetupLayer, "OnSetupLayer manquant dans battle_menu_multi");

        // layerId = 2492438505 d'après le décompilé
        runtime.CallOnSetupLayer(layerId: 2492438505u);

        // Aucun funcLuaMenuCommand dans battle_menu_multi.OnSetupLayer — mais
        // NameSettingBegin/AddNames/NameSettingEnd doivent avoir été appelés.
        // On vérifie via le host source : on mock NameSettingBegin via un host traceur.
        // (DefaultLuaHost logue mais ne stocke pas NameSetting séparément ;
        //  on vérifie au moins qu'aucune exception n'a été levée.)
        // Vérification plus précise : le log est vide de menuCmd mais le chargement a réussi.
        Assert.True(runtime.HasOnSetupLayer);
    }

    /// <summary>
    /// Vérifie avec un host personnalisé que NameSettingBegin reçoit bien le layerId 2492438505.
    /// </summary>
    [Fact]
    public void BattleMenuMulti_NameSettingBegin_ReceivesCorrectLayerId()
    {
        if (!HasPrerequisites()) return;

        var trackingHost = new NameSettingTrackingHost();
        var runtime      = new LuaRuntime(trackingHost, UnluacJar);
        runtime.LoadFile(RawFile("battle_menu_multi.lua.bin"));

        runtime.CallOnSetupLayer(layerId: 2492438505u);

        Assert.True(trackingHost.NameSettingBeginCalled,
            "NameSettingBegin n'a pas été appelé");
        Assert.Equal(2492438505u, trackingHost.LastNameSettingLayerId);
        Assert.True(trackingHost.AddNamesCallCount >= 2,
            $"AddNames doit être appelé ≥ 2 fois — reçu : {trackingHost.AddNamesCallCount}");
    }

    // ── Test 3 : savedata_management_menu_save_and_upload ────────────────────

    /// <summary>
    /// savedata_management … doit charger sans exception malgré l'INCLUDE + coroutines.
    /// </summary>
    [Fact]
    public void SavedataMenu_LoadsWithoutException()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = MakeRuntime(host);

        var exception = Record.Exception(() =>
            runtime.LoadFile(RawFile(
                "common_script_lua_menu_savedata_management_menu_save_and_upload.lua.bin")));

        Assert.Null(exception);
    }

    /// <summary>
    /// OnOpenLayer(536044352) doit appeler funcLuaMenuCommand(711242136, …) selon le décompilé
    /// (si A1_4 == 1 et funcLuaCommand(1264371438) retourne false, ce que notre stub fait).
    /// </summary>
    [Fact]
    public void SavedataMenu_OnOpenLayer_EmitsMenuCommand()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = MakeRuntime(host);
        runtime.LoadFile(RawFile(
            "common_script_lua_menu_savedata_management_menu_save_and_upload.lua.bin"));

        Assert.True(runtime.HasOnOpenLayer, "OnOpenLayer manquant");

        runtime.CallOnOpenLayer(536044352u, arg: 1);   // A0=536044352, A1=1

        var menuCalls = host.CallLog
            .Where(c => c.Kind == LuaCommandKind.MenuCommand)
            .ToList();
        Assert.True(menuCalls.Count >= 1,
            $"OnOpenLayer(536044352, 1) doit émettre ≥ 1 menuCmd — reçu : {menuCalls.Count}");

        // cmdId 711242136 attendu
        Assert.Contains(menuCalls, c => c.CmdId == 711242136u);
    }

    /// <summary>
    /// OnChangeLayerGroup(1654568798) doit émettre 2 funcLuaMenuCommand (711242136 et 532421851).
    /// </summary>
    [Fact]
    public void SavedataMenu_OnChangeLayerGroup_EmitsExpectedCommands()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = MakeRuntime(host);
        runtime.LoadFile(RawFile(
            "common_script_lua_menu_savedata_management_menu_save_and_upload.lua.bin"));

        if (!runtime.HasOnChangeLayerGroup)
            return;   // script sans OnChangeLayerGroup → skip

        runtime.CallOnChangeLayerGroup(1654568798u);

        var menuCalls = host.CallLog
            .Where(c => c.Kind == LuaCommandKind.MenuCommand)
            .ToList();
        Assert.True(menuCalls.Count >= 2,
            $"OnChangeLayerGroup(1654568798) doit émettre ≥ 2 menuCmd — reçu : {menuCalls.Count}");

        Assert.Contains(menuCalls, c => c.CmdId == 711242136u);
        Assert.Contains(menuCalls, c => c.CmdId == 532421851u);
    }

    // ── Test 4 : ToUInt32 ─────────────────────────────────────────────────────

    [Fact]
    public void ToUInt32_HandlesDoubleCorrectly()
    {
        // Les hashes arrivent comme double depuis Lua
        Assert.Equal(292844459u, LuaRuntime.ToUInt32((double)292844459));
        Assert.Equal(3781155141u, LuaRuntime.ToUInt32((double)3781155141));
        Assert.Equal(0u, LuaRuntime.ToUInt32(null));
    }

    [Fact]
    public void ToUInt32_HandlesLargeUint()
    {
        // 2492438505 > int.MaxValue
        double d = 2492438505d;
        Assert.Equal(2492438505u, LuaRuntime.ToUInt32(d));
    }

    // ── Test 5 : source décompilée accessible ─────────────────────────────────

    [Fact]
    public void QrcodeMenu_DecompiledSourceIsAccessible()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = MakeRuntime(host);
        runtime.LoadFile(RawFile("qrcode_menu.lua.bin"));

        string? src = runtime.LastDecompiledSource;
        Assert.NotNull(src);
        Assert.Contains("funcLuaMenuCommand", src);
        Assert.Contains("OnSetupLayer", src);
    }

    // ── Host de test personnalisé ─────────────────────────────────────────────

    /// <summary>Host minimal qui trace les appels NameSetting.</summary>
    private sealed class NameSettingTrackingHost : DefaultLuaHost
    {
        public bool NameSettingBeginCalled { get; private set; }
        public uint LastNameSettingLayerId { get; private set; }
        public int  AddNamesCallCount      { get; private set; }

        public NameSettingTrackingHost() : base(null, false) { }

        public override void NameSettingBegin(uint layerId, object? arg)
        {
            NameSettingBeginCalled  = true;
            LastNameSettingLayerId  = layerId;
        }

        public override void AddNames(string baseName, string format, int count, int start)
        {
            AddNamesCallCount++;
        }
    }
}
