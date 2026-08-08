using System.IO;
using System.Linq;
using IECODE.Core.Scripting.Lua;
using IECODE.Core.Util;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du host Lua fidèle (<see cref="GameLuaHost"/>) : exécuter un vrai script de menu doit
/// reconstruire un <see cref="MenuState"/> (layers/objets mutés par les <c>funcLuaMenuCommand</c>),
/// l'équivalent iecode de l'état que nie.exe construit en mémoire.
///
/// Prérequis identiques à <see cref="LuaRuntimeTests"/> (skippés si absents).
/// </summary>
public class GameLuaHostTests
{
    private static readonly string RepoRoot =
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));

    private static readonly string RawDir       = Path.Combine(RepoRoot, "re", "lua", "raw");
    private static readonly string UnluacJar    = Path.Combine(RepoRoot, "re", "lua", "unluac.jar");
    private static readonly string HashDictPath = Path.Combine(RepoRoot, "re", "menu", "hash-dictionary.json");
    private static readonly string CmdIdsPath   = Path.Combine(RepoRoot, "re", "lua", "funclua-cmdids.json");

    // general_win — le layerId que qrcode_menu attend pour émettre ses commandes.
    private const uint GeneralWinLayer = 292844459u;

    private static bool HasPrerequisites() =>
        File.Exists(Path.Combine(RawDir, "qrcode_menu.lua.bin")) &&
        File.Exists(UnluacJar) &&
        File.Exists(CmdIdsPath);

    private static GameLuaHost MakeHost()
    {
        var dict = File.Exists(HashDictPath) ? Level5HashDictionary.Load(HashDictPath) : null;
        var cmds = FuncLuaCommands.Load(CmdIdsPath);
        return new GameLuaHost(dict, cmds);
    }

    // ── La table sémantique charge les commandes reversées ───────────────────

    [Fact]
    public void FuncLuaCommands_LoadsReversedMenuCommands()
    {
        if (!File.Exists(CmdIdsPath)) return;
        var cmds = FuncLuaCommands.Load(CmdIdsPath);
        // SetSprite (0xE15FD945) et SetObjectVisible (0x2A64B198) sont reversés.
        Assert.Equal("SetSprite", cmds.MenuCommandName(0xE15FD945));
        Assert.Equal("SetObjectVisible", cmds.MenuCommandName(0x2A64B198));
        Assert.True(cmds.Count("funcLuaMenuCommand") >= 20);
    }

    // ── Exécuter qrcode_menu reconstruit l'état ──────────────────────────────

    [Fact]
    public void QrcodeMenu_BuildsMenuStateWithSprite()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = new LuaRuntime(host, unluacJar: UnluacJar);
        runtime.LoadFile(Path.Combine(RawDir, "qrcode_menu.lua.bin"));

        runtime.CallOnSetupLayer(GeneralWinLayer);
        runtime.CallOnOpenLayer(GeneralWinLayer);

        // Le layer general_win doit exister et être nommé via le dico.
        Assert.True(host.State.Layers.ContainsKey(GeneralWinLayer));
        var layer = host.State.Layers[GeneralWinLayer];
        Assert.Equal("general_win", layer.Name);

        // SetSprite a dû créer un objet avec une texture.
        Assert.NotEmpty(layer.Objects);
        Assert.Contains(layer.Objects.Values, o => o.SpriteTextureHash is > 0);
    }

    // ── Le JSON d'état est bien formé ────────────────────────────────────────

    [Fact]
    public void MenuState_SerializesToJson()
    {
        if (!HasPrerequisites()) return;

        var host    = MakeHost();
        var runtime = new LuaRuntime(host, unluacJar: UnluacJar);
        runtime.LoadFile(Path.Combine(RawDir, "qrcode_menu.lua.bin"));
        runtime.CallOnSetupLayer(GeneralWinLayer);
        runtime.CallOnOpenLayer(GeneralWinLayer);

        string json = host.State.ToJson();
        Assert.Contains("general_win", json);
        Assert.Contains("spriteTextureHash", json);
    }

    // ── Commandes synthétiques : la sémantique mute correctement ─────────────

    [Fact]
    public void MenuCommand_SetObjectVisible_TogglesVisibility()
    {
        if (!File.Exists(CmdIdsPath)) return;

        var host = MakeHost();
        // SetObjectVisible(layer=10, obj=42, visible=false)
        host.MenuCommand(0x2A64B198, 10u, [(double)42, false]);

        var obj = host.State.Layers[10u].Objects[42u];
        Assert.False(obj.Visible);
    }

    [Fact]
    public void MenuCommand_SetText_ResolvesValue()
    {
        if (!File.Exists(CmdIdsPath)) return;

        var host = MakeHost();
        host.TextResolver = _ => "Bonjour";
        // SetText(layer=1, obj=7, textValue=<hash>)
        host.MenuCommand(0x4096E67E, 1u, [(double)7, (double)0x1234]);

        Assert.Equal("Bonjour", host.State.Layers[1u].Objects[7u].Text);
    }
}
