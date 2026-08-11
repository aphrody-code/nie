using System.IO;
using System.Linq;
using IECODE.Core.Scripting.Lua;
using IECODE.Core.Util;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du générateur de manifestes typés (<see cref="LuaTypesGenerator"/>) : un script réel doit
/// être décodé/parsé et ses liens (fonction C / cfg.bin) résolus.
/// </summary>
public class LuaTypesGeneratorTests
{
    private static readonly string RepoRoot =
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));

    private static readonly string RawDir     = Path.Combine(RepoRoot, "re", "lua", "raw");
    private static readonly string UnluacJar  = Path.Combine(RepoRoot, "re", "lua", "unluac.jar");
    private static readonly string HashDict   = Path.Combine(RepoRoot, "re", "menu", "hash-dictionary.json");
    private static readonly string CmdIds     = Path.Combine(RepoRoot, "re", "lua", "funclua-cmdids.json");
    private static readonly string Qrcode     = Path.Combine(RawDir, "qrcode_menu.lua.bin");

    private static bool HasPrereqs() =>
        File.Exists(Qrcode) && File.Exists(UnluacJar) && File.Exists(CmdIds);

    private static LuaTypesGenerator MakeGen()
    {
        var dict = File.Exists(HashDict) ? Level5HashDictionary.Load(HashDict) : null;
        return new LuaTypesGenerator(dict, FuncLuaCommands.Load(CmdIds), UnluacJar);
    }

    [Fact]
    public void Generate_QrcodeMenu_DecodedParsedAndResolved()
    {
        if (!HasPrereqs()) return;

        var m = MakeGen().Generate(Qrcode);

        // Décodé / parsé / non chiffré.
        Assert.True(m.Resolution.Decompiled);
        Assert.True(m.Resolution.Parsed);
        Assert.False(m.Resolution.Encrypted);
        Assert.True(m.Resolution.ProtoCount > 0);
        Assert.True(m.Resolution.InstructionCount > 0);

        // layerIds extraits + callbacks détectés.
        Assert.Contains(292844459u, m.LayerIds);
        Assert.Contains("OnSetupLayer", m.Callbacks);

        // Liens fonction C : au moins une commande émise, résolue vers un nom C (SetSprite…).
        Assert.NotEmpty(m.Resolution.Commands);
        Assert.Contains(m.Resolution.Commands, c => c.Resolved);
    }

    [Fact]
    public void Generate_ProducesLayerWithResolvedName()
    {
        if (!HasPrereqs()) return;

        var m = MakeGen().Generate(Qrcode);
        // Lien cfg.bin/objbin : general_win résout via le dico (dérivé des key tables).
        Assert.Contains(m.Layers, l => l.Name == "general_win");
    }
}
