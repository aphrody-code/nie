using System.IO;
using IECODE.Core.Formats.Lua;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du parseur Lua 5.2 contre les vrais fichiers .lua.bin extraits d'IEVR.
/// Fichiers de référence : re/lua/raw/ (relatif à la solution).
/// Les tests qui dépendent des fichiers réels sont skippés si ceux-ci sont absents.
/// </summary>
public class LuaParserTests
{
    // Répertoire résolu depuis le binaire de test (../../../../../re/lua/raw)
    private static readonly string RawDir =
        Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "..", "re", "lua", "raw"));

    private static string RawFile(string name) => Path.Combine(RawDir, name);

    private static bool HasRawFiles() =>
        Directory.Exists(RawDir) &&
        File.Exists(Path.Combine(RawDir, "qrcode_menu.lua.bin"));

    // ── IsLua52 ───────────────────────────────────────────────────────────────
    [Fact]
    public void IsLua52_ReturnsTrueForValidHeader()
    {
        var header = new byte[] { 0x1B, 0x4C, 0x75, 0x61, 0x52 };
        Assert.True(LuaParser.IsLua52(header));
    }

    [Fact]
    public void IsLua52_ReturnsFalseForLua51()
    {
        var header = new byte[] { 0x1B, 0x4C, 0x75, 0x61, 0x51 };
        Assert.False(LuaParser.IsLua52(header));
    }

    [Fact]
    public void IsLua52_ReturnsFalseForEmptyBuffer()
    {
        Assert.False(LuaParser.IsLua52([]));
    }

    // ── Decode instruction ────────────────────────────────────────────────────
    [Fact]
    public void InstructionDecode_OpcodeMaskIsCorrect()
    {
        // RETURN 1 0 → opcode=31, A=1, B=0
        uint raw  = (uint)LuaConstants.Opcode.RETURN | (1u << 6);
        var instr = LuaInstruction.Decode(raw);
        Assert.Equal(LuaConstants.Opcode.RETURN, instr.Opcode);
        Assert.Equal(1, instr.A);
        Assert.Equal(0, instr.B);
    }

    [Fact]
    public void InstructionDecode_SBxBiasApplied()
    {
        // JMP sBx=0 → Bx = 131071, raw = JMP | (131071 << 14)
        uint raw  = (uint)LuaConstants.Opcode.JMP | ((uint)LuaConstants.SBxBias << 14);
        var instr = LuaInstruction.Decode(raw);
        Assert.Equal(LuaConstants.Opcode.JMP, instr.Opcode);
        Assert.Equal(0, instr.sBx);
    }

    [Fact]
    public void InstructionDecode_ABC_AllFields()
    {
        // CALL A=2 B=5 C=1 → raw = 29 | (2<<6) | (1<<14) | (5<<23)
        uint raw  = (uint)LuaConstants.Opcode.CALL | (2u << 6) | (1u << 14) | (5u << 23);
        var instr = LuaInstruction.Decode(raw);
        Assert.Equal(LuaConstants.Opcode.CALL, instr.Opcode);
        Assert.Equal(2, instr.A);
        Assert.Equal(5, instr.B);
        Assert.Equal(1, instr.C);
    }

    // ── Parse header (fichiers réels) ─────────────────────────────────────────
    [Fact]
    public void Header_IevrFields_AreCorrect()
    {
        if (!HasRawFiles()) return; // skip si absents

        var data  = File.ReadAllBytes(RawFile("qrcode_menu.lua.bin"));
        var chunk = LuaParser.Parse(data);
        var h     = chunk.Header;

        Assert.Equal(0x52, h.Version);
        Assert.Equal(0x00, h.Format);
        Assert.True(h.IsLittleEndian);
        Assert.Equal(4, h.IntSize);
        Assert.Equal(8, h.SizeTSize);
        Assert.Equal(4, h.InstructionSize);
        Assert.Equal(8, h.NumberSize);
        Assert.True(h.IsFloat);
    }

    // ── qrcode_menu.lua.bin ───────────────────────────────────────────────────
    [Fact]
    public void Parse_QrcodeMenu_Has3SubProtos()
    {
        if (!HasRawFiles()) return;

        var data  = File.ReadAllBytes(RawFile("qrcode_menu.lua.bin"));
        var chunk = LuaParser.Parse(data);

        // unluac produit OnSetupLayer, OnOpenLayer, OnCloseLayer → 3 sous-protos
        Assert.Equal(3, chunk.Main.Protos.Count);
    }

    [Fact]
    public void Parse_QrcodeMenu_MainProtoHasInstructions()
    {
        if (!HasRawFiles()) return;

        var data  = File.ReadAllBytes(RawFile("qrcode_menu.lua.bin"));
        var chunk = LuaParser.Parse(data);

        Assert.True(chunk.Main.Code.Count > 0);
    }

    [Fact]
    public void Parse_QrcodeMenu_SubProto0HasNumberConstants()
    {
        if (!HasRawFiles()) return;

        var data  = File.ReadAllBytes(RawFile("qrcode_menu.lua.bin"));
        var chunk = LuaParser.Parse(data);
        var sub0  = chunk.Main.Protos[0];

        // OnSetupLayer : arguments hashés (ex. 292844459, 3781155141 …) → LuaConstant.Number
        bool hasNumbers = sub0.Constants.Any(c => c is LuaConstant.Number);
        Assert.True(hasNumbers, "OnSetupLayer doit contenir des constantes numériques (IDs hashés)");
    }

    // ── battle_menu_multi.lua.bin ─────────────────────────────────────────────
    [Fact]
    public void Parse_BattleMenuMulti_IsValid()
    {
        if (!HasRawFiles()) return;

        var data  = File.ReadAllBytes(RawFile("battle_menu_multi.lua.bin"));
        var chunk = LuaParser.Parse(data);

        Assert.NotNull(chunk.Header);
        Assert.True(chunk.Main.Code.Count > 0);
    }

    [Fact]
    public void Parse_BattleMenuMulti_HasStringConstants()
    {
        if (!HasRawFiles()) return;

        var data  = File.ReadAllBytes(RawFile("battle_menu_multi.lua.bin"));
        var chunk = LuaParser.Parse(data);

        bool hasStrings = EnumerateAllConstants(chunk.Main).OfType<LuaConstant.String>().Any();
        Assert.True(hasStrings, "battle_menu_multi doit avoir des constantes string");
    }

    // ── Batch ─────────────────────────────────────────────────────────────────
    [Fact]
    public void Parse_AllRawFiles_NoExceptions()
    {
        if (!HasRawFiles()) return;

        var files  = Directory.EnumerateFiles(RawDir, "*.lua.bin").ToList();
        Assert.NotEmpty(files);

        var errors = new List<string>();
        foreach (var f in files)
        {
            try   { LuaParser.Parse(File.ReadAllBytes(f)); }
            catch (Exception ex) { errors.Add($"{Path.GetFileName(f)}: {ex.Message}"); }
        }

        Assert.True(errors.Count == 0,
            $"{errors.Count}/{files.Count} fichiers en erreur :\n" + string.Join("\n", errors));
    }

    // ── Désassemblage ─────────────────────────────────────────────────────────
    [Fact]
    public void Disassemble_QrcodeMenu_ContainsGETTABUP()
    {
        if (!HasRawFiles()) return;

        var data  = File.ReadAllBytes(RawFile("qrcode_menu.lua.bin"));
        var chunk = LuaParser.Parse(data);
        string asm = LuaDisassembler.Disassemble(chunk);

        Assert.Contains("GETTABUP", asm);
    }

    [Fact]
    public void Disassemble_QrcodeMenu_ContainsCALL()
    {
        if (!HasRawFiles()) return;

        var data  = File.ReadAllBytes(RawFile("qrcode_menu.lua.bin"));
        var chunk = LuaParser.Parse(data);
        string asm = LuaDisassembler.Disassemble(chunk);
        Assert.Contains("CALL", asm);
    }

    [Fact]
    public void Disassemble_QrcodeMenu_ContainsEQ()
    {
        if (!HasRawFiles()) return;

        var data  = File.ReadAllBytes(RawFile("qrcode_menu.lua.bin"));
        var chunk = LuaParser.Parse(data);
        string asm = LuaDisassembler.Disassemble(chunk);

        // Les if A0 == const… compilent en EQ en Lua 5.2
        Assert.Contains("EQ", asm);
    }

    // ── Utilitaires ──────────────────────────────────────────────────────────
    private static IEnumerable<LuaConstant> EnumerateAllConstants(LuaProto p)
    {
        foreach (var c in p.Constants) yield return c;
        foreach (var child in p.Protos)
            foreach (var c in EnumerateAllConstants(child))
                yield return c;
    }
}
